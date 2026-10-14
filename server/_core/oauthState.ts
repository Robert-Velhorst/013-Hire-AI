import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const OAUTH_LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_OAUTH_STATE_LENGTH = 4_096;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type OAuthLoginStatePayload = {
  redirectUri: string;
  nonce: string;
  issuedAt: number;
};

function isValidCallbackUri(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const transportAllowed = url.protocol === "https:"
      || (url.protocol === "http:" && LOOPBACK_HOSTS.has(hostname));
    return transportAllowed
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname === "/api/oauth/callback";
  } catch {
    return false;
  }
}

export async function createOAuthLoginState(
  redirectUri: string,
  secret: string,
  now = Date.now(),
  nonce: string
) {
  if (!isValidCallbackUri(redirectUri)) {
    throw new Error("OAuth callback URI is invalid.");
  }
  if (!secret || !nonce) {
    throw new Error("OAuth state signing is not configured.");
  }
  const payload: OAuthLoginStatePayload = { redirectUri, nonce, issuedAt: now };
  const state = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(Math.floor(now / 1_000))
    .setExpirationTime(Math.floor((now + OAUTH_LOGIN_STATE_TTL_MS) / 1_000))
    .sign(new TextEncoder().encode(secret));
  return state;
}

export async function verifyOAuthLoginState(
  state: string,
  browserNonce: string,
  secret: string,
  now = Date.now()
): Promise<{ redirectUri: string } | null> {
  if (!state || state.length > MAX_OAUTH_STATE_LENGTH || !browserNonce || !secret) return null;
  try {
    const { payload } = await jwtVerify(state, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      currentDate: new Date(now),
    });
    if (
      typeof payload.redirectUri !== "string"
      || typeof payload.nonce !== "string"
      || typeof payload.issuedAt !== "number"
      || !Number.isSafeInteger(payload.issuedAt)
      || payload.nonce !== browserNonce
      || (payload.issuedAt as number) > now
      || now - (payload.issuedAt as number) > OAUTH_LOGIN_STATE_TTL_MS
      || !isValidCallbackUri(payload.redirectUri)
    ) {
      return null;
    }
    return { redirectUri: payload.redirectUri };
  } catch {
    return null;
  }
}
