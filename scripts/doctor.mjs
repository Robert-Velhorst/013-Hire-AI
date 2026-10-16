import "dotenv/config";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { validateHaiConnectorUrl } from "../shared/haiConnectorEndpointPolicy.mjs";
import { inspectMalwareScannerPolicy } from "../shared/malwareScannerEndpointPolicy.mjs";
import { requireAllowedServiceBaseUrl } from "../shared/trustedServiceOriginPolicy.mjs";
import { inspectStripeBillingPolicy } from "../shared/stripeBillingPolicy.mjs";

const root = process.cwd();
const isProduction = process.env.NODE_ENV === "production";
const checks = [];

function check(name, status, detail) {
  checks.push({ name, status, detail });
}

function hasFile(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const runtimeEntrypoint = hasFile("dist/index.js") ? "dist/index.js" : "server/_core/index.ts";
const runtimeFiles = ["package.json", "pnpm-lock.yaml", "drizzle/meta/_journal.json", runtimeEntrypoint];
for (const file of runtimeFiles) {
  check(file, hasFile(file) ? "pass" : "fail", hasFile(file) ? "found" : "missing");
}

const migrationFiles = hasFile("drizzle")
  ? fs.readdirSync(path.join(root, "drizzle")).filter((file) => /^\d{4}_.+\.sql$/.test(file))
  : [];
check("migration files", migrationFiles.length > 0 ? "pass" : "fail", `${migrationFiles.length} migration(s) found`);

const requiredProductionEnv = [
  "DATABASE_URL",
  "JWT_SECRET",
  "ERASURE_IDENTITY_HMAC_KEYS",
  "VITE_APP_ID",
  "OAUTH_SERVER_URL",
  "OAUTH_SERVER_ALLOWED_ORIGINS",
  "OWNER_OPEN_ID",
  "BUILT_IN_FORGE_API_KEY",
];
const missing = requiredProductionEnv.filter((name) => !String(process.env[name] || "").trim());
check(
  "production configuration",
  isProduction && missing.length > 0 ? "fail" : missing.length > 0 ? "warn" : "pass",
  missing.length > 0 ? `${missing.length} required production variable(s) are not configured` : "required variables configured"
);

const stripeBillingPolicy = inspectStripeBillingPolicy(process.env);
check(
  "Stripe billing",
  stripeBillingPolicy.issue ? (isProduction ? "fail" : "warn") : "pass",
  stripeBillingPolicy.issue ?? (stripeBillingPolicy.enabled ? "explicitly enabled" : "disabled by default")
);

function windowsDefenderAvailable() {
  if (process.platform !== "win32") return false;
  const candidates = [];
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, "Windows Defender", "MpCmdRun.exe"));
  if (process.env.ProgramData) {
    const root = path.join(process.env.ProgramData, "Microsoft", "Windows Defender", "Platform");
    if (fs.existsSync(root)) {
      const versions = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
      candidates.unshift(...versions.map(version => path.join(root, version, "MpCmdRun.exe")));
    }
  }
  return candidates.some(candidate => fs.existsSync(candidate));
}

const malwareScanMode = String(process.env.FILE_MALWARE_SCAN_MODE || "auto").trim().toLowerCase();
const malwareScanUrl = String(process.env.FILE_MALWARE_SCAN_URL || "").trim();
const malwareScanAllowedOrigins = String(process.env.FILE_MALWARE_SCAN_ALLOWED_ORIGINS || "");
const malwareScanTimeout = Number.parseInt(String(process.env.FILE_MALWARE_SCAN_TIMEOUT_MS || "30000"), 10);
const malwareScanConcurrency = Number.parseInt(String(process.env.FILE_MALWARE_SCAN_MAX_CONCURRENCY || "2"), 10);
const malwareModeValid = ["auto", "http", "windows_defender"].includes(malwareScanMode);
const malwareTimeoutValid = Number.isInteger(malwareScanTimeout) && malwareScanTimeout >= 1_000 && malwareScanTimeout <= 120_000;
const malwareConcurrencyValid = Number.isInteger(malwareScanConcurrency) && malwareScanConcurrency >= 1 && malwareScanConcurrency <= 8;
const malwareScannerPolicy = inspectMalwareScannerPolicy({
  mode: malwareScanMode,
  endpoint: malwareScanUrl,
  allowedOrigins: malwareScanAllowedOrigins,
});
const defenderAvailable = windowsDefenderAvailable();
const scannerAvailable = malwareTimeoutValid && malwareConcurrencyValid && (
  malwareScannerPolicy.mode === "http" ||
  (malwareScannerPolicy.mode === "windows_defender" && defenderAvailable)
);

