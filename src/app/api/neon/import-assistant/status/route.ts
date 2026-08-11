import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { Client } from "pg";
import type { ImportAssistantStatus } from "@/lib/types";

/* POST /api/neon/import-assistant/status
   body: { targetConnectionString?, projectId? }
   Polls the target Neon project to detect whether the Import Data Assistant
   has finished populating tables/rows. Returns per-table row counts and a
   deep-link back to the Neon Console import page.

   POST rather than GET because the target connection string carries a
   password, and query strings get written to access logs and browser history.
*/
export async function POST(request: NextRequest) {
  let body: { targetConnectionString?: string; projectId?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* allow empty */
  }
  const { target } = await resolveConnections(body);
  const projectId = body.projectId || process.env.NEON_TARGET_PROJECT_ID;
  if (!target || !projectId) {
    return NextResponse.json(
      { error: "No target or projectId configured" },
      { status: 400 },
    );
  }

  const client = new Client({
    connectionString: target.replace(/-pooler/g, ""),
  });
  try {
    await client.connect();
    const tables = await client.query<{ table: string; rows: string }>(`
      SELECT n.nspname || '.' || c.relname AS table,
             c.reltuples::bigint::text AS rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
      ORDER BY c.relname
    `);
    const rowCountsByTable = tables.rows.map((r) => ({
      table: r.table,
      rows: parseInt(r.rows, 10),
    }));
    const totalRows = rowCountsByTable.reduce((s, r) => s + r.rows, 0);
    const result: ImportAssistantStatus = {
      projectId,
      tableCount: rowCountsByTable.length,
      rowCountsByTable,
      totalRows,
      importStarted: rowCountsByTable.length > 0,
      importComplete: totalRows > 0,
      consoleUrl: `https://console.neon.tech/app/projects/${projectId}/import`,
    };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Status failed" },
      { status: 502 },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
