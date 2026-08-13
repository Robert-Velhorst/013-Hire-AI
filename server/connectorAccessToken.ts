import { randomUUID } from "node:crypto";
import type { ConnectorAuthorization } from "../drizzle/schema";
import {
  decryptConnectorToken,
  encryptConnectorToken,
  getConnectorOAuthConfig,
  refreshConnectorAccessToken,
  type OAuthConnectorProvider,
} from "./connectorOAuth";
import {
  acquireConnectorRefreshLease,
  getConnectorAuthorization,
  releaseConnectorRefreshLease,
  upsertConnectorAuthorization,
} from "./db";

const TOKEN_EXPIRY_SKEW_MS = 60_000;
const REFRESH_LEASE_MS = 40_000;
const REFRESH_WAIT_MS = 41_000;
const REFRESH_POLL_MS = 500;
const refreshes = new Map<string, Promise<string>>();

export type ConnectorAccessTokenDependencies = {
  decryptConnectorToken: typeof decryptConnectorToken;
  encryptConnectorToken: typeof encryptConnectorToken;
  getConnectorOAuthConfig: typeof getConnectorOAuthConfig;
  refreshConnectorAccessToken: typeof refreshConnectorAccessToken;
  acquireConnectorRefreshLease: typeof acquireConnectorRefreshLease;
  getConnectorAuthorization: typeof getConnectorAuthorization;
  releaseConnectorRefreshLease: typeof releaseConnectorRefreshLease;
  upsertConnectorAuthorization: typeof upsertConnectorAuthorization;
  createLeaseToken: () => string;
  sleep: (milliseconds: number) => Promise<void>;
  currentTime: () => number;
};

export const connectorAccessTokenDependencies: ConnectorAccessTokenDependencies = {
  decryptConnectorToken,
  encryptConnectorToken,
  getConnectorOAuthConfig,
  refreshConnectorAccessToken,
  acquireConnectorRefreshLease,
  getConnectorAuthorization,
  releaseConnectorRefreshLease,
  upsertConnectorAuthorization,
  createLeaseToken: randomUUID,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  currentTime: Date.now,
};

export class ConnectorAccessTokenError extends Error {
  constructor(readonly reason: "expired" | "renewal_not_configured") {
    super(reason);
    this.name = "ConnectorAccessTokenError";
  }
}

function parseStoredScopes(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((scope): scope is string => typeof scope === "string" && scope.length > 0)
      : [];
  } catch {
    return [];
  }
}

function hasUsableAccessToken(authorization: ConnectorAuthorization, nowMs: number) {
  const expiresAt = authorization.accessTokenExpiresAt?.getTime() ?? null;
  return expiresAt !== null && expiresAt > nowMs + TOKEN_EXPIRY_SKEW_MS;
}

export async function getUsableConnectorAccessToken(input: {
  userId: number;
  provider: OAuthConnectorProvider;
  authorization: ConnectorAuthorization;
  now: Date;
  fetcher: typeof fetch;
  consentScopes?: readonly string[];
  dependencies?: Partial<ConnectorAccessTokenDependencies>;
}) {
  const dependencies: ConnectorAccessTokenDependencies = {
    ...connectorAccessTokenDependencies,
    ...input.dependencies,
  };
  if (hasUsableAccessToken(input.authorization, input.now.getTime())) {
    return dependencies.decryptConnectorToken(input.authorization.encryptedAccessToken);
  }
  if (!input.authorization.encryptedRefreshToken) {
    throw new ConnectorAccessTokenError("expired");
  }

  const refreshKey = `${input.userId}:${input.provider}`;
  const activeRefresh = refreshes.get(refreshKey);
  if (activeRefresh) return activeRefresh;

  const refresh = (async () => {
    const leaseToken = dependencies.createLeaseToken();
    let ownsLease = await dependencies.acquireConnectorRefreshLease(
      input.userId,
      input.provider,
      leaseToken,
      REFRESH_LEASE_MS
    );
    if (!ownsLease) {
      const deadline = dependencies.currentTime() + REFRESH_WAIT_MS;
      while (dependencies.currentTime() < deadline) {
        await dependencies.sleep(REFRESH_POLL_MS);
        const current = await dependencies.getConnectorAuthorization(input.userId, input.provider);
        if (current && hasUsableAccessToken(current, dependencies.currentTime())) {
          return dependencies.decryptConnectorToken(current.encryptedAccessToken);
        }
        const leaseExpiresAt = current?.refreshLeaseExpiresAt?.getTime() ?? 0;
        if (leaseExpiresAt <= dependencies.currentTime()) {
          ownsLease = await dependencies.acquireConnectorRefreshLease(
            input.userId,
            input.provider,
            leaseToken,
            REFRESH_LEASE_MS
          );
        }
        if (ownsLease) break;
      }
      if (!ownsLease) {
        throw new Error("Connector token renewal is still in progress. Please retry shortly.");
      }
    }

    try {
      const current = await dependencies.getConnectorAuthorization(input.userId, input.provider);
      if (current && hasUsableAccessToken(current, dependencies.currentTime())) {
        return dependencies.decryptConnectorToken(current.encryptedAccessToken);
      }
      const authorization = current ?? input.authorization;
      if (!authorization.encryptedRefreshToken) {
        throw new ConnectorAccessTokenError("expired");
      }
      const config = dependencies.getConnectorOAuthConfig(
        input.provider,
        undefined,
        input.consentScopes
      );
      if (!config) throw new ConnectorAccessTokenError("renewal_not_configured");

      const refreshed = await dependencies.refreshConnectorAccessToken(
        config,
        dependencies.decryptConnectorToken(authorization.encryptedRefreshToken),
        input.fetcher
      );
      const storedScopes = parseStoredScopes(authorization.grantedScopes);
      const grantedScopes = refreshed.scopeWasReturned === false && storedScopes.length > 0
        ? storedScopes
        : refreshed.grantedScopes;
      await dependencies.upsertConnectorAuthorization({
        userId: input.userId,
        provider: input.provider,
        encryptedAccessToken: dependencies.encryptConnectorToken(refreshed.accessToken),
        encryptedRefreshToken: refreshed.refreshToken
          ? dependencies.encryptConnectorToken(refreshed.refreshToken)
          : authorization.encryptedRefreshToken,
        accessTokenExpiresAt: refreshed.expiresAt,
        tokenType: refreshed.tokenType,
        grantedScopes: JSON.stringify(grantedScopes),
      });
      return refreshed.accessToken;
    } finally {
      try {
        await dependencies.releaseConnectorRefreshLease(input.userId, input.provider, leaseToken);
      } catch {
        console.error(`[ConnectorAccessToken] Failed to release refresh lease for ${input.provider}.`);
      }
    }
  })();

  refreshes.set(refreshKey, refresh);
  try {
    return await refresh;
  } finally {
    if (refreshes.get(refreshKey) === refresh) refreshes.delete(refreshKey);
  }
}
