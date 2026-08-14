import { NextRequest, NextResponse } from "next/server";
import { createProject } from "@/lib/neon-api";
import { MISSING_AUTH_ERROR } from "@/lib/neon-credentials";
import { getOAuthAccessTokenFromSession } from "@/lib/neon-oauth";
import {
  NEON_SUPPORTED_VERSIONS,
  type PgMajorVersion,
} from "@/lib/types";

/* POST /api/neon/create-target
   body: { name, pgVersion, regionId?, orgId? }
   Creates a new Neon project in the user's org at the target PG version.
   Returns project metadata only. Routes resolve connection URIs server-side
   from the project id when they need one.
*/
export async function POST(request: NextRequest) {
  let body: {
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

  const accessToken = await getOAuthAccessTokenFromSession();
  if (!accessToken) {
    return NextResponse.json({ error: MISSING_AUTH_ERROR }, { status: 401 });
  }
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (
    body.pgVersion !== undefined &&
    !NEON_SUPPORTED_VERSIONS.includes(body.pgVersion as PgMajorVersion)
  ) {
    return NextResponse.json(
      {
        error: `pgVersion must be one of: ${NEON_SUPPORTED_VERSIONS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const orgId =
    body.orgId ||
    (process.env.NODE_ENV !== "production"
      ? process.env.NEON_ORG_ID
      : undefined);

  try {
    const result = await createProject(accessToken, {
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
      consoleUrl: `https://console.neon.tech/app/projects/${result.project.id}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create project" },
      { status: 502 },
    );
  }
}
