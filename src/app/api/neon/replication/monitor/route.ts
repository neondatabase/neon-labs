import { NextRequest, NextResponse } from "next/server";
import { monitor } from "@/lib/neon-replication";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";

/* GET /api/neon/replication/monitor?target=...
   Runs Neon's recommended subscriber + publisher monitoring queries against
   the configured source and target. Returns structured rows + the raw SQL
   the user can paste into the Neon SQL editor for verification.
*/
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { source, target } = await resolveConnections({
    sourceConnectionString: url.searchParams.get("source"),
    targetConnectionString: url.searchParams.get("target"),
  });
  if (!source || !target) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }
  try {
    const result = await monitor(source, target);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Monitor failed" },
      { status: 502 },
    );
  }
}
