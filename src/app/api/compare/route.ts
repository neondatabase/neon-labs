// GET /api/compare — self-describing overview for humans + agents (the browsable
// landing for this contained tool). The heavy lifting is POST /api/compare/estimate.
import { CORS, corsPreflight } from "./cors";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

const OVERVIEW = `Neon cost & migration estimator (labs — Neon-only)

Estimate what a workload would cost on Neon, and get Supabase→Neon migration help.
Self-describing: an agent given this URL can do the rest.

POST /api/compare/estimate   — one endpoint; routes on the payload shape:

  Not on Neon yet (inferred → range + why-Neon + advisory validation):
    {"supabase":{"instance":"large","dbSizeGb":8,"avgCpuPct":15,"activity":"always_on","egressGb":40}}
    or {"workload":{...fields with value/confidence/source...}}

  Already on Neon (measured → precise):
    {"cuHours":92,"storageGb":0.4,"egressGb":3}
    or {"snapshot": <neon-usage current_period_snapshot>}
    or {"profile":[hourly CPU%],"instance":{"vcpu":2}}

  The response leads with recommendation (Free $0 when it fits), plus Launch/Scale,
  a range, a withoutAutoscaling baseline, and — for inferred inputs — an advisory
  validation check.

GET  /api/compare/guide      — the full read-only Supabase→Neon extraction + cost +
                            feature-fit + migration playbook (for agents).

Estimates only, not invoices.
`;

export async function GET() {
  return new Response(OVERVIEW, {
    headers: { "content-type": "text/plain; charset=utf-8", ...NO_STORE, ...CORS },
  });
}

export function OPTIONS() {
  return corsPreflight();
}
