import { NextResponse } from "next/server";
import { getProject } from "@/lib/neon-api";
import { resolveApiKey } from "@/lib/neon-credentials";

/* GET /api/neon/projects
   Returns the pre-configured source/target projects so the UI can render
   them in selectors without exposing credentials. pgVersion comes from the
   Neon API: without it the wizard has to guess the source major, and a
   wrong guess lets a no-op upgrade through validation.
*/

const versionCache = new Map<string, { pgVersion: number; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function pgVersionFor(projectId: string | undefined) {
  if (!projectId) return null;
  const cached = versionCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.pgVersion;
  const apiKey = resolveApiKey();
  if (!apiKey) return null;
  try {
    const { project } = await getProject(apiKey, projectId);
    versionCache.set(projectId, {
      pgVersion: project.pg_version,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return project.pg_version;
  } catch {
    return null;
  }
}

export async function GET() {
  const source = process.env.NEON_SOURCE_PROJECT_ID;
  const target = process.env.NEON_TARGET_PROJECT_ID;
  const [sourceVersion, targetVersion] = await Promise.all([
    pgVersionFor(source),
    pgVersionFor(target),
  ]);
  return NextResponse.json({
    orgName: process.env.NEON_ORG_NAME ?? null,
    orgId: process.env.NEON_ORG_ID ?? null,
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
