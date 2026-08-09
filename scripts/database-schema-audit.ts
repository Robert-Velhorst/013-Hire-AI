import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import * as schema from "../drizzle/schema";
import {
  compareDatabaseSchema,
  hasDatabaseSchemaDrift,
  type DatabaseColumnRow,
} from "./lib/database-schema-audit";

function expectedRuntimeSchema() {
  const expected = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    try {
      const config = getTableConfig(value as MySqlTable);
      if (config.name && config.columns.length > 0) {
        expected.set(config.name, new Set(config.columns.map((column) => column.name)));
      }
    } catch {
      // The schema module also exports types and relation helpers.
    }
  }
  return expected;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the schema audit.");

  const connection = await mysql.createConnection(databaseUrl);
  try {
    const [rows] = await connection.query<DatabaseColumnRow[]>(
      `SELECT table_name AS tableName, column_name AS columnName
       FROM information_schema.columns
       WHERE table_schema = DATABASE()`
    );
    const expected = expectedRuntimeSchema();
    if (expected.size === 0) throw new Error("Runtime schema metadata is empty.");
    const audit = compareDatabaseSchema(expected, rows);
    console.log(JSON.stringify(audit, null, 2));
    if (hasDatabaseSchemaDrift(audit)) {
      throw new Error("Database schema does not exactly match the runtime model.");
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database schema audit failed.");
  process.exit(1);
});
