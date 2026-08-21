import { NextResponse } from "next/server";
import { rateCard } from "@/lib/compare/pricing-core/index.mjs";
import { RESPONSE_HEADERS, corsPreflight } from "../cors";

// GET /api/compare/pricing — machine-readable rate card: per-plan per-metric rates
// (unit, rate, included quota), instance grids, billing model, and sources[]. For
// finding prices and computing estimates yourself. ?vendor= scopes to one vendor.
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const vendor = new URL(req.url).searchParams.get("vendor") || undefined;
    const vendors = rateCard(vendor);
    if (vendor && vendors.length === 0) {
      return NextResponse.json({ error: `unknown vendor '${vendor}'` }, { status: 404, headers: RESPONSE_HEADERS });
    }
    return NextResponse.json({ note: "Rates, not an invoice. Cite sources[] + retrievedAt.", vendors }, { headers: RESPONSE_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500, headers: RESPONSE_HEADERS });
  }
}

export function OPTIONS() {
  return corsPreflight();
}
