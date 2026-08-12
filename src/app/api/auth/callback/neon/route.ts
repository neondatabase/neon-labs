import { NextRequest, NextResponse } from "next/server";
import {
  appUrl,
  consumeOAuthAttempt,
  exchangeAuthorizationCode,
  saveOAuthTokens,
} from "@/lib/neon-oauth";

function errorRedirect(request: NextRequest, code: string) {
  const url = new URL("/", appUrl(request.nextUrl.origin));
  url.searchParams.set("oauth_error", code);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) return errorRedirect(request, providerError);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return errorRedirect(request, "invalid_callback");

  try {
    const attempt = await consumeOAuthAttempt(state);
    const tokens = await exchangeAuthorizationCode(
      code,
      attempt.codeVerifier,
      request.nextUrl.origin,
    );
    await saveOAuthTokens(tokens);
    return NextResponse.redirect(
      new URL(attempt.returnTo, appUrl(request.nextUrl.origin)),
    );
  } catch {
    return errorRedirect(request, "token_exchange_failed");
  }
}
