/* ──────────────────────────────────────────────────────────────
   Cross-project / cross-branch schema diff via the Neon SQL API.
   Uses information_schema + pg_catalog introspection so it works
   even across major PG versions where pg_dump output may differ.
   ────────────────────────────────────────────────────────────── */

import type { SchemaDiffEntry, SchemaDiffOp } from "./types";
import { Client } from "pg";

interface SchemaSnapshot {
  tables: Map<string, { columns: Map<string, string> }>; // schema.table → cols
  indexes: Set<string>; // schema.table.index
  extensions: Map<string, string>; // name → version
  views: Set<string>;
  functions: Set<string>;
}

async function snapshot(connectionString: string): Promise<SchemaSnapshot> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const tables = new Map<string, { columns: Map<string, string> }>();
    const tablesRes = await client.query<{
      schema: string;
      table: string;
      column: string;
      data_type: string;
    }>(`
      SELECT
        c.table_schema AS schema,
        c.table_name   AS table,
        c.column_name  AS column,
        c.data_type    AS data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
    `);
    for (const row of tablesRes.rows) {
      const key = `${row.schema}.${row.table}`;
      if (!tables.has(key)) tables.set(key, { columns: new Map() });
      tables.get(key)!.columns.set(row.column, row.data_type);
    }

    const indexesRes = await client.query<{
      schemaname: string;
      tablename: string;
      indexname: string;
    }>(`
      SELECT schemaname, tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
    `);
    const indexes = new Set(
      indexesRes.rows.map(
        (r) => `${r.schemaname}.${r.tablename}.${r.indexname}`,
      ),
    );

    const extRes = await client.query<{ name: string; version: string }>(`
      SELECT extname AS name, extversion AS version FROM pg_extension
      WHERE extname NOT IN ('plpgsql')
    `);
    const extensions = new Map(extRes.rows.map((r) => [r.name, r.version]));

    const viewsRes = await client.query<{ schema: string; view: string }>(`
      SELECT table_schema AS schema, table_name AS view
      FROM information_schema.views
      WHERE table_schema = 'public'
    `);
    const views = new Set(viewsRes.rows.map((r) => `${r.schema}.${r.view}`));

    const fnRes = await client.query<{ schema: string; name: string }>(`
      SELECT n.nspname AS schema, p.proname AS name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
        AND p.proname NOT IN (
          SELECT p2.proname FROM pg_depend d
          JOIN pg_proc p2 ON p2.oid = d.objid
          JOIN pg_extension e ON e.oid = d.refobjid
        )
    `);
    const functions = new Set(fnRes.rows.map((r) => `${r.schema}.${r.name}`));

    return { tables, indexes, extensions, views, functions };
  } finally {
    await client.end();
  }
}

export async function diffSchemas(
  sourceConn: string,
  targetConn: string,
): Promise<SchemaDiffEntry[]> {
  const [a, b] = await Promise.all([snapshot(sourceConn), snapshot(targetConn)]);
  const diff: SchemaDiffEntry[] = [];

  const add = (
    kind: SchemaDiffEntry["kind"],
    op: SchemaDiffOp,
    identifier: string,
    detail?: string,
  ) => diff.push({ kind, op, identifier, detail });

  for (const name of a.tables.keys()) {
    if (!b.tables.has(name)) add("table", "removed", name);
  }
  for (const [name, def] of b.tables) {
    const aDef = a.tables.get(name);
    if (!aDef) {
      add("table", "added", name);
      continue;
    }
    for (const col of aDef.columns.keys()) {
      if (!def.columns.has(col)) add("column", "removed", `${name}.${col}`);
    }
    for (const [col, type] of def.columns) {
      const aType = aDef.columns.get(col);
      if (aType === undefined) {
        add("column", "added", `${name}.${col}`, `type: ${type}`);
      } else if (aType !== type) {
        add("column", "changed", `${name}.${col}`, `${aType} → ${type}`);
      }
    }
  }

  for (const ix of a.indexes) if (!b.indexes.has(ix)) add("index", "removed", ix);
  for (const ix of b.indexes) if (!a.indexes.has(ix)) add("index", "added", ix);

  for (const [ext, ver] of a.extensions) {
    const bVer = b.extensions.get(ext);
    if (bVer === undefined) add("extension", "removed", ext, `was ${ver}`);
    else if (bVer !== ver) add("extension", "changed", ext, `${ver} → ${bVer}`);
  }
  for (const [ext, ver] of b.extensions) {
    if (!a.extensions.has(ext)) add("extension", "added", ext, `version ${ver}`);
  }

  for (const v of a.views) if (!b.views.has(v)) add("view", "removed", v);
  for (const v of b.views) if (!a.views.has(v)) add("view", "added", v);

  for (const fn of a.functions) if (!b.functions.has(fn)) add("function", "removed", fn);
  for (const fn of b.functions) if (!a.functions.has(fn)) add("function", "added", fn);

  return diff;
}
