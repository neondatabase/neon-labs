/* ──────────────────────────────────────────────────────────────
   pg_dump → pg_restore migration path.
   Offers two execution modes:
     1. Generate the exact CLI commands the user runs from their shell
        (full pg_dump fidelity, recommended for production).
     2. Server-side schema copy + COPY-based data copy (best-effort,
        useful for small DBs and demos within the app itself).
   ────────────────────────────────────────────────────────────── */

import { Client } from "pg";
import type {
  DumpRestorePreflight,
  DumpRestoreResult,
  DumpRestoreStep,
  RowCountCheck,
} from "./types";

function unpool(conn: string): string {
  return conn.replace(/-pooler/g, "");
}

/** Mask the password in a connection string for safe display. */
export function maskConn(conn: string): string {
  return conn.replace(/:([^:@]+)@/, ":••••••@");
}

function parsePgVersion(s: string): number {
  return Math.floor(parseInt(s, 10) / 10000);
}

/* ── Preflight + command generation ───────────────────────── */

export async function preflight(
  sourceConn: string,
  targetConn: string,
): Promise<DumpRestorePreflight> {
  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    const srcMeta = await src.query<{
      num: string;
      db: string;
      size: string;
    }>(
      "SELECT current_setting('server_version_num') AS num, current_database() AS db, pg_database_size(current_database())::text AS size",
    );
    const tgtMeta = await tgt.query<{ num: string; db: string }>(
      "SELECT current_setting('server_version_num') AS num, current_database() AS db",
    );
    const srcTables = await src.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const tgtTables = await tgt.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const srcExts = await src.query<{ extname: string; extversion: string }>(
      "SELECT extname, extversion FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname",
    );

    const sourcePg = parsePgVersion(srcMeta.rows[0].num);
    const targetPg = parsePgVersion(tgtMeta.rows[0].num);
    const tableCount = parseInt(srcTables.rows[0].n, 10);
    const existingTableCount = parseInt(tgtTables.rows[0].n, 10);
    const extensions = srcExts.rows.map((e) => `${e.extname}=${e.extversion}`);

    // Generated commands, use the unpooled hosts (logical replication and
    // pg_dump both want direct compute connections, not the pooler).
    const srcConn = unpool(sourceConn);
    const tgtConn = unpool(targetConn);
    const schemaFile = "schema.sql";
    const dataFile = "data.dump";
    // Use the *target* PG version's pg_dump client when possible, it can
    // read older catalogs and emit DDL the target understands.
    const verHint = `# Run from a machine with PostgreSQL ${targetPg} client tools (pg_dump ≥ ${targetPg}).`;

    const generatedCommands = {
      schemaDump: `${verHint}
pg_dump \\
  --schema-only \\
  --no-owner --no-privileges \\
  --file=${schemaFile} \\
  "${srcConn}"`,
      dataDump: `pg_dump \\
  --data-only \\
  --format=custom \\
  --jobs=4 \\
  --no-owner --no-privileges \\
  --file=${dataFile} \\
  "${srcConn}"`,
      schemaRestore: `psql "${tgtConn}" < ${schemaFile}`,
      dataRestore: `pg_restore \\
  --data-only \\
  --jobs=4 \\
  --no-owner --no-privileges \\
  --dbname="${tgtConn}" \\
  ${dataFile}`,
      pipelined: `# Single-shot pipeline (smaller DBs only, no parallelism):
pg_dump --no-owner --no-privileges "${srcConn}" | psql "${tgtConn}"`,
    };

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (targetPg < sourcePg) {
      blockers.push(
        `Target PG${targetPg} is older than source PG${sourcePg}, pg_restore won't work in this direction.`,
      );
    }
    if (existingTableCount > 0) {
      warnings.push(
        `Target already has ${existingTableCount} table(s). Restoring will fail unless they are dropped or restore is run with --clean.`,
      );
    }
    if (tableCount === 0) {
      blockers.push("Source has no tables in public schema.");
    }

    return {
      ok: blockers.length === 0,
      blockers,
      warnings,
      source: {
        pgVersion: sourcePg,
        database: srcMeta.rows[0].db,
        tableCount,
        estimatedSizeBytes: parseInt(srcMeta.rows[0].size, 10),
        extensions,
      },
      target: {
        pgVersion: targetPg,
        database: tgtMeta.rows[0].db,
        isEmpty: existingTableCount === 0,
        existingTableCount,
      },
      generatedCommands,
    };
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
}

/* ── Server-side execute (best-effort, in-app) ─────────────── */

/** Copy schema + data table-by-table using SQL only. For small databases
    or demos. Production users should use the generated pg_dump commands. */
