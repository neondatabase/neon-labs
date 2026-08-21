import { NextResponse } from "next/server";
import { featuresFor } from "@/lib/compare/compare.mjs";
import { RESPONSE_HEADERS, corsPreflight } from "../cors";

// GET /api/compare/features — the capability matrix (features only; no input, nothing
// sent). Default: Neon vs every competitor, paid tiers. Scope with ?vendor= ('neon'
// for the Free→Launch→Scale ladder, a competitor for Neon vs that vendor), ?tier=free
// for the same tier across vendors (Neon Free vs Supabase Free), or ?plans=free,launch
// for exact plans of one vendor. Head-to-head COST is in the /api/compare/estimate
// {supabase} response instead.
export const runtime = "nodejs";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const vendor = params.get("vendor") ?? undefined;
  const plans = params.get("plans")?.split(",").map((p) => p.trim()).filter(Boolean);
  const tier = params.get("tier") ?? undefined;
  try {
    return NextResponse.json(featuresFor(vendor, plans, tier), { headers: RESPONSE_HEADERS });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 400;
    return NextResponse.json({ error: err instanceof Error ? err.message : "bad request" }, { status, headers: RESPONSE_HEADERS });
  }
}

export function OPTIONS() {
  return corsPreflight();
}
