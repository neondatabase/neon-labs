import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { status } from "@/lib/neon-replication";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { source, target } = await resolveConnections({
    sourceConnectionString: url.searchParams.get("source"),
    targetConnectionString: url.searchParams.get("target"),
  });
  if (!target) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }
  try {
    // Pass source so status() can compute real publisher-side lag.
    const result = await status(target, undefined, source ?? undefined);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Status failed" },
      { status: 502 },
    );
  }
}
