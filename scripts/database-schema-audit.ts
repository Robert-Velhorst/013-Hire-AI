import "dotenv/config";
import mysql from "mysql2/promise";
import { auditRuntimeDatabaseSchema } from "../server/databaseSchemaValidation";
import { hasDatabaseSchemaDrift } from "./lib/database-schema-audit";

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const connection = await mysql.createConnection({
    uri: databaseUrl,
    connectTimeout: 15_000,
  });
  try {
    const audit = await auditRuntimeDatabaseSchema(connection);
    console.log(JSON.stringify(audit, null, 2));
    if (hasDatabaseSchemaDrift(audit)) throw new Error("Database schema drift");
  } finally {
    connection.destroy();
  }
}

main().catch(() => {
  console.error(
    "Database schema audit failed. Check connectivity and reviewed migrations."
  );
  process.exitCode = 1;
});
