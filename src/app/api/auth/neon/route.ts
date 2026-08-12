import { NextRequest, NextResponse } from "next/server";
import {
  createAuthorizationUrl,
  OAuthConfigurationError,
} from "@/lib/neon-oauth";

export async function GET(request: NextRequest) {
  try {
    const authorizationUrl = await createAuthorizationUrl(
      request.nextUrl.origin,
      request.nextUrl.searchParams.get("returnTo"),
    );
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    const message =
      error instanceof OAuthConfigurationError
        ? error.message
        : "Could not start Neon sign-in";
    return NextResponse.json(
      { error: message },
      {
        status: error instanceof OAuthConfigurationError ? 503 : 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
