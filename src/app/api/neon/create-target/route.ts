import { NextRequest, NextResponse } from "next/server";
import { createProject } from "@/lib/neon-api";
import { MISSING_API_KEY_ERROR, resolveApiKey } from "@/lib/neon-credentials";

/* POST /api/neon/create-target
   body: { apiKey, name, pgVersion, regionId?, orgId? }
   Creates a new Neon project in the user's org at the target PG version.
   Returns project metadata + the read-write connection string.
*/
export async function POST(request: NextRequest) {
  let body: {
    apiKey?: string;
    name?: string;
    pgVersion?: number;
    regionId?: string;
    orgId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = resolveApiKey(body.apiKey);
  if (!apiKey) {
    return NextResponse.json({ error: MISSING_API_KEY_ERROR }, { status: 400 });
  }
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const orgId = body.orgId || process.env.NEON_ORG_ID || undefined;

  try {
    const result = await createProject(apiKey, {
      name: body.name,
      pgVersion: body.pgVersion,
      regionId: body.regionId,
      orgId,
    });

    return NextResponse.json({
      project: {
        id: result.project.id,
        name: result.project.name,
        pg_version: result.project.pg_version,
        region_id: result.project.region_id,
        org_id: result.project.org_id,
      },
      branch: result.branch,
      endpointHost: result.endpoints?.[0]?.host ?? null,
      connectionUri: result.connection_uris?.[0]?.connection_uri ?? null,
      consoleUrl: `https://console.neon.tech/app/projects/${result.project.id}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create project" },
      { status: 502 },
    );
  }
}
