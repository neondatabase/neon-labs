import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { diffSchemas } from "@/lib/neon-schema-diff";

/* POST /api/neon/schema-diff
     body: { sourceConnectionString, targetConnectionString }
   Returns: { diff: SchemaDiffEntry[] }
*/
export async function POST(request: NextRequest) {
  let body: {
    sourceConnectionString?: string;
    targetConnectionString?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { source, target } = await resolveConnections(body);
  if (!source || !target) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }

  try {
    const diff = await diffSchemas(source, target);
    return NextResponse.json({ diff });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Schema diff failed" },
      { status: 502 },
    );
  }
}
