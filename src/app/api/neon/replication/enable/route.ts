import { NextRequest, NextResponse } from "next/server";
import { enableLogicalReplication } from "@/lib/neon-api";
import { MISSING_API_KEY_ERROR, resolveApiKey } from "@/lib/neon-credentials";

/* POST /api/neon/replication/enable
   body: { apiKey, projectId }
   Calls Neon API to flip enable_logical_replication. Irreversible.
   Restarts all computes in the project.
*/
export async function POST(request: NextRequest) {
  let body: { apiKey?: string; projectId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const projectId = body.projectId || process.env.NEON_SOURCE_PROJECT_ID;
  const apiKey = resolveApiKey(body.apiKey);
  if (!apiKey || !projectId) {
    return NextResponse.json(
      { error: apiKey ? "projectId is required" : MISSING_API_KEY_ERROR },
      { status: 400 },
    );
  }
  try {
    const result = await enableLogicalReplication(apiKey, projectId);
    return NextResponse.json({
      projectId: result.project.id,
      logicalReplicationEnabled: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Enable failed" },
      { status: 502 },
    );
  }
}
