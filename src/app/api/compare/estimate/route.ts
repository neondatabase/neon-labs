import { NextRequest, NextResponse } from "next/server";
import { estimateRequest } from "@/lib/compare/estimate-request.mjs";
import { RESPONSE_HEADERS, corsPreflight } from "../cors";

// Contained "labs" cost-estimator tool (own namespace, removable in isolation).
// Neon-only: competitor data was stripped from the vendored pricing core. The
// workload/supabase paths are pure pricing and need NO Neon credentials.
//
// LLM validation (the advisory plausibility pass on inferred inputs) only calls the
// Neon AI Gateway when NEON_AI_GATEWAY_BASE_URL + NEON_AI_GATEWAY_TOKEN are set. When
// absent (e.g. this labs deploy today) it fail-opens to deterministic rules — so
// `validation.checkedBy` reads "rules", not "llm". Set those env vars to enable the
// LLM pass; treat it as a deploy checklist item.
//
// TODO (WS0, before heavy public exposure): add rate-limiting, and gate/sample the LLM
// validation once the gateway is wired (each call bills the gateway).
export const runtime = "nodejs"; // BigInt money math + fetch to AI Gateway — not Edge

// POST /api/compare/estimate — one endpoint; routes on the payload shape:
//   {supabase} | {workload}                     → inferred estimate + advisory validation
//   {vendor}                                    → price a known vendor plan directly
//   {cuHours} | {snapshot} | {profile,instance} → measured, precise
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "request body must be valid JSON" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  try {
    const result = await estimateRequest(body as Record<string, unknown>);
    return NextResponse.json(result, { headers: RESPONSE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "bad request";
    return NextResponse.json({ error: message }, { status: 400, headers: RESPONSE_HEADERS });
  }
}

// Preflight for cross-origin POST.
export function OPTIONS() {
  return corsPreflight();
}
