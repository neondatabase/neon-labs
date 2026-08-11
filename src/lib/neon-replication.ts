/* ──────────────────────────────────────────────────────────────
   Logical replication setup against live Neon source + target.
   ────────────────────────────────────────────────────────────── */

import { Client } from "pg";
import type {
  PublisherMonitorRow,
  ReplicationMonitor,
  ReplicationPreflight,
  ReplicationSetupResult,
  ReplicationStatus,
  SubscriberMonitorRow,
  TableReplicationState,
} from "./types";

const DEFAULT_PUB = "neon_advisor_pub";
const DEFAULT_SUB = "neon_advisor_sub";

/** Returns `host` and unpooled (`-pooler` removed) connection string. */
function unpool(conn: string): string {
  // Logical replication requires a direct compute connection, not the pooler.
  return conn.replace(/-pooler/g, "");
}

/* ── Preflight ─────────────────────────────────────────────── */

export async function preflight(
  sourceConn: string,
  targetConn: string,
): Promise<ReplicationPreflight> {
  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    const srcVersion = (
      await src.query<{ num: string; wal: string; user: string }>(
        "SELECT current_setting('server_version_num') AS num, current_setting('wal_level') AS wal, current_user AS user",
      )
    ).rows[0];
    const tgtVersion = (
      await tgt.query<{ num: string }>(
        "SELECT current_setting('server_version_num') AS num",
      )
    ).rows[0];

    const srcTables = await src.query<{ schema: string; table: string }>(`
      SELECT n.nspname AS schema, c.relname AS table
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
      ORDER BY 1, 2
    `);
    const noPK = await src.query<{ schema: string; table: string }>(`
      SELECT n.nspname AS schema, c.relname AS table
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary
        )
    `);
    const repRole = await src.query<{ rolreplication: boolean; rolname: string }>(
      "SELECT rolname, rolreplication FROM pg_roles WHERE rolname = current_user",
    );

    const tgtTables = await tgt.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
    `);
    const existingSub = await tgt.query<{ subname: string }>(
      "SELECT subname FROM pg_subscription WHERE subname = $1",
      [DEFAULT_SUB],
    );

    const walLevel = srcVersion.wal;
    const logicalEnabled = walLevel === "logical";
    const tableCount = srcTables.rows.length;
    const tablesWithoutPK = noPK.rows.map((r) => `${r.schema}.${r.table}`);
    const targetSchemaTableCount = parseInt(tgtTables.rows[0].n, 10);
    const targetSchemaLoaded = targetSchemaTableCount >= tableCount && tableCount > 0;

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!logicalEnabled) {
      blockers.push(
        `Source wal_level is '${walLevel}'. Enable logical replication on the source Neon project (irreversible).`,
      );
    }
    if (!repRole.rows[0]?.rolreplication) {
      blockers.push(
        `Connection role '${srcVersion.user}' does not have REPLICATION privilege.`,
      );
    }
    if (tableCount === 0) {
      blockers.push("No tables found in public schema on source.");
    }
    if (!targetSchemaLoaded) {
      warnings.push(
        `Target schema has ${targetSchemaTableCount}/${tableCount} tables, schema copy will run automatically.`,
      );
    }
    if (tablesWithoutPK.length > 0) {
      warnings.push(
        `${tablesWithoutPK.length} tables without PRIMARY KEY, updates/deletes won't replicate cleanly: ${tablesWithoutPK.slice(0, 5).join(", ")}${tablesWithoutPK.length > 5 ? "…" : ""}`,
      );
    }
    if (existingSub.rows.length > 0) {
      warnings.push(
        `Subscription '${DEFAULT_SUB}' already exists on target. Setup will reuse it or fail.`,
      );
    }

    return {
      source: {
        pgVersion: Math.floor(parseInt(srcVersion.num, 10) / 10000),
        walLevel,
        logicalReplicationEnabled: logicalEnabled,
        tableCount,
        tablesWithoutPK,
        roleHasReplication: !!repRole.rows[0]?.rolreplication,
        rolname: srcVersion.user,
      },
      target: {
        pgVersion: Math.floor(parseInt(tgtVersion.num, 10) / 10000),
        schemaLoaded: targetSchemaLoaded,
        schemaTableCount: targetSchemaTableCount,
        existingSubscription: existingSub.rows[0]?.subname ?? null,
      },
      ok: blockers.length === 0,
      blockers,
      warnings,
    };
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
}

/* ── Setup ─────────────────────────────────────────────────── */

