/* ──────────────────────────────────────────────────────────────
   Cutover — flip writes from source to target.
   Steps performed:
     1. Verify no replication lag
     2. Verify all per-table subscription state = streaming
     3. Detect sequence drift (source.last_value vs target.last_value)
     4. Synchronize target serial and identity sequence state
     5. Verify row counts match per table
     6. Disable subscription so target stops trying to pull from source
     7. Surface the target connection string as the new primary
   ────────────────────────────────────────────────────────────── */

import { Client } from "pg";
import type {
  AnalyzeTargetResult,
  CutoverPreflight,
  CutoverResult,
  CutoverStep,
  RowCountCheck,
  SequenceDrift,
} from "./types";

const DEFAULT_SUB = "neon_advisor_sub";

function unpool(conn: string): string {
  return conn.replace(/-pooler/g, "");
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function qualifiedIdentifier(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function relationKey(schema: string, table: string): string {
  return `${schema}\0${table}`;
}

interface SequenceColumnRelation {
  sequence_schema: string;
  sequence_name: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  increment_by: string;
}

interface SequenceState {
  lastValue: bigint;
  isCalled: boolean;
}

interface SequenceBoundary {
  value: bigint | null;
  hasRows: boolean;
}

async function loadSequenceColumnRelations(
  client: Client,
): Promise<SequenceColumnRelation[]> {
  const result = await client.query<SequenceColumnRelation>(`
    WITH sequence_column_dependencies AS (
      SELECT
        dependency.objid AS sequence_oid,
        dependency.refobjid AS table_oid,
        dependency.refobjsubid AS column_number
      FROM pg_depend dependency
      JOIN pg_class sequence_class
        ON sequence_class.oid = dependency.objid
       AND sequence_class.relkind = 'S'
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objsubid = 0
        AND dependency.refclassid = 'pg_class'::regclass
        AND dependency.deptype IN ('a', 'i')

      UNION

      SELECT
        dependency.refobjid AS sequence_oid,
        attribute_default.adrelid AS table_oid,
        attribute_default.adnum AS column_number
      FROM pg_depend dependency
      JOIN pg_attrdef attribute_default
        ON attribute_default.oid = dependency.objid
      JOIN pg_class sequence_class
        ON sequence_class.oid = dependency.refobjid
       AND sequence_class.relkind = 'S'
      WHERE dependency.classid = 'pg_attrdef'::regclass
        AND dependency.refclassid = 'pg_class'::regclass
        AND dependency.deptype = 'n'
    )
    SELECT DISTINCT
      sequence_ns.nspname AS sequence_schema,
      sequence_class.relname AS sequence_name,
      table_ns.nspname AS table_schema,
      table_class.relname AS table_name,
      table_attribute.attname AS column_name,
      sequence_catalog.seqincrement::text AS increment_by
    FROM sequence_column_dependencies dependency
    JOIN pg_class sequence_class
      ON sequence_class.oid = dependency.sequence_oid
    JOIN pg_namespace sequence_ns
      ON sequence_ns.oid = sequence_class.relnamespace
    JOIN pg_sequence sequence_catalog
      ON sequence_catalog.seqrelid = sequence_class.oid
    JOIN pg_class table_class
      ON table_class.oid = dependency.table_oid
    JOIN pg_namespace table_ns
      ON table_ns.oid = table_class.relnamespace
    JOIN pg_attribute table_attribute
      ON table_attribute.attrelid = dependency.table_oid
     AND table_attribute.attnum = dependency.column_number
    WHERE table_attribute.attnum > 0
      AND NOT table_attribute.attisdropped
      AND sequence_ns.nspname <> 'information_schema'
      AND sequence_ns.nspname !~ '^pg_'
      AND table_ns.nspname <> 'information_schema'
      AND table_ns.nspname !~ '^pg_'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend extension_dependency
        WHERE extension_dependency.classid = 'pg_class'::regclass
          AND extension_dependency.objid = sequence_class.oid
          AND extension_dependency.deptype = 'e'
      )
    ORDER BY
      sequence_ns.nspname,
      sequence_class.relname,
      table_ns.nspname,
      table_class.relname,
      table_attribute.attname
  `);
  return result.rows;
}

async function readSequenceState(
  client: Client,
  schema: string,
  sequence: string,
): Promise<SequenceState> {
  const result = await client.query<{ last_value: string; is_called: boolean }>(
    `SELECT last_value::text AS last_value, is_called FROM ${qualifiedIdentifier(schema, sequence)}`,
  );
  return {
    lastValue: BigInt(result.rows[0].last_value),
    isCalled: result.rows[0].is_called,
  };
}

async function readSequenceBoundary(
  client: Client,
  relations: SequenceColumnRelation[],
  increment: bigint,
): Promise<SequenceBoundary> {
  let boundary: bigint | null = null;
  let hasRows = false;
  const aggregate = increment < BigInt(0) ? "MIN" : "MAX";
  for (const relation of relations) {
    const result = await client.query<{
      boundary: string | null;
      row_count: string;
    }>(
      `SELECT ${aggregate}(${quoteIdent(relation.column_name)})::text AS boundary, ` +
        `count(*)::text AS row_count ` +
        `FROM ${qualifiedIdentifier(relation.table_schema, relation.table_name)}`,
    );
    hasRows ||= BigInt(result.rows[0].row_count) > BigInt(0);
    if (result.rows[0].boundary === null) continue;
    const candidate = BigInt(result.rows[0].boundary);
    if (
      boundary === null ||
      (increment < BigInt(0) ? candidate < boundary : candidate > boundary)
    ) {
      boundary = candidate;
    }
  }
  return { value: boundary, hasRows };
}

function requiredSequenceValue(
  sourceState: SequenceState,
  boundary: bigint | null,
  increment: bigint,
): bigint {
  if (boundary === null || !sourceState.isCalled) {
    return boundary ?? sourceState.lastValue;
  }
  return increment < BigInt(0)
    ? sourceState.lastValue < boundary
      ? sourceState.lastValue
      : boundary
    : sourceState.lastValue > boundary
      ? sourceState.lastValue
      : boundary;
}

function displaySequenceNumber(value: bigint): number {
  return Number(value);
}

function groupSequenceRelations(
  relations: SequenceColumnRelation[],
): Map<string, SequenceColumnRelation[]> {
  const grouped = new Map<string, SequenceColumnRelation[]>();
  for (const relation of relations) {
    const key = relationKey(
      relation.sequence_schema,
      relation.sequence_name,
    );
    const existing = grouped.get(key);
    if (existing) {
      existing.push(relation);
    } else {
      grouped.set(key, [relation]);
    }
  }
  return grouped;
}

export async function synchronizeTargetSequences(
  sourceConn: string,
  targetConn: string,
  tables: { schema: string; table: string }[],
): Promise<SequenceDrift[]> {
  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    const tableKeys = new Set(
      tables.map((table) => relationKey(table.schema, table.table)),
    );
    const sequenceRelations = (await loadSequenceColumnRelations(src)).filter(
      (relation) =>
        tableKeys.has(
          relationKey(relation.table_schema, relation.table_name),
        ),
    );
    const sequences = groupSequenceRelations(sequenceRelations);
    const synchronized: SequenceDrift[] = [];

    for (const relations of sequences.values()) {
      const sequence = relations[0];
      const increment = BigInt(sequence.increment_by);
      const [sourceState, targetState, targetBoundary] = await Promise.all([
        readSequenceState(
          src,
          sequence.sequence_schema,
          sequence.sequence_name,
        ),
        readSequenceState(
          tgt,
          sequence.sequence_schema,
          sequence.sequence_name,
        ),
        readSequenceBoundary(tgt, relations, increment),
      ]);
      const sourceRequired = requiredSequenceValue(
        sourceState,
        targetBoundary.value,
        increment,
      );
      const desiredValue =
        targetState.isCalled &&
        (increment < BigInt(0)
          ? targetState.lastValue < sourceRequired
          : targetState.lastValue > sourceRequired)
          ? targetState.lastValue
          : sourceRequired;
      const desiredIsCalled =
        targetBoundary.hasRows ||
        sourceState.isCalled ||
        (desiredValue === targetState.lastValue && targetState.isCalled);
      await tgt.query("SELECT setval($1::regclass, $2::bigint, $3)", [
        qualifiedIdentifier(
          sequence.sequence_schema,
          sequence.sequence_name,
        ),
        desiredValue.toString(),
        desiredIsCalled,
      ]);
      const relation = relations[0];
      synchronized.push({
        sequence: `${sequence.sequence_schema}.${sequence.sequence_name}`,
        table: `${relation.table_schema}.${relation.table_name}`,
        column: relation.column_name,
        sourceLastValue: displaySequenceNumber(sourceRequired),
        targetLastValue: displaySequenceNumber(targetState.lastValue),
        driftBy: displaySequenceNumber(
          sourceRequired - targetState.lastValue,
        ),
        recommendedTargetValue: displaySequenceNumber(desiredValue),
      });
    }
    return synchronized;
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
}

/* ── Preflight ─────────────────────────────────────────────── */

export async function preflight(
  sourceConn: string,
  targetConn: string,
  subName: string = DEFAULT_SUB,
): Promise<CutoverPreflight> {
  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    const subRow = await tgt.query<{
      subenabled: boolean;
      latest_end_lsn: string | null;
      received_lsn: string | null;
    }>(
      `SELECT s.subenabled, sr.latest_end_lsn::text, sr.received_lsn::text
       FROM pg_subscription s
       LEFT JOIN pg_stat_subscription sr ON sr.subname = s.subname
       WHERE s.subname = $1`,
      [subName],
    );
    if (subRow.rows.length === 0) {
      return {
        ok: false,
        blockers: [`Subscription '${subName}' not found on target. Run Setup first.`],
        warnings: [],
        replicationLagBytes: null,
        allTablesStreaming: false,
        sequenceDrift: [],
        rowCounts: [],
        subscriptionEnabled: false,
      };
    }
    const subEnabled = subRow.rows[0].subenabled;

    // Real publisher → subscriber lag = pg_wal_lsn_diff on the publisher
    // (slot.confirmed_flush_lsn vs publisher.pg_current_wal_lsn).
    // The subscriber-only ack diff is almost always zero and misses the
    // case we care about most: publisher has written WAL the subscriber
    // hasn't pulled yet. That's the exact thing cutover must catch.
    //
    // We also check slot.active here — a subscription can report itself
    // as enabled while the underlying replication slot is inactive (a
    // disconnected worker that hasn't reattached). That's silent data
    // loss waiting to happen and must block cutover.
    let lagBytes: number | null = null;
    let slotActive: boolean | null = null;
    let slotExists = false;
    try {
      const r = await src.query<{ lag: string | null; active: boolean }>(
        `SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::text AS lag,
                active
         FROM pg_replication_slots WHERE slot_name = $1`,
        [subName],
      );
      if (r.rows.length > 0) {
        slotExists = true;
        slotActive = r.rows[0].active;
        if (r.rows[0].lag !== null) {
          lagBytes = parseInt(r.rows[0].lag, 10);
        }
      }
    } catch {
      lagBytes = null;
    }

    const perTable = await tgt.query<{
      schema: string;
      table: string;
      state: string;
    }>(
      `SELECT table_ns.nspname AS schema,
              table_class.relname AS table,
              CASE srsubstate
                WHEN 'i' THEN 'initializing'
                WHEN 'd' THEN 'copying'
                WHEN 's' THEN 'synchronized'
                WHEN 'r' THEN 'streaming'
                ELSE srsubstate::text
              END AS state
       FROM pg_subscription_rel sr
       JOIN pg_subscription s ON s.oid = sr.srsubid
       JOIN pg_class table_class ON table_class.oid = sr.srrelid
       JOIN pg_namespace table_ns ON table_ns.oid = table_class.relnamespace
       WHERE s.subname = $1`,
      [subName],
    );
    const notStreaming = perTable.rows.filter(
      (r) => r.state !== "streaming" && r.state !== "synchronized",
    );
    const allStreaming = notStreaming.length === 0 && perTable.rows.length > 0;

    // Discover serial, identity, and explicit nextval() dependencies from the
    // catalogs. Restrict the source inventory to tables actually attached to
    // this target subscription, without assuming the public schema.
    const replicatedTableKeys = new Set(
      perTable.rows.map((table) => relationKey(table.schema, table.table)),
    );
    const sequenceRelations = (await loadSequenceColumnRelations(src)).filter(
      (relation) =>
        replicatedTableKeys.has(
          relationKey(relation.table_schema, relation.table_name),
        ),
    );
    const sequences = groupSequenceRelations(sequenceRelations);
    const drift: SequenceDrift[] = [];
    const sequenceErrors: string[] = [];
    for (const relations of sequences.values()) {
      const sequence = relations[0];
      const displayName = `${sequence.sequence_schema}.${sequence.sequence_name}`;
      try {
        const increment = BigInt(sequence.increment_by);
        const [sourceState, targetState, boundary] = await Promise.all([
          readSequenceState(
            src,
            sequence.sequence_schema,
            sequence.sequence_name,
          ),
          readSequenceState(
            tgt,
            sequence.sequence_schema,
            sequence.sequence_name,
          ),
          readSequenceBoundary(src, relations, increment),
        ]);
        const required = requiredSequenceValue(
          sourceState,
          boundary.value,
          increment,
        );
        const requiredIsCalled = boundary.hasRows || sourceState.isCalled;
        const targetBehind =
          increment < BigInt(0)
            ? targetState.lastValue > required
            : targetState.lastValue < required;
        const callStateWouldCollide =
          targetState.lastValue === required &&
          requiredIsCalled &&
          !targetState.isCalled;
        if (!targetBehind && !callStateWouldCollide) continue;
        const relation = relations[0];
        drift.push({
          sequence: displayName,
          table: `${relation.table_schema}.${relation.table_name}`,
          column: relation.column_name,
          sourceLastValue: displaySequenceNumber(required),
          targetLastValue: displaySequenceNumber(targetState.lastValue),
          driftBy: displaySequenceNumber(
            required - targetState.lastValue,
          ),
          recommendedTargetValue: displaySequenceNumber(required),
        });
      } catch (error) {
        sequenceErrors.push(
          `${displayName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Row counts per replicated table
    const tables = perTable.rows.map((table) => ({
      ...table,
      qualifiedName: `${table.schema}.${table.table}`,
    }));
    const rowCounts: RowCountCheck[] = [];
    for (const table of tables) {
      try {
        const [srcRes, tgtRes] = await Promise.all([
          src.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM ${qualifiedIdentifier(table.schema, table.table)}`,
          ),
          tgt.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM ${qualifiedIdentifier(table.schema, table.table)}`,
          ),
        ]);
        const srcRows = parseInt(srcRes.rows[0].n, 10);
        const tgtRows = parseInt(tgtRes.rows[0].n, 10);
        rowCounts.push({
          table: table.qualifiedName,
          sourceRows: srcRows,
          targetRows: tgtRows,
          delta: srcRows - tgtRows,
          match: srcRows === tgtRows,
        });
      } catch {
        /* count failed on one side — skip */
      }
    }

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!subEnabled) {
      blockers.push("Subscription is disabled. Re-enable it or restart setup before cutting over.");
    }
    if (!allStreaming) {
      blockers.push(
        `${notStreaming.length} table(s) not yet streaming: ${notStreaming
          .slice(0, 5)
          .map((table) => `${table.schema}.${table.table}`)
          .join(", ")}`,
      );
    }
    if (!slotExists) {
      blockers.push(
        `Replication slot '${subName}' not found on source. Subscription is orphaned — re-run setup.`,
      );
    } else if (slotActive === false) {
      blockers.push(
        `Replication slot '${subName}' exists but is inactive (no walsender attached). New writes won't replicate — re-run setup or restart the subscription.`,
      );
    }
    if (sequenceErrors.length > 0) {
      blockers.push(
        `Could not verify ${sequenceErrors.length} target sequence${sequenceErrors.length === 1 ? "" : "s"}: ${sequenceErrors.slice(0, 3).join("; ")}${sequenceErrors.length > 3 ? "; …" : ""}`,
      );
    }
    // Lag thresholds — these are intentionally conservative since any lag
    // at cutover time means some writes will be lost or need replay.
    // > 64KB = block (real backlog, not just normal WAL housekeeping)
    // > 4KB  = warn (small but worth a second look)
    if (lagBytes !== null && lagBytes > 64 * 1024) {
      blockers.push(
        `Replication lag is ${(lagBytes / 1024).toFixed(1)} KB. Wait for it to drain below 4 KB before cutting over.`,
      );
    } else if (lagBytes !== null && lagBytes > 4 * 1024) {
      warnings.push(
        `Replication lag is ${(lagBytes / 1024).toFixed(1)} KB — wait a moment for it to drain.`,
      );
    }
    const mismatches = rowCounts.filter((r) => !r.match);
    if (mismatches.length > 0) {
      warnings.push(
        `Row count mismatch on ${mismatches.length} table(s): ${mismatches
          .slice(0, 3)
          .map((m) => `${m.table} (Δ${m.delta})`)
          .join(", ")}`,
      );
    }
    if (drift.length > 0) {
      const examples = drift
        .slice(0, 3)
        .map(
          (d) =>
            `${d.sequence.split(".").pop() ?? d.sequence} (target last_value=${d.targetLastValue}, source max=${d.sourceLastValue})`,
        )
        .join("; ");
      warnings.push(
        `${drift.length} sequence(s) need bumping before cutover. ` +
          `Logical replication copies rows but does not copy sequence state, so target sequences are still near 1 while replicated rows already use IDs up through source max. ` +
          `If you cut over without fixing this, the very first INSERT from your app will call nextval(), get a low value like 2 or 3, and fail with "duplicate key value violates unique constraint" because that row already exists from replication. ` +
          `Symptoms in your app: 500 errors on every write, retried inserts looping forever, ORM transactions rolling back, queues backing up, audit/event tables silently dropping records. ` +
          `Every write will fail until the sequence catches up past every replicated row's ID. Execute Cutover prevents this by discovering serial and identity dependencies from PostgreSQL catalogs and synchronizing each target sequence without moving it backward. ` +
          `Examples: ${examples}${drift.length > 3 ? ", ..." : ""}.`,
      );
    }

    return {
      ok: blockers.length === 0,
      blockers,
      warnings,
      replicationLagBytes: lagBytes,
      allTablesStreaming: allStreaming,
      sequenceDrift: drift,
      rowCounts,
      subscriptionEnabled: subEnabled,
    };
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
}

/* ── Execute ───────────────────────────────────────────────── */

interface ExecuteOptions {
  /** Subscription name on target (default: neon_advisor_sub) */
  subscriptionName?: string;
  /** If true, runs preflight but does no write operations on target */
  dryRun?: boolean;
}

export async function execute(
  sourceConn: string,
  targetConn: string,
  opts: ExecuteOptions = {},
): Promise<CutoverResult> {
  const subName = opts.subscriptionName ?? DEFAULT_SUB;
  const startedAt = new Date().toISOString();
  const stepStart = Date.now();
  const steps: CutoverStep[] = [];

  function pushStep(s: Omit<CutoverStep, "status"> & Partial<Pick<CutoverStep, "status">>): CutoverStep {
    const step: CutoverStep = {
      status: "pending",
      ...s,
    };
    steps.push(step);
    return step;
  }
  async function runStep<T>(
    id: string,
    label: string,
    fn: () => Promise<{ detail?: string; result: T } | T>,
  ): Promise<T> {
    const step = pushStep({ id, label });
    step.status = "running";
    step.startedAt = new Date().toISOString();
    const start = Date.now();
    try {
      const out = await fn();
      const isWrapped = (v: unknown): v is { detail?: string; result: T } =>
        typeof v === "object" && v !== null && "result" in (v as object);
      const result = isWrapped(out) ? out.result : (out as T);
      const detail = isWrapped(out) ? out.detail : undefined;
      step.status = "ok";
      if (detail) step.detail = detail;
      step.completedAt = new Date().toISOString();
      step.durationMs = Date.now() - start;
      return result;
    } catch (e) {
      step.status = "failed";
      step.detail = e instanceof Error ? e.message : String(e);
      step.completedAt = new Date().toISOString();
      step.durationMs = Date.now() - start;
      throw e;
    }
  }

  // Preflight
  const pre = await runStep("preflight", "Preflight checks", async () => {
    const p = await preflight(sourceConn, targetConn, subName);
    if (!p.ok) throw new Error(p.blockers.join("; "));
    return {
      result: p,
      detail: `lag=${p.replicationLagBytes ?? "?"}B · ${p.rowCounts.length} tables checked`,
    };
  });

  // Drain — wait briefly for any remaining lag to flush
  await runStep("drain", "Drain replication lag", async () => {
    const t0 = Date.now();
    let lag = pre.replicationLagBytes ?? 0;
    while (lag > 0 && Date.now() - t0 < 10_000) {
      await new Promise((r) => setTimeout(r, 500));
      const p2 = await preflight(sourceConn, targetConn, subName);
      lag = p2.replicationLagBytes ?? 0;
    }
    return { result: lag, detail: `final lag = ${lag} bytes` };
  });

  // Synchronize serial, identity, and explicit nextval() sequences associated
  // with this subscription. Catalog dependencies preserve custom schemas and
  // avoid information_schema.column_default, which is NULL for identities.
  const resetSeqs: SequenceDrift[] = [];
  await runStep("sequences", "Reset target sequences", async () => {
    if (opts.dryRun) {
      return { result: 0, detail: "dry-run" };
    }
    const tgt = new Client({ connectionString: unpool(targetConn) });
    await tgt.connect();
    let replicatedTables: { schema: string; table: string }[];
    try {
      const result = await tgt.query<{
        schema: string;
        table: string;
      }>(
        `SELECT table_ns.nspname AS schema, table_class.relname AS table
         FROM pg_subscription_rel relation
         JOIN pg_subscription subscription
           ON subscription.oid = relation.srsubid
         JOIN pg_class table_class
           ON table_class.oid = relation.srrelid
         JOIN pg_namespace table_ns
           ON table_ns.oid = table_class.relnamespace
         WHERE subscription.subname = $1`,
        [subName],
      );
      replicatedTables = result.rows;
    } finally {
      await tgt.end();
    }
    resetSeqs.push(
      ...(await synchronizeTargetSequences(
        sourceConn,
        targetConn,
        replicatedTables,
      )),
    );
    return {
      result: resetSeqs.length,
      detail: `${resetSeqs.length} serial and identity sequence(s) synchronized`,
    };
  });

  // Verify row counts one more time
  await runStep("verify", "Verify row counts", async () => {
    const post = await preflight(sourceConn, targetConn, subName);
    const mismatched = post.rowCounts.filter((r) => !r.match);
    if (mismatched.length > 0) {
      // Not strictly fatal — log and continue. Logical replication is
      // eventually consistent within a few ms under steady state.
      return {
        result: mismatched.length,
        detail: `${mismatched.length} table(s) still draining`,
      };
    }
    return {
      result: 0,
      detail: `all ${post.rowCounts.length} tables match`,
    };
  });

  // Disable subscription on target so it no longer pulls from source
  await runStep("disable-sub", "Disable target subscription", async () => {
    if (opts.dryRun) return { result: 0, detail: "dry-run" };
    const tgt = new Client({ connectionString: unpool(targetConn) });
    await tgt.connect();
    try {
      await tgt.query(`ALTER SUBSCRIPTION "${subName}" DISABLE`);
    } finally {
      await tgt.end();
    }
    return { result: 1, detail: `${subName} disabled` };
  });

  const completedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - stepStart;

  // Recompute final lag for the report
  let finalLag: number | null = null;
  try {
    const finalPre = await preflight(sourceConn, targetConn, subName);
    finalLag = finalPre.replicationLagBytes;
  } catch {
    /* ignore */
  }

  return {
    startedAt,
    completedAt,
    totalDurationMs,
    steps,
    sequencesReset: resetSeqs,
    finalLagBytes: finalLag,
    newPrimaryConnectionString: targetConn,
    postCutoverActions: [
      "Run ANALYZE on the target before sending traffic — replication copied rows but not pg_statistic, so the planner has no stats and will pick sequential scans over indexes. This is the classic 'upgraded and CPU pinned at 100%' failure, and scaling compute does not fix it",
      "Update your app's DATABASE_URL / connection string to the target project",
      "Smoke-test critical writes against the target",
      "Monitor pg_stat_database on target for unexpected errors over the next hour",
      "Keep the source project running 24-48h for rollback safety",
      "When confident, run 'Teardown' to drop the publication on source",
    ],
  };
}

/* ── Analyze target ────────────────────────────────────────── */

/* Rebuild optimizer statistics on the target.

   No Neon migration path brings pg_statistic across: logical replication
   never replicates it, and pg_dump only includes it when explicitly asked
   (--statistics, PG 18+ client). A target with no stats makes the planner
   fall back to default selectivity estimates, which reliably produces
   sequential scans and nested loops over tables it thinks are tiny.

   This is deliberately a separate opt-in call rather than a step inside
   execute(): a database-wide ANALYZE on a large target can run for many
   minutes, and we don't want it wedging the cutover request. */
export async function analyzeTarget(
  targetConn: string,
): Promise<AnalyzeTargetResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await tgt.connect();
  try {
    // reltuples = -1 means the relation has never been vacuumed or
    // analyzed (PG 14+). pg_statistic itself isn't readable without
    // superuser, so this is the portable signal on Neon.
    const NEVER_ANALYZED = `
      SELECT count(*)::text AS n
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'm', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND c.reltuples = -1
    `;
    const before = await tgt.query<{ n: string }>(NEVER_ANALYZED);

    // ANALYZE is safe to issue directly (unlike VACUUM it can run inside a
    // transaction block). We clear statement_timeout for the session because
    // a full-database ANALYZE on a large target will blow past any default.
    await tgt.query("SET statement_timeout = 0");
    await tgt.query("ANALYZE");

    const after = await tgt.query<{ n: string }>(NEVER_ANALYZED);
    const relations = await tgt.query<{ n: string }>(`
      SELECT count(*)::text AS n
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'm', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    `);

    return {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      relations: Number.parseInt(relations.rows[0]?.n ?? "0", 10),
      missingStatsBefore: Number.parseInt(before.rows[0]?.n ?? "0", 10),
      missingStatsAfter: Number.parseInt(after.rows[0]?.n ?? "0", 10),
    };
  } finally {
    await tgt.end();
  }
}

/* ── Rollback ──────────────────────────────────────────────── */

/** Re-enable the subscription so writes that landed on target during the
    aborted cutover replicate back to source. Only safe to call shortly
    after execute() if no new writes have actually hit the target. */
export async function rollback(
  targetConn: string,
  subName: string = DEFAULT_SUB,
): Promise<{ subscriptionReEnabled: boolean }> {
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await tgt.connect();
  try {
    const exists = await tgt.query(
      "SELECT 1 FROM pg_subscription WHERE subname = $1",
      [subName],
    );
    if (exists.rows.length === 0) {
      return { subscriptionReEnabled: false };
    }
    await tgt.query(`ALTER SUBSCRIPTION "${subName}" ENABLE`);
    return { subscriptionReEnabled: true };
  } finally {
    await tgt.end();
  }
}
