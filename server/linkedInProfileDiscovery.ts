import { isConnectorAuthorizationStale } from "@shared/profileEvidence";
import { decryptConnectorToken } from "./connectorOAuth";
import {
  getConnectorAuthorization,
  getUserConnectorAccount,
  upsertUserConnectorAccount,
} from "./db";

export type LinkedInIdentityCandidate = {
  provider: "linkedin";
  name: string | null;
  email: string | null;
  emailVerified: boolean;
};

type ConnectorAccount = NonNullable<Awaited<ReturnType<typeof getUserConnectorAccount>>>;

export type LinkedInProfileDiscoveryDependencies = {
  getConnectorAuthorization: typeof getConnectorAuthorization;
  getUserConnectorAccount: typeof getUserConnectorAccount;
  upsertUserConnectorAccount: typeof upsertUserConnectorAccount;
  decryptConnectorToken: typeof decryptConnectorToken;
};

const defaults: LinkedInProfileDiscoveryDependencies = {
  getConnectorAuthorization,
  getUserConnectorAccount,
  upsertUserConnectorAccount,
  decryptConnectorToken,
};

function stringValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function hasLinkedInProfileConsent(account: ConnectorAccount | undefined) {
  try {
    const scopes = account?.consentScopes ? JSON.parse(account.consentScopes) : [];
    return Array.isArray(scopes) && scopes.includes("profile.basic.read");
  } catch {
    return false;
  }
}

async function getLinkedInAccessToken(
  userId: number,
  now: Date,
  dependencies: LinkedInProfileDiscoveryDependencies
) {
  const account = await dependencies.getUserConnectorAccount(userId, "linkedin");
  if (
    !account ||
    account.status !== "connected" ||
    !hasLinkedInProfileConsent(account) ||
    isConnectorAuthorizationStale(account.lastVerifiedAt, now)
  ) {
    throw new Error("LinkedIn must be freshly authorized with profile consent before identity discovery.");
  }

  const authorization = await dependencies.getConnectorAuthorization(userId, "linkedin");
  if (
    !authorization ||
    !authorization.accessTokenExpiresAt ||
    authorization.accessTokenExpiresAt.getTime() <= now.getTime() + 60_000
  ) {
    await markLinkedInAccessNeedsReauth(userId, account, dependencies);
    throw new Error("LinkedIn authorization has expired. Reauthorize before identity discovery.");
  }

  return { account, accessToken: dependencies.decryptConnectorToken(authorization.encryptedAccessToken) };
}

async function markLinkedInAccessNeedsReauth(
  userId: number,
  account: ConnectorAccount,
  dependencies: LinkedInProfileDiscoveryDependencies
) {
  await dependencies.upsertUserConnectorAccount({
    userId,
    provider: "linkedin",
    status: "needs_reauth",
    consentScopes: account.consentScopes,
    externalAccountLabel: account.externalAccountLabel,
    connectionRequestedAt: account.connectionRequestedAt,
    lastVerifiedAt: account.lastVerifiedAt,
    disconnectedAt: null,
  });
}

function parseLinkedInUserInfo(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (!stringValue(value.sub, 255)) return null;
  return {
    name: stringValue(value.name, 255),
    email: stringValue(value.email, 320),
    emailVerified: value.email_verified === true,
  };
}

function accountLabel(candidate: Omit<LinkedInIdentityCandidate, "provider">) {
  if (candidate.name && candidate.email) return `${candidate.name} <${candidate.email}>`;
  return candidate.name || candidate.email || "LinkedIn account";
}

/**
 * Retrieves LinkedIn's OIDC identity claims only. Employment history, skills,
 * and public-profile URLs are not returned by this consent scope.
 */
export async function discoverLinkedInIdentity(
  userId: number,
  options: { fetcher?: typeof fetch; now?: Date; dependencies?: LinkedInProfileDiscoveryDependencies } = {}
): Promise<LinkedInIdentityCandidate> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const dependencies = options.dependencies ?? defaults;
  const { account, accessToken } = await getLinkedInAccessToken(userId, now, dependencies);
  const response = await fetcher("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await markLinkedInAccessNeedsReauth(userId, account, dependencies);
      throw new Error("LinkedIn authorization is no longer valid. Reauthorize before identity discovery.");
    }
    throw new Error("LinkedIn identity discovery is temporarily unavailable.");
  }

  const identity = parseLinkedInUserInfo(await response.json() as unknown);
  if (!identity) throw new Error("LinkedIn did not return a usable identity profile.");
  const candidate: LinkedInIdentityCandidate = { provider: "linkedin", ...identity };

  await dependencies.upsertUserConnectorAccount({
    userId,
    provider: "linkedin",
    status: "connected",
    consentScopes: account.consentScopes,
    externalAccountLabel: accountLabel(candidate),
    connectionRequestedAt: account.connectionRequestedAt,
    lastVerifiedAt: now,
    disconnectedAt: null,
  });

  return candidate;
}