const oauthPortalUrl = String(process.env.OAUTH_PORTAL_URL || process.env.VITE_OAUTH_PORTAL_URL || "").trim();
let oauthPortalValid = false;
try {
  const parsed = new URL(oauthPortalUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  oauthPortalValid = (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback))
    && !parsed.username
    && !parsed.password
    && !parsed.search
    && !parsed.hash;
} catch { oauthPortalValid = false; }
check(
  "OAuth portal",
  !oauthPortalUrl && !isProduction ? "warn" : oauthPortalValid ? "pass" : "fail",
  !oauthPortalUrl && !isProduction
    ? "not configured outside production"
    : oauthPortalValid
      ? "trusted runtime URL configured"
      : "OAUTH_PORTAL_URL must be HTTPS or loopback HTTP without credentials, query parameters, or fragments"
);

const oauthServerUrl = String(process.env.OAUTH_SERVER_URL || "").trim();
const oauthServerAllowedOrigins = String(process.env.OAUTH_SERVER_ALLOWED_ORIGINS || "");
let oauthServerValid = false;
try {
  const oauthApi = requireAllowedServiceBaseUrl(oauthServerUrl, oauthServerAllowedOrigins);
  if (isProduction && oauthApi.protocol !== "https:") {
    throw new Error("Production OAuth API must use HTTPS.");
  }
  oauthServerValid = true;
} catch { oauthServerValid = false; }
check(
  "OAuth API",
  !oauthServerUrl && !isProduction ? "warn" : oauthServerValid ? "pass" : "fail",
  !oauthServerUrl && !isProduction
    ? "not configured outside production"
    : oauthServerValid
      ? "trusted API origin explicitly allowlisted"
      : "OAUTH_SERVER_URL must use HTTPS (or loopback HTTP) and match an origin-only OAUTH_SERVER_ALLOWED_ORIGINS entry"
);

const jwtSecret = String(process.env.JWT_SECRET || "");
const jwtSecretPlaceholders = new Set([
  "replace-with-a-long-random-secret",
  "hire-ai-local-dev-cookie-secret",
]);
const jwtSecretValid = jwtSecret.length >= 32
  && jwtSecret.length <= 4_096
  && jwtSecret === jwtSecret.trim()
  && !/[\u0000-\u001f\u007f]/.test(jwtSecret)
  && !jwtSecretPlaceholders.has(jwtSecret);
check(
  "session signing secret",
  !jwtSecret && !isProduction ? "warn" : jwtSecretValid ? "pass" : "fail",
  !jwtSecret && !isProduction
    ? "not configured outside production"
    : jwtSecretValid
      ? "bounded non-placeholder secret configured"
      : "JWT_SECRET must contain 32-4096 non-control characters, have no surrounding whitespace, and not use a known placeholder"
);

const erasureIdentityKeys = String(process.env.ERASURE_IDENTITY_HMAC_KEYS || "").split(",");
const erasureIdentityKeysValid = erasureIdentityKeys.length > 0
  && erasureIdentityKeys.length <= 64
  && erasureIdentityKeys.every(key => key.length >= 32 && key.length <= 4_096
    && key === key.trim()
    && !key.startsWith("replace-with-")
    && !key.startsWith("hire-ai-local-dev-")
    && !/[\u0000-\u001f\u007f,]/.test(key));
check(
  "erasure identity protection key",
  !process.env.ERASURE_IDENTITY_HMAC_KEYS && !isProduction ? "warn" : erasureIdentityKeysValid ? "pass" : "fail",
  !process.env.ERASURE_IDENTITY_HMAC_KEYS && !isProduction
    ? "not configured outside production"
    : erasureIdentityKeysValid
      ? `${erasureIdentityKeys.length} ordered key(s) configured`
      : "ERASURE_IDENTITY_HMAC_KEYS must contain up to 64 ordered comma-separated 32-4096 character secrets without placeholders or whitespace"
);

const sessionTtlValue = String(process.env.SESSION_TTL_MS || "").trim();
const sessionTtlMs = Number(sessionTtlValue || "604800000");
const sessionTtlValid = Number.isSafeInteger(sessionTtlMs)
  && sessionTtlMs >= 900_000
  && sessionTtlMs <= 2_592_000_000;
check(
  "session lifetime policy",
  sessionTtlValid ? "pass" : "fail",
  sessionTtlValid
    ? `${sessionTtlMs}ms absolute lifetime`
    : "SESSION_TTL_MS must be an integer between 900000 and 2592000000ms"
);

