import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { analyzeTarget } from "@/lib/neon-cutover";
import { classifyError } from "@/lib/neon-error-codes";

/* Rebuild optimizer statistics on the target project.

   body: { targetConnectionString? }

   Separate from the cutover route on purpose: a database-wide ANALYZE on a
   large target can run for minutes, so it gets its own budget instead of
   sharing the cutover request's. */

// A full-database ANALYZE is the slow part here, not the round trip.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let body: { targetConnectionString?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* allow empty body */
  }
  const { target } = await resolveConnections(body);
  if (!target) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }
  try {
    const result = await analyzeTarget(target);
    return NextResponse.json(result);
  } catch (e) {
    const classified = classifyError(e);
    return NextResponse.json(
      { error: classified.raw, classified },
      { status: 502 },
    );
  }
}
