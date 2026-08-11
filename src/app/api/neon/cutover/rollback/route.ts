import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { rollback } from "@/lib/neon-cutover";

export async function POST(request: NextRequest) {
  let body: { targetConnectionString?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty ok */
  }
  const { target } = await resolveConnections(body);
  if (!target) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }
  try {
    const result = await rollback(target);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Rollback failed" },
      { status: 502 },
    );
  }
}
