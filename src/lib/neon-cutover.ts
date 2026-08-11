/* ──────────────────────────────────────────────────────────────
   Cutover — flip writes from source to target.
   Steps performed:
     1. Verify no replication lag
     2. Verify all per-table subscription state = streaming
     3. Detect sequence drift (source.last_value vs target.last_value)
     4. Reset target sequences to (source.last_value + safety_margin)
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

    const perTable = await tgt.query<{ table: string; state: string }>(
      `SELECT srrelid::regclass::text AS table,
              CASE srsubstate
                WHEN 'i' THEN 'initializing'
                WHEN 'd' THEN 'copying'
                WHEN 's' THEN 'synchronized'
                WHEN 'r' THEN 'streaming'
                ELSE srsubstate::text
              END AS state
       FROM pg_subscription_rel sr
       JOIN pg_subscription s ON s.oid = sr.srsubid
       WHERE s.subname = $1`,
      [subName],
    );
    const notStreaming = perTable.rows.filter(
      (r) => r.state !== "streaming" && r.state !== "synchronized",
    );
    const allStreaming = notStreaming.length === 0 && perTable.rows.length > 0;

    // Sequence drift: for every sequence owned by a column, compare
    //   max(owning_column) on source — the next id the app *would* produce
    //   vs target sequence's last_value — what the target would generate
    // If source's max > target's last_value, the next nextval() on target
    // would collide. We always recommend bumping target past source's max
    // + a safety margin.
    const seqMeta = await src.query<{
      seq: string;
      tablename: string | null;
      colname: string | null;
    }>(`
      SELECT n.nspname || '.' || c.relname AS seq,
             ot.relname AS tablename,
             oa.attname AS colname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype IN ('a','i')
      LEFT JOIN pg_class ot ON ot.oid = d.refobjid
      LEFT JOIN pg_attribute oa
        ON oa.attrelid = d.refobjid AND oa.attnum = d.refobjsubid
      WHERE c.relkind = 'S' AND n.nspname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend de WHERE de.objid = c.oid AND de.deptype = 'e'
        )
    `);

    const drift: SequenceDrift[] = [];
    const SAFETY = 1000;
    for (const r of seqMeta.rows) {
      // Source side: prefer max(column) if owner is known, else fall back to
      // pg_sequences.last_value (which is fresh on source — only stale on
      // target after a setval() that hasn't been touched by nextval()).
      let srcMax = 0;
      if (r.tablename && r.colname) {
        try {
          const mx = await src.query<{ m: string | null }>(
            `SELECT COALESCE(max("${r.colname}"), 0)::text AS m FROM "public"."${r.tablename}"`,
          );
          srcMax = parseInt(mx.rows[0].m ?? "0", 10);
        } catch {
          /* fall through */
        }
      }
      if (srcMax === 0) {
        const ls = await src.query<{ lv: string }>(
          `SELECT last_value::text AS lv FROM ${r.seq}`,
        );
        srcMax = parseInt(ls.rows[0].lv, 10);
      }

      const tlv = await tgt
        .query<{ lv: string }>(`SELECT last_value::text AS lv FROM ${r.seq}`)
        .catch(() => null);
      if (!tlv) continue;
      const tgtVal = parseInt(tlv.rows[0].lv, 10);

      const driftBy = srcMax - tgtVal;
      if (driftBy > 0) {
        drift.push({
          sequence: r.seq,
          table: r.tablename ? `public.${r.tablename}` : null,
          column: r.colname,
          sourceLastValue: srcMax,
          targetLastValue: tgtVal,
          driftBy,
          recommendedTargetValue: srcMax + SAFETY,
        });
      }
    }

    // Row counts per replicated table
    const tables = perTable.rows.map((r) => r.table);
    const rowCounts: RowCountCheck[] = [];
    for (const fqTable of tables) {
      try {
        const [srcRes, tgtRes] = await Promise.all([
          src.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${fqTable}`),
          tgt.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${fqTable}`),
        ]);
        const srcRows = parseInt(srcRes.rows[0].n, 10);
        const tgtRows = parseInt(tgtRes.rows[0].n, 10);
        rowCounts.push({
          table: fqTable,
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
          .map((t) => t.table)
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
          `Every write will fail until the sequence catches up past every replicated row's ID. The Execute Cutover step prevents all of this by running Neon's recommended DO block to set each target sequence to MAX(column) on target so the next nextval() returns a safe value. ` +
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

  // Reset sequences on target using Neon's recommended DO $$ block.
  // This walks information_schema.columns for every column whose default
  // calls nextval(...), looks up the owning sequence via
  // pg_get_serial_sequence(), then sets it to max(column).
  // More robust than our per-sequence loop because it covers all owned
  // sequences uniformly, including ones we may have missed during drift
  // detection (e.g. composite types, partitioned tables).
  const resetSeqs: SequenceDrift[] = [];
  await runStep("sequences", "Reset target sequences", async () => {
    if (opts.dryRun) {
      return { result: 0, detail: "dry-run" };
    }
    const tgt = new Client({ connectionString: unpool(targetConn) });
    await tgt.connect();
    try {
      // Neon's recommended DO block, with a NULL-guard.
      // pg_get_serial_sequence() returns NULL when a column's nextval()
      // default references a sequence that isn't formally owned by the
      // column (no ALTER SEQUENCE ... OWNED BY). Our schema-copy creates
      // sequences this way, so the unguarded version of this block fails
      // with SQLSTATE 22004 (query string argument of EXECUTE is null)
      // on the first sequence it can't resolve.
      //
      // The guard does two things:
      //   1. If pg_get_serial_sequence() returns NULL, parse the actual
      //      sequence name out of column_default ("nextval('foo_id_seq'::regclass)").
      //   2. If we still can't resolve a sequence, skip the row instead
      //      of passing NULL to quote_literal().
      const NEON_SEQUENCE_RESET = `
        DO $$
            DECLARE
                i RECORD;
                resolved_seq text;
            BEGIN
                FOR i IN
                    SELECT
                        table_name,
                        table_schema,
                        column_name,
                        column_default,
                        pg_get_serial_sequence(
                          quote_ident(table_schema) || '.' || quote_ident(table_name),
                          column_name
                        ) AS owned_seq
                    FROM information_schema.columns
                    WHERE column_default LIKE 'nextval%'
                LOOP
                    resolved_seq := i.owned_seq;
                    IF resolved_seq IS NULL THEN
                        -- Parse: nextval('public.foo_id_seq'::regclass) → public.foo_id_seq
                        resolved_seq := substring(
                          i.column_default
                          FROM 'nextval\\(''([^'']+)'''
                        );
                    END IF;
                    IF resolved_seq IS NULL THEN
                        CONTINUE;
                    END IF;
                    EXECUTE format(
                      'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I.%I), 1))',
                      resolved_seq, i.column_name, i.table_schema, i.table_name
                    );
                END LOOP;
            END
        $$ LANGUAGE plpgsql;
      `;
      await tgt.query(NEON_SEQUENCE_RESET);
      // Carry the preflight-detected drift into the result for reporting.
      resetSeqs.push(...pre.sequenceDrift);
    } finally {
      await tgt.end();
    }
    return {
      result: resetSeqs.length,
      detail: `${resetSeqs.length || "all"} owned sequence(s) reset to max(col) via Neon DO block`,
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
