import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function signaturesMatch(received: string, expected: string) {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length
    && timingSafeEqual(receivedBytes, expectedBytes);
}

export function createOAuthLoginState(
  redirectUri: string,
  secret: string,
  now = Date.now(),
  nonce = randomBytes(32).toString("base64url")
) {
  if (!isValidCallbackUri(redirectUri)) {
    throw new Error("OAuth callback URI is invalid.");
  }
  if (!secret || !nonce) {
    throw new Error("OAuth state signing is not configured.");
  }
  const payload: OAuthLoginStatePayload = { redirectUri, nonce, issuedAt: now };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    nonce,
    state: `${encodedPayload}.${signPayload(encodedPayload, secret)}`,
  };
}

export function verifyOAuthLoginState(
  state: string,
  browserNonce: string,
  secret: string,
  now = Date.now()
): { redirectUri: string } | null {
  if (!state || state.length > MAX_OAUTH_STATE_LENGTH || !browserNonce || !secret) return null;
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature || !signaturesMatch(signature, signPayload(encodedPayload, secret))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<OAuthLoginStatePayload>;
    if (
      typeof payload.redirectUri !== "string"
      || typeof payload.nonce !== "string"
      || typeof payload.issuedAt !== "number"
      || !Number.isSafeInteger(payload.issuedAt)
      || payload.nonce !== browserNonce
      || payload.issuedAt > now
      || now - payload.issuedAt > OAUTH_LOGIN_STATE_TTL_MS
      || !isValidCallbackUri(payload.redirectUri)
    ) {
      return null;
    }
    return { redirectUri: payload.redirectUri };
  } catch {
    return null;
  }
}
