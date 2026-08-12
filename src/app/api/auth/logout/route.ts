import { NextResponse } from "next/server";
import { destroyOAuthSession } from "@/lib/neon-oauth";

export async function POST() {
  await destroyOAuthSession();
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
