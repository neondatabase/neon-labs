import { NextRequest, NextResponse } from "next/server";
import { enableLogicalReplication } from "@/lib/neon-api";
import { MISSING_AUTH_ERROR } from "@/lib/neon-credentials";
import { getOAuthAccessTokenFromSession } from "@/lib/neon-oauth";

/* POST /api/neon/replication/enable
   body: { projectId }
   Calls Neon API to flip enable_logical_replication. Irreversible.
   Restarts all computes in the project.
*/
export async function POST(request: NextRequest) {
  let body: { projectId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const projectId =
    body.projectId ||
    (process.env.NODE_ENV !== "production"
      ? process.env.NEON_SOURCE_PROJECT_ID
      : undefined);
  const accessToken = await getOAuthAccessTokenFromSession();
  if (!accessToken || !projectId) {
    return NextResponse.json(
      {
        error: accessToken ? "projectId is required" : MISSING_AUTH_ERROR,
      },
      { status: accessToken ? 400 : 401 },
    );
  }
  try {
    const result = await enableLogicalReplication(accessToken, projectId);
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
