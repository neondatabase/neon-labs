/* Schema-only copy from source to target. Extracted from neon-replication so
   the dump-restore tool can reuse it without circular imports. */

import { Client } from "pg";

function unpool(conn: string): string {
  return conn.replace(/-pooler/g, "");
}

export interface SchemaCopyReport {
  extensionsCreated: string[];
  extensionsFailed: { name: string; error: string }[];
  sequencesCreated: string[];
  tablesCreated: string[];
  tablesSkipped: string[];
  tablesFailed: { name: string; error: string; ddl: string }[];
  indexesCreated: number;
  indexesFailed: { name: string; error: string }[];
}

export async function setupSchemaOnly(
  sourceConn: string,
  targetConn: string,
): Promise<SchemaCopyReport> {
  const report: SchemaCopyReport = {
    extensionsCreated: [],
    extensionsFailed: [],
    sequencesCreated: [],
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

    const sequences = await src.query<{ schema: string; seq: string }>(`
      SELECT n.nspname AS schema, c.relname AS seq
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'S' AND n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
      ORDER BY c.relname
    `);
    for (const s of sequences.rows) {
      try {
        await tgt.query(`CREATE SEQUENCE IF NOT EXISTS "${s.schema}"."${s.seq}"`);
        report.sequencesCreated.push(`${s.schema}.${s.seq}`);
      } catch (err) {
        report.tablesFailed.push({
          name: `${s.schema}.${s.seq} (sequence)`,
          error: err instanceof Error ? err.message : String(err),
          ddl: `CREATE SEQUENCE "${s.schema}"."${s.seq}"`,
        });
      }
    }

    const tables = await src.query<{ schema: string; table: string }>(`
      SELECT n.nspname AS schema, c.relname AS table
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
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
      const cols = await src.query<{
        attname: string;
        formatted_type: string;
        attnotnull: boolean;
        column_default: string | null;
      }>(
        `SELECT a.attname,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
                a.attnotnull,
                pg_get_expr(ad.adbin, ad.adrelid) AS column_default
         FROM pg_attribute a
         LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
         WHERE a.attrelid = ($1 || '.' || $2)::regclass
           AND a.attnum > 0 AND NOT a.attisdropped
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

    const indexes = await src.query<{ indexname: string; indexdef: string }>(`
      SELECT i.indexrelid::regclass::text AS indexname,
             pg_get_indexdef(i.indexrelid) AS indexdef
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT i.indisprimary AND NOT i.indisunique
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = i.indexrelid AND d.deptype = 'e')
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
