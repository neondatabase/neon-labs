// GET /api/compare/guide — serves the Supabase→Neon playbook (the "prompt" an agent
// follows). Paths are rewritten from the standalone's /api/estimate to this app's
// /api/compare/estimate so the instructions it hands agents are correct here.
import GUIDES from "@/lib/compare/guides.generated.mjs";
import { CORS, corsPreflight } from "../cors";

export const runtime = "nodejs";

export async function GET() {
  const guide = (GUIDES["supabase-to-neon"] ?? "")
    .replaceAll("/api/estimate", "/api/compare/estimate")
    .replaceAll("/api/features", "/api/compare/features")
    .replaceAll("/api/pricing", "/api/compare/pricing")
    .replaceAll("/api/openapi.json", "/api/compare/openapi.json")
    .replaceAll("/api/catalog", "/api/compare/catalog");
  return new Response(guide, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      ...CORS,
    },
  });
}

export function OPTIONS() {
  return corsPreflight();
}
