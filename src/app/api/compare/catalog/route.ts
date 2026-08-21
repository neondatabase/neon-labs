import { NextResponse } from "next/server";
import { rateCard } from "@/lib/compare/pricing-core/index.mjs";
import { RESPONSE_HEADERS, corsPreflight } from "../cors";

// GET /api/compare/catalog — what an agent needs to drive the cost API here: the
// vendors/plans (engine-derived, so no rate drift), the request shapes for
// /api/compare/estimate, and pointers to the rate card, features, and guide.
export const runtime = "nodejs";

export async function GET() {
  try {
    const vendors = (rateCard() as Array<{ vendor: string; label: string; plans: Array<{ plan: string }> }>).map((v) => ({
      vendor: v.vendor,
      label: v.label,
      plans: v.plans.map((p) => p.plan),
    }));
    const catalog = {
      product: "neon compare API (labs)",
      note: "Neon cost estimation + Neon-vs-Neon / Neon-vs-competitor comparison (features + rates). Estimate, not an invoice.",
      pricing: "GET /api/compare/pricing — full rate card (rates, instance grids, sources[])",
      openapi: "GET /api/compare/openapi.json — OpenAPI 3.1 contract (tooling/codegen; agents can use this catalog + guide)",
      features: "GET /api/compare/features — capability matrix (?vendor=neon for the Free→Scale ladder; ?tier=free for free-vs-free; ?plans=)",
      guide: "GET /api/compare/guide — the Supabase→Neon extraction + cost + migration playbook",
      vendors,
      "POST /api/compare/estimate": {
        purpose: "ONE endpoint for 'what would this cost?' — send whatever you have; routes on payload shape.",
        inputShapes: {
          supabase: "{instance,dbSizeGb,avgCpuPct,activity,egressGb} — not on Neon yet; mapped server-side (inferred → range) + a head-to-head comparison.",
          vendor: '{vendor,plan?,instance?,storageGb?,egressGb?,computeCuHours?} — price a KNOWN vendor plan directly (e.g. {"vendor":"supabase","plan":"pro","instance":"large"}).',
          workload: "{peakCu,avgCu,activeHours,storageGb,egressGb} — each field a number or {value,confidence,source}.",
          cuHours: "measured Neon CU-hours (may be 0) + optional storageGb/egressGb — precise real-usage path.",
          profile: "{profile:[hourly CPU%], instance:{vcpu,maxCu?}} — integrates to CU-hours.",
          snapshot: "a neon-usage current_period_snapshot → aggregate + per-project analysis.",
        },
      },
    };
    return NextResponse.json(catalog, { headers: RESPONSE_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500, headers: RESPONSE_HEADERS });
  }
}

export function OPTIONS() {
  return corsPreflight();
}