const connectorValues = {
  redirectUri: String(process.env.CONNECTOR_OAUTH_REDIRECT_URI || ""),
  encryptionKey: String(process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY || ""),
  stateSecret: String(process.env.CONNECTOR_OAUTH_STATE_SECRET || ""),
};
const connectorProviderGroups = [
  ["google", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", 2],
  ["dropbox", "DROPBOX_OAUTH_CLIENT_ID", "DROPBOX_OAUTH_CLIENT_SECRET", 1],
  ["microsoft", "MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET", 1],
  ["linkedin", "LINKEDIN_OAUTH_CLIENT_ID", "LINKEDIN_OAUTH_CLIENT_SECRET", 1],
  ["github", "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", 1],
];
const connectorAnyConfigured = Object.values(connectorValues).some(value => value.length > 0)
  || connectorProviderGroups.some(([, id, secret]) => String(process.env[id] || "").length > 0 || String(process.env[secret] || "").length > 0);
const connectorIssues = [];
let connectorCount = 0;
if (connectorAnyConfigured) {
  try {
    const parsed = new URL(connectorValues.redirectUri);
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(host);
    if (!((parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback))
      && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && parsed.pathname === "/api/connectors/oauth/callback")) connectorIssues.push("redirect_uri");
  } catch { connectorIssues.push("redirect_uri"); }
  const keyPatternValid = /^[A-Za-z0-9+/]+={0,2}$/.test(connectorValues.encryptionKey)
    && connectorValues.encryptionKey === connectorValues.encryptionKey.trim();
  const decodedKey = keyPatternValid ? Buffer.from(connectorValues.encryptionKey, "base64") : null;
  const canonicalKey = decodedKey?.toString("base64") || "";
  if (!decodedKey || decodedKey.length !== 32
    || ![canonicalKey, canonicalKey.replace(/=+$/, "")].includes(connectorValues.encryptionKey)) connectorIssues.push("token_encryption_key");
  if (connectorValues.stateSecret.length < 32 || connectorValues.stateSecret.length > 4_096
    || connectorValues.stateSecret !== connectorValues.stateSecret.trim()
    || /[\u0000-\u001f\u007f]/.test(connectorValues.stateSecret)
    || connectorValues.stateSecret === "hire-ai-local-dev-connector-state-secret") connectorIssues.push("state_signing_secret");
  for (const [name, idName, secretName, count] of connectorProviderGroups) {
    const id = String(process.env[idName] || "");
    const secret = String(process.env[secretName] || "");
    if (!id && !secret) continue;
    const valid = [id, secret].every(value => value.length > 0 && value.length <= 4_096
      && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
    if (!valid) connectorIssues.push(`${name}_credentials`);
    else connectorCount += count;
  }
  if (connectorCount === 0) connectorIssues.push("provider_credentials");
}
check(
  "connector OAuth",
  connectorIssues.length > 0 ? "fail" : "pass",
  !connectorAnyConfigured ? "disabled"
    : connectorIssues.length > 0 ? `incomplete or unsafe configuration: ${connectorIssues.join(", ")}`
      : `${connectorCount} connector(s) configured`
);

const databasePoolLimit = Number(process.env.DATABASE_POOL_LIMIT || "10");
const databasePoolQueueLimit = Number(process.env.DATABASE_POOL_QUEUE_LIMIT || "100");
const databasePoolIdleTimeoutMs = Number(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS || "60000");
const databasePoolPolicyValid = Number.isSafeInteger(databasePoolLimit)
  && databasePoolLimit >= 1
  && databasePoolLimit <= 50
  && Number.isSafeInteger(databasePoolQueueLimit)
  && databasePoolQueueLimit >= 1
  && databasePoolQueueLimit <= 1000
  && Number.isSafeInteger(databasePoolIdleTimeoutMs)
  && databasePoolIdleTimeoutMs >= 10_000
  && databasePoolIdleTimeoutMs <= 600_000;
check(
  "database pool policy",
  databasePoolPolicyValid ? "pass" : "fail",
  databasePoolPolicyValid
    ? `${databasePoolLimit} connections, ${databasePoolQueueLimit} queued requests, ${databasePoolIdleTimeoutMs}ms idle timeout`
    : "connections must be 1-50, queue limit 1-1000, and idle timeout 10000-600000ms"
);
check(
  "document malware scanning",
  !malwareModeValid || !malwareTimeoutValid || !malwareConcurrencyValid || (isProduction && !scannerAvailable) || (malwareScannerPolicy.issue && Boolean(malwareScanUrl)) ? "fail" : scannerAvailable ? "pass" : "warn",
  !malwareModeValid || (malwareScannerPolicy.issue && Boolean(malwareScanUrl)) ? malwareScannerPolicy.issue
    : !malwareTimeoutValid ? "timeout must be 1000-120000ms"
      : !malwareConcurrencyValid ? "concurrency must be 1-8"
        : scannerAvailable && malwareScannerPolicy.mode === "http" ? `bounded, explicitly allowlisted HTTP scanner configured (${malwareScanConcurrency} concurrent)`
          : scannerAvailable && malwareScannerPolicy.mode === "windows_defender" ? `Windows Defender scanner available (${malwareScanConcurrency} concurrent)`
            : "scanner required before production document uploads"
);

const scrapingEnabled = String(process.env.JOB_SCRAPING_SCHEDULER_ENABLED || "").trim().toLowerCase() === "true";
const scrapingAllowlist = String(process.env.JOB_SCRAPING_ENABLED_PLATFORMS || "").split(",").map(value => value.trim()).filter(Boolean);
const scrapingConcurrency = Number.parseInt(String(process.env.JOB_SCRAPING_MAX_CONCURRENT_SOURCES || "3"), 10);
const scrapingTimeout = Number.parseInt(String(process.env.JOB_SCRAPING_SOURCE_TIMEOUT_MS || "90000"), 10);
const scrapingPolicyValid = Number.isInteger(scrapingConcurrency)
  && scrapingConcurrency >= 1
  && scrapingConcurrency <= 10
  && Number.isInteger(scrapingTimeout)
  && scrapingTimeout >= 5_000
  && scrapingTimeout <= 300_000;
check(
  "discovery traffic policy",
  !scrapingPolicyValid || (isProduction && scrapingEnabled && scrapingAllowlist.length === 0) ? "fail" : scrapingEnabled && scrapingAllowlist.length === 0 ? "warn" : "pass",
  !scrapingPolicyValid
    ? "concurrency must be 1-10 and source timeout must be 5000-300000ms"
    : scrapingEnabled
      ? `${scrapingConcurrency} concurrent source(s), ${scrapingTimeout}ms timeout, ${scrapingAllowlist.length || "no"} allowlisted source(s)`
      : "scheduler disabled; bounded defaults configured"
);

const haiEnabled = String(process.env.HAI_CONNECTOR_ENABLED || "").trim().toLowerCase() === "true";
const haiToken = String(process.env.HAI_CONNECTOR_TOKEN || "");
const haiUserIdValue = String(process.env.HAI_CONNECTOR_USER_ID || "");
const haiUserId = /^[1-9]\d*$/.test(haiUserIdValue) ? Number(haiUserIdValue) : NaN;
const haiUrl = String(process.env.HAI_CONNECTOR_URL || "");
const haiAllowedOrigins = String(process.env.HAI_CONNECTOR_ALLOWED_ORIGINS || "");
let haiDetail = "disabled";
let haiStatus = "pass";
if (haiEnabled) {
  const errors = [];
  if (haiToken.length < 32 || haiToken.length > 4_096) errors.push("32-4096 character token");
  else if (/\s|[\u0000-\u001f\u007f]/.test(haiToken)) errors.push("token without whitespace or control characters");
  else if (haiToken === "replace-with-at-least-32-random-characters") errors.push("non-placeholder token");
  if (!Number.isSafeInteger(haiUserId) || haiUserId <= 0) errors.push("positive user ID");
  const endpointError = validateHaiConnectorUrl(haiUrl, haiAllowedOrigins);
  if (endpointError) {
    if (endpointError.includes("/api/hai/a2a")) errors.push("exact /api/hai/a2a endpoint");
    else if (endpointError.includes("ALLOWED_ORIGINS")) errors.push("valid HAI_CONNECTOR_ALLOWED_ORIGINS HTTPS origins");
    else if (endpointError.includes("not explicitly allowlisted")) errors.push("explicitly allowlisted public HTTPS connector origin");
    else if (endpointError.includes("Public HAI connector endpoints must use HTTPS")) errors.push("HTTPS for public connector endpoints");
    else errors.push("valid local/private or allowlisted HTTPS connector URL");
  }
  haiStatus = errors.length > 0 ? "fail" : "pass";
  haiDetail = errors.length > 0 ? `missing or invalid: ${errors.join(", ")}` : "configured authenticated read-only bridge";
}
check("HAI connector", haiStatus, haiDetail);

for (const result of checks) {
  console.log(`${result.status.toUpperCase().padEnd(4)} ${result.name}: ${result.detail}`);
}

const hasFailure = checks.some((result) => result.status === "fail");
process.exitCode = hasFailure ? 1 : 0;
