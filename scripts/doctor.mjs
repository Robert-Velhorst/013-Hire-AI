import fs from "node:fs";
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

for (const result of checks) {
  console.log(`${result.status.toUpperCase().padEnd(4)} ${result.name}: ${result.detail}`);
}

const hasFailure = checks.some((result) => result.status === "fail");
process.exitCode = hasFailure ? 1 : 0;
