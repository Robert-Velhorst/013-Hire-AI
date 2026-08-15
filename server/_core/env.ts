import { defaultHaiConnectorConfig, validateHaiConnectorConfig } from "../haiConnectorConfig";

export function resolveProductionRuntime(nodeEnv: string | undefined, moduleUrl: string): boolean {
  if (nodeEnv === "production") return true;
  if (nodeEnv === "development" || nodeEnv === "test") return false;

  return /\/dist\/index\.js(?:$|[?#])/.test(moduleUrl.replace(/\\/g, "/"));
}

const isProduction = resolveProductionRuntime(process.env.NODE_ENV, import.meta.url);
const readEnv = (name: string) => process.env[name] ?? "";
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_SESSION_TTL_MS = 15 * 60 * 1000;
export const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const JWT_SECRET_PLACEHOLDERS = new Set([
  "replace-with-a-long-random-secret",
  "hire-ai-local-dev-cookie-secret",
]);
export function isValidJwtSecret(value: string | undefined): boolean {
  if (!value || value.length < 32 || value.length > 4_096) return false;
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return !JWT_SECRET_PLACEHOLDERS.has(value);
}
export function readBooleanFeatureFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}
export const readBoundedIntegerValue = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) => {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
};
export const isOptionalBoundedIntegerValue = (
  value: string | undefined,
  minimum: number,
  maximum: number
) => {
  if (!value?.trim()) return true;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum;
};
const readBoundedInteger = (name: string, fallback: number, minimum: number, maximum: number) => {
  return readBoundedIntegerValue(readEnv(name), fallback, minimum, maximum);
};
const readOptionalCsv = (name: string) => {
  const values = readEnv(name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
};
const readEnvWithLocalFallback = (name: string, fallback: string) => {
  const value = readEnv(name);
  if (value.trim()) return value;
  return isProduction ? "" : fallback;
};

export const ENV = {
  appId: readEnvWithLocalFallback("VITE_APP_ID", "hire-ai-local-dev"),
  cookieSecret: readEnvWithLocalFallback("JWT_SECRET", "hire-ai-local-dev-cookie-secret"),
  sessionTtlMs: readBoundedInteger(
    "SESSION_TTL_MS",
    DEFAULT_SESSION_TTL_MS,
    MIN_SESSION_TTL_MS,
    MAX_SESSION_TTL_MS
  ),
  databaseUrl: readEnv("DATABASE_URL"),
  databasePoolLimit: readBoundedInteger("DATABASE_POOL_LIMIT", 10, 1, 50),
  databasePoolQueueLimit: readBoundedInteger("DATABASE_POOL_QUEUE_LIMIT", 100, 1, 1000),
  databasePoolIdleTimeoutMs: readBoundedInteger("DATABASE_POOL_IDLE_TIMEOUT_MS", 60_000, 10_000, 600_000),
  oAuthServerUrl: readEnv("OAUTH_SERVER_URL"),
  ownerOpenId: readEnv("OWNER_OPEN_ID"),
  isProduction,
  forgeApiUrl: readEnv("BUILT_IN_FORGE_API_URL"),
  forgeApiKey: readEnv("BUILT_IN_FORGE_API_KEY"),
  connectorOAuthRedirectUri: readEnv("CONNECTOR_OAUTH_REDIRECT_URI"),
  connectorTokenEncryptionKey: readEnv("CONNECTOR_TOKEN_ENCRYPTION_KEY"),
  connectorOAuthStateSecret: readEnvWithLocalFallback("CONNECTOR_OAUTH_STATE_SECRET", "hire-ai-local-dev-connector-state-secret"),
  googleOAuthClientId: readEnv("GOOGLE_OAUTH_CLIENT_ID"),
  googleOAuthClientSecret: readEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
  dropboxOAuthClientId: readEnv("DROPBOX_OAUTH_CLIENT_ID"),
  dropboxOAuthClientSecret: readEnv("DROPBOX_OAUTH_CLIENT_SECRET"),
  microsoftOAuthClientId: readEnv("MICROSOFT_OAUTH_CLIENT_ID"),
  microsoftOAuthClientSecret: readEnv("MICROSOFT_OAUTH_CLIENT_SECRET"),
  linkedInOAuthClientId: readEnv("LINKEDIN_OAUTH_CLIENT_ID"),
  linkedInOAuthClientSecret: readEnv("LINKEDIN_OAUTH_CLIENT_SECRET"),
  githubOAuthClientId: readEnv("GITHUB_OAUTH_CLIENT_ID"),
  githubOAuthClientSecret: readEnv("GITHUB_OAUTH_CLIENT_SECRET"),
  // This worker only processes explicitly opted-in users and never submits to an
  // external portal. Keep it available unless an operator explicitly disables it.
  autonomousSchedulerEnabled: readBooleanFeatureFlag(process.env.AUTONOMOUS_SCHEDULER_ENABLED, true),
  jobScrapingSchedulerEnabled: readBooleanFeatureFlag(process.env.JOB_SCRAPING_SCHEDULER_ENABLED, false),
  jobScrapingIntervalMinutes: readBoundedInteger("JOB_SCRAPING_INTERVAL_MINUTES", 60, 5, 1440),
  jobScrapingMaxJobsPerRun: readBoundedInteger("JOB_SCRAPING_MAX_JOBS_PER_RUN", 100, 10, 1000),
  jobScrapingSourceTimeoutMs: readBoundedInteger("JOB_SCRAPING_SOURCE_TIMEOUT_MS", 90_000, 5_000, 300_000),
  jobScrapingMaxConcurrentSources: readBoundedInteger("JOB_SCRAPING_MAX_CONCURRENT_SOURCES", 3, 1, 10),
  jobScrapingEnabledPlatforms: readOptionalCsv("JOB_SCRAPING_ENABLED_PLATFORMS"),
};

export function assertRequiredEnv(names: string[]) {
  const missing = names.filter((name) => !readEnv(name).trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}

export function validateProductionEnv() {
  if (!isProduction) return;

  assertRequiredEnv([
    "DATABASE_URL",
    "JWT_SECRET",
    "VITE_APP_ID",
    "OAUTH_SERVER_URL",
    "OWNER_OPEN_ID",
    "BUILT_IN_FORGE_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]);
  if (!isValidJwtSecret(readEnv("JWT_SECRET"))) {
    throw new Error(
      "JWT_SECRET must contain 32-4096 non-control characters, have no surrounding whitespace, and not use a known placeholder"
    );
  }
  if (!isOptionalBoundedIntegerValue(readEnv("SESSION_TTL_MS"), MIN_SESSION_TTL_MS, MAX_SESSION_TTL_MS)) {
    throw new Error(
      `SESSION_TTL_MS must be an integer between ${MIN_SESSION_TTL_MS} and ${MAX_SESSION_TTL_MS}`
    );
  }
  const haiConnectorError = validateHaiConnectorConfig(defaultHaiConnectorConfig());
  if (haiConnectorError) {
    throw new Error(haiConnectorError);
  }
}
