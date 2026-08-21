import { NextResponse } from "next/server";
import { openapiSpec } from "@/lib/compare/openapi.mjs";
import { RESPONSE_HEADERS, corsPreflight } from "../cors";

// GET /api/compare/openapi.json — the OpenAPI 3.1 contract for this surface. Built
// from basePath so paths resolve to /api/compare/* here (no string-replace). Agents
// can keep using /api/compare/guide + /api/compare/catalog; this is for tooling.
export const runtime = "nodejs";

export async function GET() {
  try {
    const spec = openapiSpec({ basePath: "/api/compare", guidePath: "/api/compare/guide" });
    return NextResponse.json(spec, { headers: RESPONSE_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500, headers: RESPONSE_HEADERS });
  }
}

export function OPTIONS() {
  return corsPreflight();
}
