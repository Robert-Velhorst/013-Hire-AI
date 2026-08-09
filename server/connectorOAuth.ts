import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ENV } from "./_core/env";
import { providerRequestInit, readProviderJson } from "./_core/providerRequest";

export const OAUTH_CONNECTOR_PROVIDERS = [
  "gmail",
  "google_drive",
  "dropbox",
  "outlook",
  "linkedin",
  "github",
] as const;

export type OAuthConnectorProvider = typeof OAUTH_CONNECTOR_PROVIDERS[number];

type OAuthProviderDefinition = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: string[];
  authorizationParams?: Record<string, string>;
};

export type ConnectorOAuthConfig = OAuthProviderDefinition & {
  provider: OAuthConnectorProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type ConnectorOAuthEnvironment = {
  connectorOAuthRedirectUri: string;
  connectorTokenEncryptionKey: string;
  connectorOAuthStateSecret: string;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  dropboxOAuthClientId: string;
  dropboxOAuthClientSecret: string;
  microsoftOAuthClientId: string;
  microsoftOAuthClientSecret: string;
  linkedInOAuthClientId: string;
  linkedInOAuthClientSecret: string;
  githubOAuthClientId: string;
  githubOAuthClientSecret: string;
};

type ConnectorOAuthState = {
  provider: OAuthConnectorProvider;
  userId: number;
  /** Internal consent labels selected before this signed OAuth handoff. */
  consentScopes?: string[];
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export type OAuthTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  tokenType: string | null;
  grantedScopes: string[];
};

const STATE_TTL_MS = 10 * 60 * 1000;
const ENCRYPTION_VERSION = "v1";
const MAX_PROVIDER_TOKEN_LENGTH = 16 * 1024;
const MAX_GRANTED_SCOPES = 200;
const MAX_SCOPE_LENGTH = 500;
const MAX_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

const providerDefinitions: Record<OAuthConnectorProvider, OAuthProviderDefinition> = {
  gmail: {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    scopes: ["https://www.googleapis.com/auth/gmail.metadata"],
    authorizationParams: { access_type: "offline", prompt: "consent" },
  },
  google_drive: {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    authorizationParams: { access_type: "offline", prompt: "consent" },
  },
  dropbox: {
    authorizationEndpoint: "https://www.dropbox.com/oauth2/authorize",
    tokenEndpoint: "https://api.dropboxapi.com/oauth2/token",
    clientIdEnv: "DROPBOX_OAUTH_CLIENT_ID",
    clientSecretEnv: "DROPBOX_OAUTH_CLIENT_SECRET",
    scopes: ["files.metadata.read", "files.content.read"],
    authorizationParams: { token_access_type: "offline" },
  },
  outlook: {
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    scopes: ["offline_access", "Mail.Read"],
  },
  linkedin: {
    authorizationEndpoint: "https://www.linkedin.com/oauth/v2/authorization",
    tokenEndpoint: "https://www.linkedin.com/oauth/v2/accessToken",
    clientIdEnv: "LINKEDIN_OAUTH_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_OAUTH_CLIENT_SECRET",
    scopes: ["openid", "profile", "email"],
  },
  github: {
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
    scopes: ["read:user"],
  },
};

const OPTIONAL_PROVIDER_SEND_SCOPES: Partial<Record<OAuthConnectorProvider, {
  consentScope: string;
  providerScope: string;
}>> = {
  gmail: {
    consentScope: "email.messages.send",
    providerScope: "https://www.googleapis.com/auth/gmail.send",
  },
  outlook: {
    consentScope: "mail.messages.send",
    providerScope: "Mail.Send",
  },
};

export function getProviderScopesForConnectorConsent(
  provider: OAuthConnectorProvider,
  consentScopes: readonly string[] = []
) {
  const scopes = [...providerDefinitions[provider].scopes];
  const optionalSendScope = OPTIONAL_PROVIDER_SEND_SCOPES[provider];
  if (optionalSendScope && consentScopes.includes(optionalSendScope.consentScope)) {
    scopes.push(optionalSendScope.providerScope);
  }
  return scopes;
}

function getDefaultEnvironment(): ConnectorOAuthEnvironment {
  return {
    connectorOAuthRedirectUri: ENV.connectorOAuthRedirectUri,
    connectorTokenEncryptionKey: ENV.connectorTokenEncryptionKey,
    connectorOAuthStateSecret: ENV.connectorOAuthStateSecret,
    googleOAuthClientId: ENV.googleOAuthClientId,
    googleOAuthClientSecret: ENV.googleOAuthClientSecret,
    dropboxOAuthClientId: ENV.dropboxOAuthClientId,
    dropboxOAuthClientSecret: ENV.dropboxOAuthClientSecret,
    microsoftOAuthClientId: ENV.microsoftOAuthClientId,
    microsoftOAuthClientSecret: ENV.microsoftOAuthClientSecret,
    linkedInOAuthClientId: ENV.linkedInOAuthClientId,
    linkedInOAuthClientSecret: ENV.linkedInOAuthClientSecret,
    githubOAuthClientId: ENV.githubOAuthClientId,
    githubOAuthClientSecret: ENV.githubOAuthClientSecret,
  };
}

function readClientCredential(
  definition: OAuthProviderDefinition,
  environment: ConnectorOAuthEnvironment
) {
  const values: Record<string, string> = {
    GOOGLE_OAUTH_CLIENT_ID: environment.googleOAuthClientId,
    GOOGLE_OAUTH_CLIENT_SECRET: environment.googleOAuthClientSecret,
    DROPBOX_OAUTH_CLIENT_ID: environment.dropboxOAuthClientId,
    DROPBOX_OAUTH_CLIENT_SECRET: environment.dropboxOAuthClientSecret,
    MICROSOFT_OAUTH_CLIENT_ID: environment.microsoftOAuthClientId,
    MICROSOFT_OAUTH_CLIENT_SECRET: environment.microsoftOAuthClientSecret,
    LINKEDIN_OAUTH_CLIENT_ID: environment.linkedInOAuthClientId,
    LINKEDIN_OAUTH_CLIENT_SECRET: environment.linkedInOAuthClientSecret,
    GITHUB_OAUTH_CLIENT_ID: environment.githubOAuthClientId,
    GITHUB_OAUTH_CLIENT_SECRET: environment.githubOAuthClientSecret,
  };
  return {
    clientId: values[definition.clientIdEnv] || "",
    clientSecret: values[definition.clientSecretEnv] || "",
  };
}

export function isOAuthConnectorProvider(provider: string): provider is OAuthConnectorProvider {
  return (OAUTH_CONNECTOR_PROVIDERS as readonly string[]).includes(provider);
}

export function getConnectorOAuthConfig(
  provider: OAuthConnectorProvider,
  environment = getDefaultEnvironment(),
  consentScopes: readonly string[] = []
): ConnectorOAuthConfig | null {
  const definition = providerDefinitions[provider];
  const { clientId, clientSecret } = readClientCredential(definition, environment);
  const redirectUri = environment.connectorOAuthRedirectUri.trim();
  if (!clientId.trim() || !clientSecret.trim() || !redirectUri) return null;

  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return null;
  } catch {
    return null;
  }

  return {
    provider,
    ...definition,
    scopes: getProviderScopesForConnectorConsent(provider, consentScopes),
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function getConnectorOAuthAvailability(
  provider: OAuthConnectorProvider,
  environment = getDefaultEnvironment()
) {
  const config = getConnectorOAuthConfig(provider, environment);
  const encryptionKey = getEncryptionKey(environment.connectorTokenEncryptionKey);
  const stateSecret = environment.connectorOAuthStateSecret.trim();
  return {
    provider,
    available: Boolean(config && encryptionKey && stateSecret),
  };
}

export function buildConnectorAuthorizationUrl(config: ConnectorOAuthConfig, state: string) {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  for (const [name, value] of Object.entries(config.authorizationParams ?? {})) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

function stateSignature(encodedPayload: string, stateSecret: string) {
  return createHmac("sha256", stateSecret).update(encodedPayload).digest("base64url");
}

export function createConnectorOAuthState(
  input: Pick<ConnectorOAuthState, "provider" | "userId" | "consentScopes">,
  stateSecret = getDefaultEnvironment().connectorOAuthStateSecret,
  now = Date.now()
) {
  if (!stateSecret.trim()) throw new Error("Connector OAuth state signing is not configured.");
  const payload: ConnectorOAuthState = {
    ...input,
    consentScopes: input.consentScopes?.map((scope) => scope.trim()).filter(Boolean),
    issuedAt: now,
    expiresAt: now + STATE_TTL_MS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${stateSignature(encodedPayload, stateSecret)}`;
}

export function verifyConnectorOAuthState(
  state: string,
  stateSecret = getDefaultEnvironment().connectorOAuthStateSecret,
  now = Date.now()
): ConnectorOAuthState | null {
  const [encodedPayload, signature, ...extra] = state.split(".");
  if (!encodedPayload || !signature || extra.length > 0 || !stateSecret.trim()) return null;
  const expectedSignature = stateSignature(encodedPayload, stateSecret);
  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as ConnectorOAuthState;
    if (
      !isOAuthConnectorProvider(payload.provider) ||
      !Number.isInteger(payload.userId) ||
      payload.userId <= 0 ||
      (payload.consentScopes !== undefined && (
        !Array.isArray(payload.consentScopes) ||
        payload.consentScopes.length > 20 ||
        payload.consentScopes.some((scope) => typeof scope !== "string" || scope.length === 0 || scope.length > 120)
      )) ||
      !Number.isFinite(payload.issuedAt) ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt < now ||
      payload.issuedAt > now + 60_000 ||
      typeof payload.nonce !== "string" ||
      payload.nonce.length < 16
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function getEncryptionKey(encodedKey: string) {
  if (!encodedKey.trim()) return null;
  try {
    const key = Buffer.from(encodedKey, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function encryptConnectorToken(
  token: string,
  encodedKey = getDefaultEnvironment().connectorTokenEncryptionKey
) {
  const key = getEncryptionKey(encodedKey);
  if (!key) throw new Error("Connector token encryption is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptConnectorToken(
  encryptedToken: string,
  encodedKey = getDefaultEnvironment().connectorTokenEncryptionKey
) {
  const key = getEncryptionKey(encodedKey);
  if (!key) throw new Error("Connector token encryption is not configured.");
  const [version, encodedIv, encodedTag, encodedCiphertext, ...extra] = encryptedToken.split(".");
  if (version !== ENCRYPTION_VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra.length > 0) {
    throw new Error("Connector token has an invalid encrypted format.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Connector token could not be decrypted.");
  }
}

function tokenEndpointBody(config: ConnectorOAuthConfig, code: string) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  return body.toString();
}

function refreshTokenEndpointBody(config: ConnectorOAuthConfig, refreshToken: string) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return body.toString();
}

async function parseOAuthTokenResponse(
  response: Response,
  fallbackScopes: string[]
): Promise<OAuthTokenResponse> {
  let payload: Record<string, unknown> = {};
  try {
    payload = await readProviderJson<Record<string, unknown>>(response);
  } catch {
    // A non-JSON provider error must not be surfaced or logged with request data.
  }
  const accessToken = typeof payload.access_token === "string" &&
    payload.access_token.length > 0 &&
    payload.access_token.length <= MAX_PROVIDER_TOKEN_LENGTH
    ? payload.access_token
    : null;
  if (!response.ok || !accessToken) {
    throw new Error("Connector OAuth token exchange failed.");
  }
  const expiresIn = typeof payload.expires_in === "number"
    ? payload.expires_in
    : typeof payload.expires_in === "string" ? Number(payload.expires_in) : NaN;
  const grantedScope = (typeof payload.scope === "string"
    ? payload.scope.split(/[\s,]+/)
    : fallbackScopes)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0 && scope.length <= MAX_SCOPE_LENGTH)
    .slice(0, MAX_GRANTED_SCOPES);
  return {
    accessToken,
    refreshToken: typeof payload.refresh_token === "string" &&
      payload.refresh_token.length > 0 &&
      payload.refresh_token.length <= MAX_PROVIDER_TOKEN_LENGTH
      ? payload.refresh_token
      : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 && expiresIn <= MAX_TOKEN_LIFETIME_SECONDS
      ? new Date(Date.now() + expiresIn * 1000)
      : null,
    tokenType: typeof payload.token_type === "string" && payload.token_type.length <= 100
      ? payload.token_type
      : null,
    grantedScopes: grantedScope,
  };
}

function requireSecureTokenEndpoint(tokenEndpoint: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(tokenEndpoint);
  } catch {
    throw new Error("Connector OAuth token endpoint is invalid.");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new Error("Connector OAuth token endpoint must use credential-free HTTPS.");
  }
  return endpoint.toString();
}

export async function exchangeConnectorAuthorizationCode(
  config: ConnectorOAuthConfig,
  code: string,
  fetcher: typeof fetch = fetch
): Promise<OAuthTokenResponse> {
  const response = await fetcher(requireSecureTokenEndpoint(config.tokenEndpoint), providerRequestInit({
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenEndpointBody(config, code),
  }));
  return parseOAuthTokenResponse(response, config.scopes);
}

export async function refreshConnectorAccessToken(
  config: ConnectorOAuthConfig,
  refreshToken: string,
  fetcher: typeof fetch = fetch
): Promise<OAuthTokenResponse> {
  const response = await fetcher(requireSecureTokenEndpoint(config.tokenEndpoint), providerRequestInit({
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: refreshTokenEndpointBody(config, refreshToken),
  }));
  return parseOAuthTokenResponse(response, config.scopes);
}
