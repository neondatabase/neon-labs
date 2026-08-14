import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import { preflight } from "@/lib/neon-replication";

export async function POST(request: NextRequest) {
  let body: {
    sourceConnectionString?: string;
    sourceProjectId?: string;
    targetConnectionString?: string;
    targetProjectId?: string;
    tables?: string[];
  } = {};
  try {
    body = await request.json();
  } catch {
    /* allow empty */
  }
  if (
    body.tables !== undefined &&
    (!Array.isArray(body.tables) ||
      body.tables.some((table) => typeof table !== "string"))
  ) {
    return NextResponse.json(
      { error: "tables must be an array of schema-qualified table names." },
      { status: 400 },
    );
  }
  const { source, target } = await resolveConnections(body);
  if (!source || !target) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }
  try {
    const result = await preflight(source, target, body.tables);
    return NextResponse.json(result);
  } catch (e) {
    const { classifyError } = await import("@/lib/neon-error-codes");
    const classified = classifyError(e);
    return NextResponse.json(
      { error: classified.raw, classified },
      { status: 502 },
    );
  }
}
