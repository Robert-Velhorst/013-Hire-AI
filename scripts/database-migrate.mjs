import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { readMigrationFiles } from "drizzle-orm/migrator";
import path from "node:path";
import { planPendingMigrations } from "./database-migration-plan.mjs";

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
let database;
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

  const migrationsFolder = path.resolve(import.meta.dirname, "..", "drizzle");
  const migrations = readMigrationFiles({ migrationsFolder });
  database = drizzle(connection);
  const migrationConfig = { migrationsTable: "__drizzle_migrations" };

  // Initialize the Drizzle ledger, then apply by exact SQL hash in journal
  // order. The stock MySQL migrator uses the maximum created_at as a cursor,
  // which silently skips committed entries when journal timestamps go back.
  await database.dialect.migrate([], database.session, migrationConfig);
  const [appliedRows] = await connection.query(
    "SELECT hash, created_at FROM `__drizzle_migrations`"
  );
  const migrationRows = Array.isArray(appliedRows) ? appliedRows : [];
  const latestCreatedAt = migrationRows.reduce(
    (latest, row) => Math.max(latest, Number(row.created_at) || 0),
    0
  );
  const pending = planPendingMigrations(
    migrations,
    migrationRows.map(row => String(row.hash)),
    latestCreatedAt
  );

  for (const migration of pending) {
    await database.dialect.migrate(
      [migration],
      database.session,
      migrationConfig
    );
  }
  console.log(`Database migrations applied successfully (${pending.length} new).`);
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
