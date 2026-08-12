import { NextRequest, NextResponse } from "next/server";
import {
  introspectAssessment,
  NotAnUpgradeError,
} from "@/lib/neon-introspect";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import type { PgMajorVersion } from "@/lib/types";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/* POST /api/neon/assessment
   body: {
     source?: "env" | <connection-string>,
     sourceConnectionString?: string,
     sourceProjectId?: string,
     targetVersion?: number,
     projectName?: string,
     projectId?: string,
     targetConnectionString?: string,
     targetProjectId?: string,
   }
   Returns a fully populated AssessmentResult by introspecting the live source
   Neon project. Resolution order for the source connection:
     1. body.sourceConnectionString (local-development override)
     2. NEON_SOURCE_CONNECTION_STRING from .env.local
     3. Neon API lookup by body.sourceProjectId using the current user's key
*/
export async function POST(request: NextRequest) {
  let body: {
    source?: string;
    sourceConnectionString?: string;
    sourceProjectId?: string;
    targetVersion?: number;
    projectName?: string;
    projectId?: string;
    targetConnectionString?: string;
    targetProjectId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: NO_STORE },
    );
  }

  const { source: conn } = await resolveConnections({
    sourceConnectionString:
      body.sourceConnectionString ||
      (body.source && body.source !== "env" ? body.source : undefined),
    sourceProjectId: body.sourceProjectId,
  });

  if (!conn) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400, headers: NO_STORE },
    );
  }

  const target = (body.targetVersion ?? 17) as PgMajorVersion;

  try {
    const result = await introspectAssessment(conn, target, {
      projectId: body.projectId,
      projectName: body.projectName,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof NotAnUpgradeError) {
      return NextResponse.json(
        { error: e.message },
        { status: 400, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Introspection failed" },
      { status: 502, headers: NO_STORE },
    );
  }
}
