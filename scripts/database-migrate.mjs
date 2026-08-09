import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import path from "node:path";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required to run database migrations.");
  process.exit(1);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function deepestErrorMessage(error) {
  let current = error;
  const visited = new Set();
  while (
    current instanceof Error &&
    current.cause instanceof Error &&
    !visited.has(current.cause)
  ) {
    visited.add(current);
    current = current.cause;
  }
  return current instanceof Error ? current.message : "unknown error";
}

const connectTimeoutMs = boundedInteger(
  process.env.DB_MIGRATION_CONNECT_TIMEOUT_MS,
  15_000,
  1_000,
  60_000
);
const lockWaitSeconds = boundedInteger(
  process.env.DB_MIGRATION_LOCK_WAIT_SECONDS,
  60,
  1,
  300
);
let connection;
let lockName;
let lockAcquired = false;

try {
  const parsedUrl = new URL(databaseUrl);
  const databaseName =
    decodeURIComponent(parsedUrl.pathname.replace(/^\//, "")) || "default";
  lockName = `hire_ai_migrate_${databaseName}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 64);
  connection = await mysql.createConnection({
    uri: databaseUrl,
    connectTimeout: connectTimeoutMs,
  });
  const [rows] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [
    lockName,
    lockWaitSeconds,
  ]);
  lockAcquired = Number(rows?.[0]?.acquired) === 1;
  if (!lockAcquired) {
    throw new Error(
      `Could not acquire the database migration lock within ${lockWaitSeconds} seconds.`
    );
  }

  await migrate(drizzle(connection), {
    migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle"),
  });
  console.log("Database migrations applied successfully.");
} catch (error) {
  console.error(`Database migration failed: ${deepestErrorMessage(error)}`);
  process.exitCode = 1;
} finally {
  if (connection) {
    if (lockAcquired && lockName) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
      } catch {
        process.exitCode = 1;
        console.error("Database migration lock cleanup failed.");
      }
    }
    await connection.end();
  }
}
