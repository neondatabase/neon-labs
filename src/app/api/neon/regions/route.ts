import { NextRequest, NextResponse } from "next/server";
import { listRegions } from "@/lib/neon-api";
import { MISSING_AUTH_ERROR } from "@/lib/neon-credentials";
import { getOAuthAccessTokenFromSession } from "@/lib/neon-oauth";

export async function GET(request: NextRequest) {
  const accessToken = await getOAuthAccessTokenFromSession();
  if (!accessToken) {
    return NextResponse.json({ error: MISSING_AUTH_ERROR }, { status: 401 });
  }

  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() || undefined;
  try {
    const { regions } = await listRegions(accessToken, orgId);
    return NextResponse.json({ regions });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list regions",
      },
      { status: 502 },
    );
  }
}
