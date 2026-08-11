import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { preflight } from "@/lib/neon-cutover";

export async function POST(request: NextRequest) {
  let body: {
    sourceConnectionString?: string;
    targetConnectionString?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* empty ok */
  }
  const { source, target } = await resolveConnections(body);
  if (!source || !target) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }
  try {
    const result = await preflight(source, target);
    return NextResponse.json(result);
  } catch (e) {
    const { classifyError } = await import("@/lib/neon-error-codes");
    const classified = classifyError(e);
    return NextResponse.json(
      { error: classified.raw, classified },
      { status: 502 },
    );
  }
}