interface SchemaCopyReport {
  extensionsCreated: string[];
  extensionsFailed: { name: string; error: string }[];
  tablesCreated: string[];
  tablesSkipped: string[];
  tablesFailed: { name: string; error: string; ddl: string }[];
  indexesCreated: number;
  indexesFailed: { name: string; error: string }[];
}

/** Copy schema from source to target via pg_catalog introspection.
    Uses pg_catalog.format_type() (proper SQL types like "character varying(50)",
    "timestamp with time zone[]") so the DDL round-trips correctly across
    PG14 → PG17. Returns a detailed report so failures surface to the UI.
    For absolute pg_dump fidelity, run `pg_dump --schema-only` out of band. */
async function copySchemaIfNeeded(
  sourceConn: string,
  targetConn: string,
): Promise<SchemaCopyReport> {
  const report: SchemaCopyReport = {
    extensionsCreated: [],
    extensionsFailed: [],
    tablesCreated: [],
    tablesSkipped: [],
    tablesFailed: [],
    indexesCreated: 0,
    indexesFailed: [],
  };

  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    // 1. Extensions
    const exts = await src.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname NOT IN ('plpgsql') ORDER BY extname",
    );
    for (const e of exts.rows) {
      try {
        await tgt.query(`CREATE EXTENSION IF NOT EXISTS "${e.extname}"`);
        report.extensionsCreated.push(e.extname);
      } catch (err) {
        report.extensionsFailed.push({
          name: e.extname,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Sequences first, column defaults like nextval('foo_id_seq'::regclass)
    //    will fail if the sequence doesn't exist on the target.
    const sequences = await src.query<{ schema: string; seq: string }>(`
      SELECT n.nspname AS schema, c.relname AS seq
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'S' AND n.nspname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid AND d.deptype = 'e'
        )
      ORDER BY c.relname
    `);
    for (const s of sequences.rows) {
      try {
        await tgt.query(
          `CREATE SEQUENCE IF NOT EXISTS "${s.schema}"."${s.seq}"`,
        );
      } catch (err) {
        report.tablesFailed.push({
          name: `${s.schema}.${s.seq} (sequence)`,
          error: err instanceof Error ? err.message : String(err),
          ddl: `CREATE SEQUENCE "${s.schema}"."${s.seq}"`,
        });
      }
    }

    // 3. Tables (user tables only, exclude tables owned by extensions like
    //    pg_stat_statements).
    const tables = await src.query<{ schema: string; table: string }>(`
      SELECT n.nspname AS schema, c.relname AS table
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid AND d.deptype = 'e'
        )
      ORDER BY c.relname
    `);

    for (const t of tables.rows) {
      const exists = await tgt.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = $1 AND c.relname = $2",
        [t.schema, t.table],
      );
      if (parseInt(exists.rows[0].n, 10) > 0) {
        report.tablesSkipped.push(`${t.schema}.${t.table}`);
        continue;
      }

      // Use pg_catalog.format_type() for proper round-trippable types
      const cols = await src.query<{
        attname: string;
        formatted_type: string;
        attnotnull: boolean;
        column_default: string | null;
      }>(
        `SELECT
           a.attname,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
           a.attnotnull,
           pg_get_expr(ad.adbin, ad.adrelid) AS column_default
         FROM pg_attribute a
         LEFT JOIN pg_attrdef ad
           ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
         WHERE a.attrelid = ($1 || '.' || $2)::regclass
           AND a.attnum > 0
           AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [t.schema, t.table],
      );
      const pkCols = await src.query<{ attname: string }>(
        `SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary
         ORDER BY array_position(i.indkey, a.attnum)`,
        [t.schema, t.table],
      );

      const colDefs = cols.rows
        .map((c) => {
          const nn = c.attnotnull ? " NOT NULL" : "";
          const def = c.column_default ? ` DEFAULT ${c.column_default}` : "";
          return `"${c.attname}" ${c.formatted_type}${def}${nn}`;
        })
        .join(", ");
      const pk =
        pkCols.rows.length > 0
          ? `, PRIMARY KEY (${pkCols.rows.map((p) => `"${p.attname}"`).join(", ")})`
          : "";
      const ddl = `CREATE TABLE "${t.schema}"."${t.table}" (${colDefs}${pk})`;
      try {
        await tgt.query(ddl);
        report.tablesCreated.push(`${t.schema}.${t.table}`);
      } catch (err) {
        report.tablesFailed.push({
          name: `${t.schema}.${t.table}`,
          error: err instanceof Error ? err.message : String(err),
          ddl,
        });
      }
    }

    // 4. Indexes (non-PK, since PKs were inlined above).
    //    Use pg_get_indexdef() which produces fully qualified, valid DDL.
    const indexes = await src.query<{ indexname: string; indexdef: string }>(`
      SELECT i.indexrelid::regclass::text AS indexname,
             pg_get_indexdef(i.indexrelid) AS indexdef
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT i.indisprimary
        AND NOT i.indisunique
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = i.indexrelid AND d.deptype = 'e'
        )
    `);
    for (const ix of indexes.rows) {
      try {
        await tgt.query(ix.indexdef.replace(/^CREATE INDEX/, "CREATE INDEX IF NOT EXISTS"));
        report.indexesCreated++;
      } catch (err) {
        report.indexesFailed.push({
          name: ix.indexname,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
  return report;
}

export async function setupReplication(
  sourceConn: string,
  targetConn: string,
  opts: { publicationName?: string; subscriptionName?: string } = {},
): Promise<ReplicationSetupResult & { schemaReport: SchemaCopyReport }> {
  const pubName = opts.publicationName ?? DEFAULT_PUB;
  const subName = opts.subscriptionName ?? DEFAULT_SUB;
  const startedAt = new Date().toISOString();

  const schemaReport = await copySchemaIfNeeded(sourceConn, targetConn);
  if (schemaReport.tablesFailed.length > 0) {
    throw new Error(
      `Schema copy failed for ${schemaReport.tablesFailed.length} table(s). First failure: ${schemaReport.tablesFailed[0].name}, ${schemaReport.tablesFailed[0].error}`,
    );
  }

  const src = new Client({ connectionString: unpool(sourceConn) });
  await src.connect();
  let tables: string[] = [];
  try {
    const existing = await src.query<{ pubname: string }>(
      "SELECT pubname FROM pg_publication WHERE pubname = $1",
      [pubName],
    );
    if (existing.rows.length === 0) {
      await src.query(`CREATE PUBLICATION "${pubName}" FOR ALL TABLES`);
    }
    const t = await src.query<{ schema: string; table: string }>(
      `SELECT n.nspname AS schema, c.relname AS table
       FROM pg_publication_tables pt
       JOIN pg_class c ON c.oid = (pt.schemaname || '.' || pt.tablename)::regclass
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE pt.pubname = $1`,
      [pubName],
    );
    tables = t.rows.map((r) => `${r.schema}.${r.table}`);
  } finally {
    await src.end();
  }

  const tgt = new Client({ connectionString: unpool(targetConn) });
  await tgt.connect();
  try {
    const existingSub = await tgt.query(
      "SELECT 1 FROM pg_subscription WHERE subname = $1",
      [subName],
    );
    if (existingSub.rows.length === 0) {
      // pg.Client doesn't allow parameterized DDL, the connection string
      // is whitelisted via the env-vars check upstream.
      const cleanConn = unpool(sourceConn).replace(/'/g, "''");
      await tgt.query(
        `CREATE SUBSCRIPTION "${subName}" CONNECTION '${cleanConn}' PUBLICATION "${pubName}" WITH (copy_data = true)`,
      );
    }
  } finally {
    await tgt.end();
  }

  return {
    publicationName: pubName,
    subscriptionName: subName,
    tables,
    startedAt,
    walLevelChanged: false,
    schemaCopied: true,
    schemaReport,
  };
}

/* ── Status ────────────────────────────────────────────────── */

/**
 * Compute real publisher → subscriber lag by querying BOTH sides:
 *   - Publisher: pg_current_wal_lsn() (what's been written)
 *   - Replication slot: confirmed_flush_lsn (what subscriber acknowledged)
 *   - Lag bytes = pg_wal_lsn_diff(current_wal, confirmed_flush_lsn)
 *
 * The subscriber-only `pg_lsn_diff(latest_end_lsn, received_lsn)` we used
 * before is almost always ~0 because those two LSNs update together, it
 * masks real lag where the publisher has WAL the subscriber hasn't pulled.
 *
 * `sourceConn` is optional so the simpler status() callers still work,
 * but cutover preflight always passes it in to get accurate numbers.
 */
export async function status(
  targetConn: string,
  subName: string = DEFAULT_SUB,
  sourceConn?: string,
): Promise<ReplicationStatus> {
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await tgt.connect();
  try {
    const sub = await tgt.query<{
      subname: string;
      subenabled: boolean;
      latest_end_lsn: string | null;
      last_msg_receipt_time: string | null;
      received_lsn: string | null;
    }>(
      `SELECT s.subname, s.subenabled, sr.latest_end_lsn::text, sr.last_msg_receipt_time, sr.received_lsn::text
       FROM pg_subscription s
       LEFT JOIN pg_stat_subscription sr ON sr.subname = s.subname
       WHERE s.subname = $1`,
      [subName],
    );
    if (sub.rows.length === 0) {
      return {
        subscriptionName: subName,
        subscribed: false,
        workerActive: false,
        receivedLsn: null,
        latestEndLsn: null,
        lagBytes: null,
        initialCopyProgress: null,
        state: "stopped",
        perTable: [],
      };
    }

    const perTable = await tgt.query<{ srrelid: string; srsubstate: string }>(
      `SELECT srrelid::regclass::text AS srrelid, srsubstate
       FROM pg_subscription_rel sr
       JOIN pg_subscription s ON s.oid = sr.srsubid
       WHERE s.subname = $1`,
      [subName],
    );

    const stateMap: Record<string, string> = {
      i: "initializing",
      d: "copying",
      s: "synchronized",
      r: "streaming",
    };
    const tables = perTable.rows.map((r) => ({
      table: r.srrelid,
      state: stateMap[r.srsubstate] ?? r.srsubstate,
    }));

    const copyingCount = tables.filter(
      (t) => t.state === "initializing" || t.state === "copying",
    ).length;
    const totalCount = tables.length || 1;
    const initialCopyProgress =
      copyingCount === 0
        ? null
        : Math.round(((totalCount - copyingCount) / totalCount) * 100);

    // Real lag: ask the publisher how far ahead it is of the slot's
    // confirmed_flush_lsn. This is the byte volume the subscriber hasn't
    // received and confirmed yet.
    let lagBytes: number | null = null;
    if (sourceConn) {
      const src = new Client({ connectionString: unpool(sourceConn) });
      try {
        await src.connect();
        const r = await src.query<{ lag: string | null }>(
          `SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::text AS lag
           FROM pg_replication_slots WHERE slot_name = $1`,
          [subName],
        );
        if (r.rows.length > 0 && r.rows[0].lag !== null) {
          lagBytes = parseInt(r.rows[0].lag, 10);
        }
      } catch {
        /* fall back to null, caller can interpret */
      } finally {
        await src.end().catch(() => undefined);
      }
    }

    // Fall back to subscriber-side ack diff if no source conn provided.
    // This is small but better than nothing and still surfaces some lag.
    if (
      lagBytes === null &&
      sub.rows[0].latest_end_lsn &&
      sub.rows[0].received_lsn
    ) {
      try {
        const r = await tgt.query<{ lag: string }>(
          "SELECT (pg_lsn_diff($1::pg_lsn, $2::pg_lsn))::text AS lag",
          [sub.rows[0].latest_end_lsn, sub.rows[0].received_lsn],
        );
        lagBytes = parseInt(r.rows[0].lag, 10);
      } catch {
        lagBytes = null;
      }
    }

    const state: ReplicationStatus["state"] =
      copyingCount > 0
        ? "copying"
        : sub.rows[0].subenabled
          ? "streaming"
          : "stopped";

    return {
      subscriptionName: subName,
      subscribed: true,
      workerActive: sub.rows[0].subenabled,
      receivedLsn: sub.rows[0].received_lsn,
      latestEndLsn: sub.rows[0].latest_end_lsn,
      lagBytes,
      initialCopyProgress,
      state,
      perTable: tables,
    };
  } finally {
    await tgt.end();
  }
}

/* ── Monitoring (Neon recommended queries) ─────────────────── */

/** Verbatim from Neon docs, exposed in UI so users can paste into the
    Neon SQL editor for ad-hoc inspection. */
export const MONITOR_SQL = {
  subscriber: `SELECT sub.oid AS Subscription_ID, sub.subname AS Subscription_name,
       sub_rel.srrelid::regclass AS Table_name,
       CASE
           WHEN sub_rel.srsubstate = 'i' THEN 'Initialize'
           WHEN sub_rel.srsubstate = 'd' THEN 'Data being copied'
           WHEN sub_rel.srsubstate = 'f' THEN 'Finished table copy'
           WHEN sub_rel.srsubstate = 's' THEN 'Synchronized'
           WHEN sub_rel.srsubstate = 'r' THEN 'Ready'
       END AS Table_status,
       sub_rel.srsublsn AS Table_lsn
FROM pg_subscription_rel AS sub_rel
JOIN pg_subscription AS sub ON sub_rel.srsubid = sub.oid;`,
  publisher: `SELECT slot_name, confirmed_flush_lsn,
       pg_current_wal_lsn(),
       (pg_current_wal_lsn() - confirmed_flush_lsn) AS lsn_distance,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS lsn_distance_size
FROM pg_replication_slots;`,
};

function mapState(s: string): TableReplicationState {
  switch (s) {
    case "i":
      return "Initialize";
    case "d":
      return "Data being copied";
    case "f":
      return "Finished table copy";
    case "s":
      return "Synchronized";
    case "r":
      return "Ready";
    default:
      return "Unknown";
  }
}

export async function monitor(
  sourceConn: string,
  targetConn: string,
): Promise<ReplicationMonitor> {
  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    const sub = await tgt.query<{
      oid: string;
      subname: string;
      tablename: string;
      state: string;
      lsn: string | null;
    }>(
      `SELECT s.oid::text AS oid, s.subname,
              sr.srrelid::regclass::text AS tablename,
              sr.srsubstate AS state,
              sr.srsublsn::text AS lsn
       FROM pg_subscription_rel sr
       JOIN pg_subscription s ON s.oid = sr.srsubid
       ORDER BY s.subname, tablename`,
    );
    const subscriber: SubscriberMonitorRow[] = sub.rows.map((r) => ({
      subscriptionId: parseInt(r.oid, 10),
      subscriptionName: r.subname,
      tableName: r.tablename,
      tableStatus: mapState(r.state),
      tableLsn: r.lsn,
    }));

    const pub = await src.query<{
      slot_name: string;
      confirmed_flush_lsn: string;
      current_wal_lsn: string;
      lsn_distance: string;
      lsn_distance_size: string;
    }>(
      `SELECT slot_name,
              confirmed_flush_lsn::text AS confirmed_flush_lsn,
              pg_current_wal_lsn()::text AS current_wal_lsn,
              (pg_current_wal_lsn() - confirmed_flush_lsn)::text AS lsn_distance,
              pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS lsn_distance_size
       FROM pg_replication_slots
       ORDER BY slot_name`,
    );
    const publisher: PublisherMonitorRow[] = pub.rows.map((r) => ({
      slotName: r.slot_name,
      confirmedFlushLsn: r.confirmed_flush_lsn,
      currentWalLsn: r.current_wal_lsn,
      lsnDistance: parseInt(r.lsn_distance, 10) || 0,
      lsnDistanceSize: r.lsn_distance_size,
    }));

    const initialReplicationComplete =
      subscriber.length > 0 && subscriber.every((r) => r.tableStatus === "Ready");

    return {
      subscriber,
      publisher,
      initialReplicationComplete,
      sql: MONITOR_SQL,
    };
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
}

/* ── Teardown ──────────────────────────────────────────────── */

export async function teardown(
  sourceConn: string,
  targetConn: string,
  opts: { publicationName?: string; subscriptionName?: string } = {},
): Promise<{ droppedSubscription: boolean; droppedPublication: boolean }> {
  const pubName = opts.publicationName ?? DEFAULT_PUB;
  const subName = opts.subscriptionName ?? DEFAULT_SUB;

  let droppedSub = false;
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await tgt.connect();
  try {
    const exists = await tgt.query(
      "SELECT 1 FROM pg_subscription WHERE subname = $1",
      [subName],
    );
    if (exists.rows.length > 0) {
      // Disable & detach the slot first so it doesn't linger on the publisher
      await tgt.query(`ALTER SUBSCRIPTION "${subName}" DISABLE`);
      await tgt.query(`ALTER SUBSCRIPTION "${subName}" SET (slot_name = NONE)`);
      await tgt.query(`DROP SUBSCRIPTION "${subName}"`);
      droppedSub = true;
    }
  } finally {
    await tgt.end();
  }

  let droppedPub = false;
  const src = new Client({ connectionString: unpool(sourceConn) });
  await src.connect();
  try {
    const exists = await src.query(
      "SELECT 1 FROM pg_publication WHERE pubname = $1",
      [pubName],
    );
    if (exists.rows.length > 0) {
      await src.query(`DROP PUBLICATION "${pubName}"`);
      droppedPub = true;
    }
    // Also drop any orphan replication slot
    await src
      .query("SELECT pg_drop_replication_slot($1)", [subName])
      .catch(() => undefined);
  } finally {
    await src.end();
  }

  return { droppedSubscription: droppedSub, droppedPublication: droppedPub };
}
