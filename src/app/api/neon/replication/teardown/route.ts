import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";
import {
  inspectReplicationResources,
  teardown,
} from "@/lib/neon-replication";

export async function POST(request: NextRequest) {
  let body: Parameters<typeof resolveConnections>[0] & {
    action?: "inspect" | "execute";
    confirm?: boolean;
    publicationName?: unknown;
    subscriptionName?: unknown;
    slotName?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* empty ok */
  }
  if (
    "publicationName" in body ||
    "subscriptionName" in body ||
    "slotName" in body
  ) {
    return NextResponse.json(
      {
        error:
          "Replication resource names are fixed by this application and cannot be supplied by the client.",
      },
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
    if ((body.action ?? "inspect") === "inspect") {
      const result = await inspectReplicationResources(source, target);
      return NextResponse.json(result);
    }
    if (body.action !== "execute") {
      return NextResponse.json(
        { error: "action must be 'inspect' or 'execute'." },
        { status: 400 },
      );
    }
    if (body.confirm !== true) {
      return NextResponse.json(
        {
          error:
            "Explicit confirmation is required before permanently stopping replication.",
        },
        { status: 400 },
      );
    }
    const result = await teardown(source, target);
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
