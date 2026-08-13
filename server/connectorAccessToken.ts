import type { ConnectorAuthorization } from "../drizzle/schema";
import {
  decryptConnectorToken,
  encryptConnectorToken,
  getConnectorOAuthConfig,
  refreshConnectorAccessToken,
  type OAuthConnectorProvider,
} from "./connectorOAuth";
import { upsertConnectorAuthorization } from "./db";

const TOKEN_EXPIRY_SKEW_MS = 60_000;
const refreshes = new Map<string, Promise<string>>();

export type ConnectorAccessTokenDependencies = {
  decryptConnectorToken: typeof decryptConnectorToken;
  encryptConnectorToken: typeof encryptConnectorToken;
  getConnectorOAuthConfig: typeof getConnectorOAuthConfig;
  refreshConnectorAccessToken: typeof refreshConnectorAccessToken;
  upsertConnectorAuthorization: typeof upsertConnectorAuthorization;
};

export const connectorAccessTokenDependencies: ConnectorAccessTokenDependencies = {
  decryptConnectorToken,
  encryptConnectorToken,
  getConnectorOAuthConfig,
  refreshConnectorAccessToken,
  upsertConnectorAuthorization,
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

export async function getUsableConnectorAccessToken(input: {
  userId: number;
  provider: OAuthConnectorProvider;
  authorization: ConnectorAuthorization;
  now: Date;
  fetcher: typeof fetch;
  consentScopes?: readonly string[];
  dependencies?: ConnectorAccessTokenDependencies;
}) {
  const dependencies = input.dependencies ?? connectorAccessTokenDependencies;
  const expiresAt = input.authorization.accessTokenExpiresAt?.getTime() ?? null;
  if (expiresAt !== null && expiresAt > input.now.getTime() + TOKEN_EXPIRY_SKEW_MS) {
    return dependencies.decryptConnectorToken(input.authorization.encryptedAccessToken);
  }
  if (!input.authorization.encryptedRefreshToken) {
    throw new ConnectorAccessTokenError("expired");
  }

  const refreshKey = `${input.userId}:${input.provider}`;
  const activeRefresh = refreshes.get(refreshKey);
  if (activeRefresh) return activeRefresh;

  const refresh = (async () => {
    const config = dependencies.getConnectorOAuthConfig(
      input.provider,
      undefined,
      input.consentScopes
    );
    if (!config) throw new ConnectorAccessTokenError("renewal_not_configured");

    const refreshed = await dependencies.refreshConnectorAccessToken(
      config,
      dependencies.decryptConnectorToken(input.authorization.encryptedRefreshToken!),
      input.fetcher
    );
    const storedScopes = parseStoredScopes(input.authorization.grantedScopes);
    const grantedScopes = refreshed.scopeWasReturned === false && storedScopes.length > 0
      ? storedScopes
      : refreshed.grantedScopes;
    await dependencies.upsertConnectorAuthorization({
      userId: input.userId,
      provider: input.provider,
      encryptedAccessToken: dependencies.encryptConnectorToken(refreshed.accessToken),
      encryptedRefreshToken: refreshed.refreshToken
        ? dependencies.encryptConnectorToken(refreshed.refreshToken)
        : input.authorization.encryptedRefreshToken,
      accessTokenExpiresAt: refreshed.expiresAt,
      tokenType: refreshed.tokenType,
      grantedScopes: JSON.stringify(grantedScopes),
    });
    return refreshed.accessToken;
  })();

  refreshes.set(refreshKey, refresh);
  try {
    return await refresh;
  } finally {
    if (refreshes.get(refreshKey) === refresh) refreshes.delete(refreshKey);
  }
}
