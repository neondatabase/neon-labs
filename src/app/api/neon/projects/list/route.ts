import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "@/lib/neon-api";
import { MISSING_API_KEY_ERROR, resolveApiKey } from "@/lib/neon-credentials";

/* POST /api/neon/projects/list
   body: { apiKey, orgId?, role? }
   Returns the full list of projects in the org. `role` is optional metadata
   to mark which one is currently the source (excluded from picker).
*/
export async function POST(request: NextRequest) {
  let body: { apiKey?: string; orgId?: string; excludeProjectId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const apiKey = resolveApiKey(body.apiKey);
  if (!apiKey) {
    return NextResponse.json({ error: MISSING_API_KEY_ERROR }, { status: 400 });
  }
  const orgId = body.orgId || process.env.NEON_ORG_ID || undefined;
  try {
    const result = await listProjects(apiKey, { orgId, limit: 100 });
    const projects = result.projects
      .filter((p) => p.id !== body.excludeProjectId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        pg_version: p.pg_version,
        region_id: p.region_id,
        org_id: p.org_id,
      }));
    return NextResponse.json({ projects });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "List failed" },
      { status: 502 },
    );
  }
}
