import { resolveConnectionUri } from "@/lib/neon-api";
import { getOAuthAccessTokenFromSession } from "@/lib/neon-oauth";

export const MISSING_AUTH_ERROR =
  "Sign in with Neon to access projects and connection details.";

export const MISSING_CONNECTIONS_ERROR =
  "Could not resolve database connections. Sign in with Neon and pick the required projects.";

async function connectionUriForProject(
  accessToken: string,
  projectId: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      /* Do not cache database credentials in application memory. Resolve them
         only for the request that needs them. */
      return await resolveConnectionUri(accessToken, projectId);
    } catch {
      if (attempt === 2) return null;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  return null;
}

export interface ConnectionOverrides {
  sourceConnectionString?: string | null;
  sourceProjectId?: string | null;
  targetConnectionString?: string | null;
  targetProjectId?: string | null;
}

export interface ResolvedConnections {
  source: string | null;
  target: string | null;
}

/** Resolves each side in order: explicit override, env var, then the Neon API
    using the project id. */
export async function resolveConnections(
  overrides: ConnectionOverrides = {},
): Promise<ResolvedConnections> {
  /* Hosted requests may select projects only by id. Accepting arbitrary
     connection strings would turn these routes into an SSRF surface. Direct
     strings remain available for local development only. */
  const allowDirectConnections = process.env.NODE_ENV !== "production";
  const source =
    (allowDirectConnections &&
      (overrides.sourceConnectionString?.trim() ||
        process.env.NEON_SOURCE_CONNECTION_STRING)) ||
    null;
  const target =
    (allowDirectConnections &&
      (overrides.targetConnectionString?.trim() ||
        process.env.NEON_TARGET_CONNECTION_STRING)) ||
    null;
  if (source && target) return { source, target };

  const accessToken = await getOAuthAccessTokenFromSession();
  if (!accessToken) return { source, target };

  const sourceProjectId =
    overrides.sourceProjectId?.trim() ||
    (allowDirectConnections ? process.env.NEON_SOURCE_PROJECT_ID : undefined);
  const targetProjectId =
    overrides.targetProjectId?.trim() ||
    (allowDirectConnections ? process.env.NEON_TARGET_PROJECT_ID : undefined);

  const [resolvedSource, resolvedTarget] = await Promise.all([
    source
      ? Promise.resolve(source)
      : sourceProjectId
        ? connectionUriForProject(accessToken, sourceProjectId)
        : Promise.resolve(null),
    target
      ? Promise.resolve(target)
      : targetProjectId
        ? connectionUriForProject(accessToken, targetProjectId)
        : Promise.resolve(null),
  ]);

  return { source: resolvedSource, target: resolvedTarget };
}
