import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { setupReplication } from "@/lib/neon-replication";
import { classifyError } from "@/lib/neon-error-codes";

export async function POST(request: NextRequest) {
  let body: {
    sourceConnectionString?: string;
    targetConnectionString?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* empty allowed */
  }
  const { source, target } = await resolveConnections(body);
  if (!source || !target) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }
  try {
    const result = await setupReplication(source, target);
    return NextResponse.json(result);
  } catch (e) {
    const classified = classifyError(e);
    return NextResponse.json(
      {
        error: classified.raw,
        classified,
      },
      { status: 502 },
    );
  }
}
