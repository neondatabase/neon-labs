import { NextRequest, NextResponse } from "next/server";
import {
  introspectAssessment,
  NotAnUpgradeError,
} from "@/lib/neon-introspect";
import type { PgMajorVersion } from "@/lib/types";

/* POST /api/neon/assessment
   body: {
     source?: "env" | <connection-string>,
     sourceConnectionString?: string,
     targetVersion?: number,
     projectName?: string,
     projectId?: string,
     targetConnectionString?: string,
     targetProjectId?: string,
   }
   Returns a fully populated AssessmentResult by introspecting the live source
   Neon project. Resolution order for the source connection:
     1. body.sourceConnectionString (picker override)
     2. body.source (legacy "env" or literal string)
     3. NEON_SOURCE_CONNECTION_STRING from .env.local
*/
export async function POST(request: NextRequest) {
  let body: {
    source?: string;
    sourceConnectionString?: string;
    targetVersion?: number;
    projectName?: string;
    projectId?: string;
    targetConnectionString?: string;
    targetProjectId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conn =
    body.sourceConnectionString ||
    (body.source && body.source !== "env"
      ? body.source
      : process.env.NEON_SOURCE_CONNECTION_STRING);

  if (!conn) {
    return NextResponse.json(
      {
        error:
          "No source connection string available. Pick a source project above or set NEON_SOURCE_CONNECTION_STRING in .env.local.",
      },
      { status: 400 },
    );
  }

  const target = (body.targetVersion ?? 17) as PgMajorVersion;

  try {
    const result = await introspectAssessment(conn, target, {
      projectId: body.projectId,
      projectName: body.projectName,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof NotAnUpgradeError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Introspection failed" },
      { status: 502 },
    );
  }
}
