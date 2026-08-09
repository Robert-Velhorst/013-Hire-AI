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

for (const file of ["package.json", "pnpm-lock.yaml", "drizzle/meta/_journal.json", "server/_core/index.ts"]) {
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

check(
  "document malware scanning",
  isProduction && !String(process.env.FILE_MALWARE_SCAN_URL || "").trim() ? "fail" : !String(process.env.FILE_MALWARE_SCAN_URL || "").trim() ? "warn" : "pass",
  String(process.env.FILE_MALWARE_SCAN_URL || "").trim() ? "scanner endpoint configured" : "required before production document uploads"
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
