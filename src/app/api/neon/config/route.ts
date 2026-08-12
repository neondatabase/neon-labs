import { NextResponse } from "next/server";
import { getOrganization } from "@/lib/neon-api";
import { resolveConnections } from "@/lib/neon-credentials";
import {
  getAuthenticationStatus,
  getOAuthAccessTokenFromSession,
} from "@/lib/neon-oauth";

/* GET /api/neon/config
   Returns authentication and non-secret project context for the UI.

   Presence flags only. Secrets (OAuth tokens, connection strings) are never
   serialised into this response.
*/

async function resolveOrgName(orgId: string | null) {
  if (process.env.NODE_ENV !== "production" && process.env.NEON_ORG_NAME) {
    return process.env.NEON_ORG_NAME;
  }
  if (!orgId) return null;

  const accessToken = await getOAuthAccessTokenFromSession();
  if (!accessToken) return null;

  try {
    const org = await getOrganization(accessToken, orgId);
    return org.name;
  } catch {
    return null;
  }
}

export async function GET() {
  const localDevelopment = process.env.NODE_ENV !== "production";
  const source = localDevelopment
    ? process.env.NEON_SOURCE_CONNECTION_STRING
    : undefined;
  const orgId = localDevelopment ? process.env.NEON_ORG_ID || null : null;
  const auth = await getAuthenticationStatus();
  const resolved = await resolveConnections();

  return NextResponse.json({
    sourceIsPooled: Boolean(source && /-pooler\./.test(source)),
    orgId,
    orgName: (await resolveOrgName(orgId)) ?? (auth.authenticated ? "Neon" : null),
    sourceProjectId: localDevelopment
      ? (process.env.NEON_SOURCE_PROJECT_ID ?? null)
      : null,
    targetProjectId: localDevelopment
      ? (process.env.NEON_TARGET_PROJECT_ID ?? null)
      : null,
    hasSourceConnection: Boolean(resolved.source),
    hasTargetConnection: Boolean(resolved.target),
    authenticated: auth.authenticated,
    oauthConfigured: auth.oauthConfigured,
    developmentFallback: auth.developmentFallback,
  });
}
