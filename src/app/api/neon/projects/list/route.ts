import { NextRequest, NextResponse } from "next/server";
import { listProjectsAcrossOrgs } from "@/lib/neon-api";
import { MISSING_API_KEY_ERROR, resolveApiKey } from "@/lib/neon-credentials";

/* POST /api/neon/projects/list
   body: { apiKey, orgId?, excludeProjectId? }
   Returns projects grouped by organization for the multi-org picker. */
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
    const result = await listProjectsAcrossOrgs(apiKey, { orgId, limit: 100 });
    const organizations = result.organizations.map((group) => ({
      id: group.organization.id,
      name: group.organization.name,
      projects: group.projects
        .filter((project) => project.id !== body.excludeProjectId)
        .map((project) => ({
          id: project.id,
          name: project.name,
          pg_version: project.pg_version,
          region_id: project.region_id,
          org_id: project.org_id ?? group.organization.id,
          org_name: group.organization.name,
        })),
    }));
    return NextResponse.json({
      organizations,
      failedOrganizations: result.failedOrganizations,
      projects: organizations.flatMap((organization) => organization.projects),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "List failed" },
      { status: 502 },
    );
  }
}
