import { resolveConnectionUri } from "@/lib/neon-api";

export function resolveApiKey(fromBody?: string | null): string | null {
  const env = process.env.NEON_API_KEY?.trim();
  if (env) return env;
  const body = fromBody?.trim();
  return body ? body : null;
}

export const MISSING_API_KEY_ERROR =
  "No Neon API key. Set NEON_API_KEY in .env.local and restart the server, or add one under Neon connection settings.";

export const MISSING_CONNECTIONS_ERROR =
  "Could not resolve connection strings. Set NEON_API_KEY in .env.local so the app can fetch them, pick source and target projects in the app, or set NEON_SOURCE_CONNECTION_STRING and NEON_TARGET_CONNECTION_STRING directly.";

/* A connection URI carries the role password, so it never leaves the server.
   Entries expire because Neon rotates credentials on role password reset. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const uriCache = new Map<string, { uri: string; expiresAt: number }>();

async function connectionUriForProject(apiKey: string, projectId: string) {
  const cached = uriCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.uri;
  try {
    const uri = await resolveConnectionUri(apiKey, projectId);
    uriCache.set(projectId, { uri, expiresAt: Date.now() + CACHE_TTL_MS });
    return uri;
  } catch {
    return null;
  }
}

export interface ConnectionOverrides {
  apiKey?: string | null;
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
  const source =
    overrides.sourceConnectionString?.trim() ||
    process.env.NEON_SOURCE_CONNECTION_STRING ||
    null;
  const target =
    overrides.targetConnectionString?.trim() ||
    process.env.NEON_TARGET_CONNECTION_STRING ||
    null;
  if (source && target) return { source, target };

  const apiKey = resolveApiKey(overrides.apiKey);
  if (!apiKey) return { source, target };

  const sourceProjectId =
    overrides.sourceProjectId?.trim() || process.env.NEON_SOURCE_PROJECT_ID;
  const targetProjectId =
    overrides.targetProjectId?.trim() || process.env.NEON_TARGET_PROJECT_ID;

  const [resolvedSource, resolvedTarget] = await Promise.all([
    source
      ? Promise.resolve(source)
      : sourceProjectId
        ? connectionUriForProject(apiKey, sourceProjectId)
        : Promise.resolve(null),
    target
      ? Promise.resolve(target)
      : targetProjectId
        ? connectionUriForProject(apiKey, targetProjectId)
        : Promise.resolve(null),
  ]);

  return { source: resolvedSource, target: resolvedTarget };
}
