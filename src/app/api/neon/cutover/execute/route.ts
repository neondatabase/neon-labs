import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { execute } from "@/lib/neon-cutover";
import { classifyError } from "@/lib/neon-error-codes";

export async function POST(request: NextRequest) {
  let body: {
    dryRun?: boolean;
    sourceConnectionString?: string;
    targetConnectionString?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* allow empty body */
  }
  const { source, target: effectiveTarget } = await resolveConnections(body);
  if (!source || !effectiveTarget) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }
  try {
    const result = await execute(source!, effectiveTarget, { dryRun: body.dryRun });
    return NextResponse.json(result);
  } catch (e) {
    const classified = classifyError(e);
    return NextResponse.json(
      { error: classified.raw, classified },
      { status: 502 },
    );
  }
}
