export type ConnectorOAuthPolicyInput = {
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

export type ConnectorOAuthPolicyIssue =
  | "redirect_uri"
  | "token_encryption_key"
  | "state_signing_secret"
  | "google_credentials"
  | "dropbox_credentials"
  | "microsoft_credentials"
  | "linkedin_credentials"
  | "github_credentials"
  | "provider_credentials";

const STATE_SECRET_PLACEHOLDERS = new Set([
  "hire-ai-local-dev-connector-state-secret",
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function isValidConnectorCredential(value: string): boolean {
  return value.length > 0
    && value.length <= 4_096
    && value === value.trim()
    && !CONTROL_CHARACTERS.test(value);
}

export function isValidConnectorOAuthStateSecret(value: string): boolean {
  return value.length >= 32
    && value.length <= 4_096
    && value === value.trim()
    && !CONTROL_CHARACTERS.test(value)
    && !STATE_SECRET_PLACEHOLDERS.has(value);
}

export function decodeConnectorTokenEncryptionKey(value: string): Buffer | null {
  if (!value || value !== value.trim() || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32) return null;
    const canonical = decoded.toString("base64");
    return value === canonical || value === canonical.replace(/=+$/, "") ? decoded : null;
  } catch {
    return null;
  }
}

export function isValidConnectorOAuthRedirectUri(value: string): boolean {
  if (!value || value !== value.trim()) return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
    return (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback))
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && parsed.pathname === "/api/connectors/oauth/callback";
  } catch {
    return false;
  }
}

const providerGroups = [
  { issue: "google_credentials", id: "googleOAuthClientId", secret: "googleOAuthClientSecret", providers: ["gmail", "google_drive"] },
  { issue: "dropbox_credentials", id: "dropboxOAuthClientId", secret: "dropboxOAuthClientSecret", providers: ["dropbox"] },
  { issue: "microsoft_credentials", id: "microsoftOAuthClientId", secret: "microsoftOAuthClientSecret", providers: ["outlook"] },
  { issue: "linkedin_credentials", id: "linkedInOAuthClientId", secret: "linkedInOAuthClientSecret", providers: ["linkedin"] },
  { issue: "github_credentials", id: "githubOAuthClientId", secret: "githubOAuthClientSecret", providers: ["github"] },
] as const;

export function inspectConnectorOAuthPolicy(input: ConnectorOAuthPolicyInput): {
  enabled: boolean;
  configuredProviders: string[];
  issues: ConnectorOAuthPolicyIssue[];
} {
  const enabled = Object.values(input).some((value) => value.length > 0);
  if (!enabled) return { enabled: false, configuredProviders: [], issues: [] };

  const issues: ConnectorOAuthPolicyIssue[] = [];
  if (!isValidConnectorOAuthRedirectUri(input.connectorOAuthRedirectUri)) issues.push("redirect_uri");
  if (!decodeConnectorTokenEncryptionKey(input.connectorTokenEncryptionKey)) issues.push("token_encryption_key");
  if (!isValidConnectorOAuthStateSecret(input.connectorOAuthStateSecret)) issues.push("state_signing_secret");

  const configuredProviders: string[] = [];
  for (const group of providerGroups) {
    const clientId = input[group.id];
    const clientSecret = input[group.secret];
    const absent = clientId.length === 0 && clientSecret.length === 0;
    if (absent) continue;
    if (!isValidConnectorCredential(clientId) || !isValidConnectorCredential(clientSecret)) {
      issues.push(group.issue);
      continue;
    }
    configuredProviders.push(...group.providers);
  }
  if (configuredProviders.length === 0) issues.push("provider_credentials");

  return { enabled, configuredProviders, issues };
}
