import { NextRequest, NextResponse } from "next/server";
import { listProjectsAcrossOrgs } from "@/lib/neon-api";
import { MISSING_AUTH_ERROR } from "@/lib/neon-credentials";
import { getOAuthAccessTokenFromSession } from "@/lib/neon-oauth";

/* POST /api/neon/projects/list
   body: { orgId?, role? }
   Returns the full list of projects in the org. `role` is optional metadata
   to mark which one is currently the source (excluded from picker).
*/
export async function POST(request: NextRequest) {
  let body: { orgId?: string; excludeProjectId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const accessToken = await getOAuthAccessTokenFromSession();
  if (!accessToken) {
    return NextResponse.json({ error: MISSING_AUTH_ERROR }, { status: 401 });
  }
  const orgId = body.orgId || process.env.NEON_ORG_ID || undefined;
  try {
    const result = await listProjectsAcrossOrgs(accessToken, {
      orgId,
      limit: 100,
    });
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
