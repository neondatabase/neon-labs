import { NextResponse } from "next/server";
import { getProject } from "@/lib/neon-api";
import { getOAuthAccessTokenFromSession } from "@/lib/neon-oauth";

/* GET /api/neon/projects
   Returns the pre-configured source/target projects so the UI can render
   them in selectors without exposing credentials. pgVersion comes from the
   Neon API: without it the wizard has to guess the source major, and a
   wrong guess lets a no-op upgrade through validation.
*/

async function pgVersionFor(projectId: string | undefined) {
  if (!projectId) return null;
  const accessToken = await getOAuthAccessTokenFromSession();
  if (!accessToken) return null;
  try {
    const { project } = await getProject(accessToken, projectId);
    return project.pg_version;
  } catch {
    return null;
  }
}

export async function GET() {
  const source =
    process.env.NODE_ENV !== "production"
      ? process.env.NEON_SOURCE_PROJECT_ID
      : undefined;
  const target =
    process.env.NODE_ENV !== "production"
      ? process.env.NEON_TARGET_PROJECT_ID
      : undefined;
  const [sourceVersion, targetVersion] = await Promise.all([
    pgVersionFor(source),
    pgVersionFor(target),
  ]);
  return NextResponse.json({
    orgName:
      process.env.NODE_ENV !== "production"
        ? (process.env.NEON_ORG_NAME ?? null)
        : null,
    orgId:
      process.env.NODE_ENV !== "production"
        ? (process.env.NEON_ORG_ID ?? null)
        : null,
    projects: [
      source && {
        id: source,
        role: "source",
        pgVersion: sourceVersion,
        hasConnection: Boolean(process.env.NEON_SOURCE_CONNECTION_STRING),
      },
      target && {
        id: target,
        role: "target",
        pgVersion: targetVersion,
        hasConnection: Boolean(process.env.NEON_TARGET_CONNECTION_STRING),
      },
    ].filter(Boolean),
  });
}
