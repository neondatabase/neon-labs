import { NextResponse } from "next/server";
import { getAuthenticationStatus } from "@/lib/neon-oauth";

export async function GET() {
  return NextResponse.json(await getAuthenticationStatus(), {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}