export async function execute(
  sourceConn: string,
  targetConn: string,
): Promise<DumpRestoreResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const steps: DumpRestoreStep[] = [];

  async function runStep<T>(
    id: string,
    label: string,
    fn: () => Promise<{ detail?: string; rowsCopied?: number; result: T } | T>,
  ): Promise<T> {
    const step: DumpRestoreStep = { id, label, status: "running" };
    steps.push(step);
    const t0 = Date.now();
    try {
      const out = await fn();
      const wrapped =
        typeof out === "object" && out !== null && "result" in (out as object);
      const result = wrapped
        ? (out as { result: T }).result
        : (out as T);
      const detail = wrapped ? (out as { detail?: string }).detail : undefined;
      const rowsCopied = wrapped
        ? (out as { rowsCopied?: number }).rowsCopied
        : undefined;
      step.status = "ok";
      step.detail = detail;
      step.rowsCopied = rowsCopied;
      step.durationMs = Date.now() - t0;
      return result;
    } catch (e) {
      step.status = "failed";
      step.detail = e instanceof Error ? e.message : String(e);
      step.durationMs = Date.now() - t0;
      throw e;
    }
  }

  // Reuse the same schema-copy logic that powers replication setup. We need
  // sequences first, then tables, then indexes, to satisfy column defaults
  // that reference sequences.
  const { setupSchemaOnly } = await import("./neon-dump-restore-schema");
  const schemaReport = await runStep("schema", "Copy schema", async () => {
    const r = await setupSchemaOnly(sourceConn, targetConn);
    return {
      result: r,
      detail: `${r.tablesCreated.length} tables · ${r.indexesCreated} indexes · ${r.extensionsCreated.length} extensions`,
    };
  });

  // Get table list from source for data copy
  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  let tables: string[] = [];
  let totalRows = 0;
  let totalBytes = 0;
  const rowCounts: RowCountCheck[] = [];
  try {
    const t = await src.query<{ table: string }>(
      `SELECT c.relname AS table FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r' AND n.nspname = 'public'
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
       ORDER BY c.relname`,
    );
    tables = t.rows.map((r) => r.table);
    const sizeRes = await src.query<{ size: string }>(
      "SELECT pg_database_size(current_database())::text AS size",
    );
    totalBytes = parseInt(sizeRes.rows[0].size, 10);

    for (const table of tables) {
      await runStep(`copy:${table}`, `Copy ${table}`, async () => {
        // Stream rows from source → target. For small/medium tables this is
        // fine; for huge tables you really want pg_dump | pg_restore.
        const src2 = new Client({ connectionString: unpool(sourceConn) });
        const tgt2 = new Client({ connectionString: unpool(targetConn) });
        await Promise.all([src2.connect(), tgt2.connect()]);
        let copied = 0;
        try {
          const rows = await src2.query(
            `SELECT * FROM "public"."${table}"`,
          );
          if (rows.rows.length === 0)
            return { result: 0, detail: "empty", rowsCopied: 0 };

          const cols = rows.fields.map((f) => f.name);
          const colList = cols.map((c) => `"${c}"`).join(", ");
          // Batch inserts of 500 rows
          const BATCH = 500;
          for (let i = 0; i < rows.rows.length; i += BATCH) {
            const slice = rows.rows.slice(i, i + BATCH);
            const placeholders: string[] = [];
            const values: unknown[] = [];
            slice.forEach((row, ri) => {
              const rowPh = cols
                .map((_, ci) => `$${ri * cols.length + ci + 1}`)
                .join(", ");
              placeholders.push(`(${rowPh})`);
              for (const c of cols) values.push(row[c]);
            });
            await tgt2.query(
              `INSERT INTO "public"."${table}" (${colList}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
              values,
            );
            copied += slice.length;
          }
          totalRows += copied;
          return {
            result: copied,
            detail: `${copied.toLocaleString()} rows`,
            rowsCopied: copied,
          };
        } finally {
          await Promise.all([
            src2.end().catch(() => undefined),
            tgt2.end().catch(() => undefined),
          ]);
        }
      });
    }

    // Reset sequences to max(col) + 1 after data copy so PKs continue
    // monotonically.
    await runStep("sequences", "Reset target sequences", async () => {
      const seqs = await tgt.query<{
        seq: string;
        tbl: string;
        col: string;
      }>(`
        SELECT n.nspname || '.' || c.relname AS seq,
               ot.relname AS tbl, oa.attname AS col
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype IN ('a','i')
        LEFT JOIN pg_class ot ON ot.oid = d.refobjid
        LEFT JOIN pg_attribute oa ON oa.attrelid = d.refobjid AND oa.attnum = d.refobjsubid
        WHERE c.relkind = 'S' AND n.nspname = 'public' AND ot.relname IS NOT NULL
      `);
      let reset = 0;
      for (const s of seqs.rows) {
        try {
          await tgt.query(
            `SELECT setval($1::regclass, COALESCE((SELECT max("${s.col}") FROM "public"."${s.tbl}"), 1), true)`,
            [s.seq],
          );
          reset++;
        } catch {
          /* skip non-numeric or missing columns */
        }
      }
      return { result: reset, detail: `${reset} sequence(s) reset` };
    });

    // Verify
    await runStep("verify", "Verify row counts", async () => {
      for (const table of tables) {
        const [srcRes, tgtRes] = await Promise.all([
          src
            .query<{ n: string }>(`SELECT count(*)::text AS n FROM "public"."${table}"`)
            .catch(() => null),
          tgt
            .query<{ n: string }>(`SELECT count(*)::text AS n FROM "public"."${table}"`)
            .catch(() => null),
        ]);
        if (!srcRes || !tgtRes) continue;
        const sr = parseInt(srcRes.rows[0].n, 10);
        const tr = parseInt(tgtRes.rows[0].n, 10);
        rowCounts.push({
          table: `public.${table}`,
          sourceRows: sr,
          targetRows: tr,
          delta: sr - tr,
          match: sr === tr,
        });
      }
      const mismatches = rowCounts.filter((r) => !r.match);
      return {
        result: mismatches.length,
        detail:
          mismatches.length === 0
            ? `all ${rowCounts.length} tables match`
            : `${mismatches.length} mismatched`,
      };
    });
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }

  void schemaReport;
  const completedAt = new Date().toISOString();
  return {
    startedAt,
    completedAt,
    totalDurationMs: Date.now() - start,
    steps,
    rowCounts,
    totalRowsCopied: totalRows,
    totalBytesEstimate: totalBytes,
  };
}
