import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

const OAUTH_ISSUER = "https://oauth2.neon.tech";
const AUTHORIZATION_ENDPOINT = `${OAUTH_ISSUER}/oauth2/auth`;
const TOKEN_ENDPOINT = `${OAUTH_ISSUER}/oauth2/token`;
const SESSION_COOKIE = "neon-labs-session";
const ATTEMPT_COOKIE = "neon-labs-oauth-attempt";
const TOKEN_REFRESH_WINDOW_MS = 60_000;

export const NEON_OAUTH_SCOPES = [
  "openid",
  "offline",
  "offline_access",
  "urn:neoncloud:projects:read",
  "urn:neoncloud:projects:create",
  "urn:neoncloud:projects:update",
  "urn:neoncloud:orgs:read",
] as const;

interface OAuthSessionData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface OAuthAttemptData {
  state?: string;
  codeVerifier?: string;
  returnTo?: string;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export class OAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthConfigurationError";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new OAuthConfigurationError(`${name} is not configured`);
  }
  return value;
}

function sessionPassword(): string {
  const value = requiredEnv("SESSION_SECRET");
  if (value.length < 32) {
    throw new OAuthConfigurationError(
      "SESSION_SECRET must be at least 32 characters",
    );
  }
  return value;
}

function cookieOptions(
  cookieName: string,
  maxAge: number,
): SessionOptions {
  return {
    cookieName,
    password: sessionPassword(),
    ttl: maxAge,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    },
  };
}

async function authSession() {
  return getIronSession<OAuthSessionData>(
    await cookies(),
    cookieOptions(SESSION_COOKIE, 60 * 60 * 24 * 30),
  );
}

async function attemptSession() {
  return getIronSession<OAuthAttemptData>(
    await cookies(),
    cookieOptions(ATTEMPT_COOKIE, 10 * 60),
  );
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function isOAuthConfigured(): boolean {
  return Boolean(
    process.env.NEON_OAUTH_CLIENT_ID?.trim() &&
      process.env.NEON_OAUTH_CLIENT_SECRET?.trim() &&
      process.env.SESSION_SECRET?.trim(),
  );
}

export function appUrl(requestOrigin?: string): string {
  const configured = process.env.APP_URL?.trim()?.replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production" && requestOrigin) {
    return requestOrigin.replace(/\/$/, "");
  }
  throw new OAuthConfigurationError("APP_URL is not configured");
}

export function callbackUrl(requestOrigin?: string): string {
  return `${appUrl(requestOrigin)}/api/auth/callback/neon`;
}

export async function createAuthorizationUrl(
  requestOrigin: string,
  returnTo: string | null,
): Promise<string> {
  const clientId = requiredEnv("NEON_OAUTH_CLIENT_ID");
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const attempt = await attemptSession();
  attempt.state = state;
  attempt.codeVerifier = codeVerifier;
  attempt.returnTo = safeReturnTo(returnTo);
  await attempt.save();

  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl(requestOrigin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", NEON_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function consumeOAuthAttempt(receivedState: string): Promise<{
  codeVerifier: string;
  returnTo: string;
}> {
  const attempt = await attemptSession();
  const expectedState = attempt.state;
  const codeVerifier = attempt.codeVerifier;
  const returnTo = safeReturnTo(attempt.returnTo ?? null);
  attempt.destroy();

  if (
    !expectedState ||
    !codeVerifier ||
    !statesMatch(expectedState, receivedState)
  ) {
    throw new Error("OAuth state validation failed");
  }
  return { codeVerifier, returnTo };
}

async function tokenRequest(params: URLSearchParams): Promise<OAuthTokenResponse> {
  params.set("client_id", requiredEnv("NEON_OAUTH_CLIENT_ID"));
  params.set("client_secret", requiredEnv("NEON_OAUTH_CLIENT_SECRET"));

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params,
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (Partial<OAuthTokenResponse> & {
        error?: string;
        error_description?: string;
      })
    | null;

  if (!response.ok || !body?.access_token) {
    throw new Error(
      body?.error_description ||
        body?.error ||
        `Neon OAuth token exchange failed (${response.status})`,
    );
  }
  return body as OAuthTokenResponse;
}

export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  requestOrigin: string,
): Promise<OAuthTokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: callbackUrl(requestOrigin),
    }),
  );
}

export async function saveOAuthTokens(tokens: OAuthTokenResponse) {
  const session = await authSession();
  session.accessToken = tokens.access_token;
  session.refreshToken = tokens.refresh_token;
  session.expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
  await session.save();
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const tokens = await tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    );
    const session = await authSession();
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token ?? refreshToken;
    session.expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
    await session.save();
    return tokens.access_token;
  } catch {
    const session = await authSession();
    session.destroy();
    return null;
  }
}

/** Returns the current user's OAuth access token. NEON_API_KEY remains
    available only in local development so the app can be tested before a
    development OAuth client is issued. It is never accepted in production. */
export async function getOAuthAccessTokenFromSession(): Promise<string | null> {
  if (isOAuthConfigured()) {
    const session = await authSession();
    if (
      session.accessToken &&
      (session.expiresAt ?? 0) > Date.now() + TOKEN_REFRESH_WINDOW_MS
    ) {
      return session.accessToken;
    }
    if (session.refreshToken) {
      return refreshAccessToken(session.refreshToken);
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return process.env.NEON_API_KEY?.trim() || null;
  }
  return null;
}

export async function getAuthenticationStatus() {
  const session = isOAuthConfigured() ? await authSession() : null;
  const oauthAuthenticated = Boolean(
    session?.accessToken &&
      ((session.expiresAt ?? 0) > Date.now() || session.refreshToken),
  );
  const developmentFallback =
    process.env.NODE_ENV !== "production" &&
    Boolean(process.env.NEON_API_KEY?.trim());
  return {
    authenticated: oauthAuthenticated || developmentFallback,
    oauthAuthenticated,
    oauthConfigured: isOAuthConfigured(),
    developmentFallback,
  };
}

export async function destroyOAuthSession() {
  if (!isOAuthConfigured()) return;
  const session = await authSession();
  session.destroy();
}
