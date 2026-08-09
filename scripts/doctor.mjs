import "dotenv/config";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

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
  "VITE_APP_ID",
  "OAUTH_SERVER_URL",
  "OWNER_OPEN_ID",
  "BUILT_IN_FORGE_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];
const missing = requiredProductionEnv.filter((name) => !String(process.env[name] || "").trim());
check(
  "production configuration",
  isProduction && missing.length > 0 ? "fail" : missing.length > 0 ? "warn" : "pass",
  missing.length > 0 ? `${missing.length} required production variable(s) are not configured` : "required variables configured"
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
const malwareScanTimeout = Number.parseInt(String(process.env.FILE_MALWARE_SCAN_TIMEOUT_MS || "30000"), 10);
const malwareScanConcurrency = Number.parseInt(String(process.env.FILE_MALWARE_SCAN_MAX_CONCURRENCY || "2"), 10);
const malwareModeValid = ["auto", "http", "windows_defender"].includes(malwareScanMode);
const malwareTimeoutValid = Number.isInteger(malwareScanTimeout) && malwareScanTimeout >= 1_000 && malwareScanTimeout <= 120_000;
const malwareConcurrencyValid = Number.isInteger(malwareScanConcurrency) && malwareScanConcurrency >= 1 && malwareScanConcurrency <= 8;
let malwareScanUrlValid = !malwareScanUrl;
try {
  if (malwareScanUrl) {
    const parsed = new URL(malwareScanUrl);
    malwareScanUrlValid = ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  }
} catch { malwareScanUrlValid = false; }
const defenderAvailable = windowsDefenderAvailable();
const scannerAvailable = malwareModeValid && malwareTimeoutValid && malwareConcurrencyValid && malwareScanUrlValid && (
  (malwareScanMode === "http" && Boolean(malwareScanUrl))
  || (malwareScanMode === "windows_defender" && defenderAvailable)
  || (malwareScanMode === "auto" && (Boolean(malwareScanUrl) || defenderAvailable))
);
check(
  "document malware scanning",
  !malwareModeValid || !malwareScanUrlValid || !malwareTimeoutValid || !malwareConcurrencyValid || (isProduction && !scannerAvailable) ? "fail" : scannerAvailable ? "pass" : "warn",
  !malwareModeValid ? "mode must be auto, http, or windows_defender"
    : !malwareScanUrlValid ? "scanner URL must be HTTP(S) without embedded credentials"
      : !malwareTimeoutValid ? "timeout must be 1000-120000ms"
        : !malwareConcurrencyValid ? "concurrency must be 1-8"
          : malwareScanUrl && malwareScanMode !== "windows_defender" ? `bounded HTTP scanner configured (${malwareScanConcurrency} concurrent)`
            : defenderAvailable && malwareScanMode !== "http" ? `Windows Defender scanner available (${malwareScanConcurrency} concurrent)`
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
const haiToken = String(process.env.HAI_CONNECTOR_TOKEN || "").trim();
const haiUserId = Number.parseInt(String(process.env.HAI_CONNECTOR_USER_ID || "").trim(), 10);
const haiUrl = String(process.env.HAI_CONNECTOR_URL || "").trim();
let haiDetail = "disabled";
let haiStatus = "pass";
if (haiEnabled) {
  const errors = [];
  if (haiToken.length < 32 || /[\r\n]/.test(haiToken)) errors.push("32+ character token");
  if (!Number.isSafeInteger(haiUserId) || haiUserId <= 0) errors.push("positive user ID");
  try {
    const parsed = new URL(haiUrl);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const parsedIp = net.isIP(host) ? host : null;
    const localHost = ["localhost", "host.docker.internal", "gateway"].includes(host)
      || (parsedIp && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(parsedIp));
    if (!["http:", "https:"].includes(parsed.protocol) || !localHost || parsed.username || parsed.password || parsed.search || parsed.hash) {
      errors.push("plain local/private connector URL");
    }
  } catch {
    errors.push("valid connector URL");
  }
  haiStatus = errors.length > 0 ? "fail" : "pass";
  haiDetail = errors.length > 0 ? `missing or invalid: ${errors.join(", ")}` : "configured read-only local bridge";
}
check("HAI connector", haiStatus, haiDetail);

for (const result of checks) {
  console.log(`${result.status.toUpperCase().padEnd(4)} ${result.name}: ${result.detail}`);
}

const hasFailure = checks.some((result) => result.status === "fail");
process.exitCode = hasFailure ? 1 : 0;
