// The single "what would Neon cost?" router, shared by the REST endpoint
// (api.mjs) and the MCP tool (mcp.mjs) so the two surfaces can't drift. Routes on
// the payload SHAPE — no wrong door:
//   - measured Neon usage ({snapshot} | {cuHours} | {profile,instance}) → precise, no check
//   - inferred workload ({supabase} | {workload}) → estimate + an ADVISORY plausibility
//     check (rules + LLM) attached as `validation`; never alters the price.
import {
  analyzeFreeToLaunch,
  analyzeWorkload,
  analyzeFromSnapshot,
  analyzeSupabase,
  normalizeWorkload,
} from "./analyze.mjs";
import { validateWorkload } from "./validate.mjs";
import { priceVendorPlan } from "./compare.mjs";

export async function estimateRequest(body = {}) {
  // Direct vendor pricing: price a KNOWN vendor plan/instance (no extraction, no
  // validation). e.g. {vendor:"supabase", plan:"pro", instance:"large", storageGb}.
  if (body.vendor) return priceVendorPlan(body);
  if (body.snapshot) return analyzeFromSnapshot(body.snapshot);
  if (body.cuHours != null || (body.profile && body.instance)) return analyzeFreeToLaunch(body);

  let result;
  let checked;
  if (body.supabase) {
    result = analyzeSupabase(body.supabase);
    checked = result.extractedWorkload;
  } else if (body.workload) {
    result = analyzeWorkload(body.workload);
    checked = normalizeWorkload(body.workload); // throws on malformed input
  } else {
    throw new Error(
      "provide one of: {supabase:{instance,dbSizeGb,avgCpuPct,activity,egressGb}}, {workload:{…fields}}, " +
        "{cuHours} (may be 0, + storageGb/egressGb), {snapshot}, or {profile,instance}.",
    );
  }
  result.validation = await validateWorkload(checked, result);
  return result;
}
