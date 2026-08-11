import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { execute } from "@/lib/neon-dump-restore";

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
    const result = await execute(source, target);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Execute failed" },
      { status: 502 },
    );
  }
}
