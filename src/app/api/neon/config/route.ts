import { NextResponse } from "next/server";
import { getOrganization } from "@/lib/neon-api";
import { resolveApiKey, resolveConnections } from "@/lib/neon-credentials";

/* GET /api/neon/config
   Returns the org/project context that's pre-configured in .env.local
   so the UI can show "Connected to: Savannah / Neon-Test → Neon-Test-PG17"
   without exposing the connection strings themselves.

   Presence flags only. Secrets (API key, connection strings) are never
   serialised into this response.
*/

let cachedOrg: { id: string; name: string } | null = null;

async function resolveOrgName(orgId: string | null) {
  if (process.env.NEON_ORG_NAME) return process.env.NEON_ORG_NAME;
  if (!orgId) return null;
  if (cachedOrg?.id === orgId) return cachedOrg.name;

  const apiKey = resolveApiKey();
  if (!apiKey) return null;

  try {
    const org = await getOrganization(apiKey, orgId);
    cachedOrg = { id: orgId, name: org.name };
    return org.name;
  } catch {
    return null;
  }
}

export async function GET() {
  const source = process.env.NEON_SOURCE_CONNECTION_STRING;
  const orgId = process.env.NEON_ORG_ID || null;
  const resolved = await resolveConnections();

  return NextResponse.json({
    sourceIsPooled: Boolean(source && /-pooler\./.test(source)),
    orgId,
    orgName: await resolveOrgName(orgId),
    sourceProjectId: process.env.NEON_SOURCE_PROJECT_ID ?? null,
    targetProjectId: process.env.NEON_TARGET_PROJECT_ID ?? null,
    hasSourceConnection: Boolean(resolved.source),
    hasTargetConnection: Boolean(resolved.target),
    hasApiKey: Boolean(process.env.NEON_API_KEY),
  });
}
