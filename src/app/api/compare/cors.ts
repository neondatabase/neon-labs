// Shared response headers for the /api/compare/* endpoints. These are a public,
// read-only, credential-free API meant to be called from anywhere (agents, other
// origins, tooling) — so we allow CORS from any origin. No cookies/credentials are
// involved, so `*` is safe here.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

// Estimates aren't cacheable per-user state; keep them private + uncached.
export const RESPONSE_HEADERS = { ...CORS, "Cache-Control": "private, no-store, max-age=0" };

// Preflight for cross-origin POST (application/json trips a preflight).
export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}
