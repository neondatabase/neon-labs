import { NextRequest, NextResponse } from "next/server";
import { resolveConnectionUri } from "@/lib/neon-api";
import { MISSING_API_KEY_ERROR, resolveApiKey } from "@/lib/neon-credentials";

/* POST /api/neon/projects/connection-uri
   body: { apiKey, projectId, databaseName?, roleName?, pooled? }
   Returns the connection URI for a project (used when picking a non-env target).
   NOTE: leaks credentials to the browser only when the user provides their
   API key, they already have it, so no escalation.
*/
export async function POST(request: NextRequest) {
  let body: {
    apiKey?: string;
    projectId?: string;
    databaseName?: string;
    roleName?: string;
    pooled?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const apiKey = resolveApiKey(body.apiKey);
  if (!apiKey || !body.projectId) {
    return NextResponse.json(
      { error: apiKey ? "projectId is required" : MISSING_API_KEY_ERROR },
      { status: 400 },
    );
  }
  try {
    const uri = await resolveConnectionUri(apiKey, body.projectId);
    return NextResponse.json({ uri });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "connection-uri failed" },
      { status: 502 },
    );
  }
}
