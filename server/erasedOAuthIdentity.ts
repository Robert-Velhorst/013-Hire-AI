import { createHmac } from "node:crypto";
import { ENV } from "./_core/env";

export type OAuthIdentityDigest = {
  keyVersion: number;
  identityHash: string;
};

export function getOAuthIdentityDigests(openId: string): OAuthIdentityDigest[] {
  const identity = `${ENV.appId}\0${openId}`;
  return ENV.erasureIdentityHmacKeys.map((secret, index) => ({
    keyVersion: index + 1,
    identityHash: createHmac("sha256", secret).update(identity).digest("hex"),
  }));
}

export function getCurrentOAuthIdentityDigest(
  openId: string
): OAuthIdentityDigest {
  const digests = getOAuthIdentityDigests(openId);
  const current = digests[digests.length - 1];
  if (!current)
    throw new Error("OAuth identity erasure keys are not configured.");
  return current;
}

export function getOAuthIdentityLockName(openId: string): string {
  const lockKey = ENV.erasureIdentityHmacKeys[0];
  if (!lockKey)
    throw new Error("OAuth identity erasure keys are not configured.");
  const digest = createHmac("sha256", lockKey)
    .update(`hire-ai:oauth-identity-lock:v1\0${ENV.appId}\0${openId}`)
    .digest("hex");
  return `hire_ai_erasure_${digest.slice(0, 48)}`;
}

export class ErasedOAuthIdentityError extends Error {
  constructor() {
    super("This OAuth identity cannot be provisioned after account erasure.");
    this.name = "ErasedOAuthIdentityError";
  }
}
