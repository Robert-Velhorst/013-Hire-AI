import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import * as schema from "../drizzle/schema";
import {
  compareDatabaseSchema,
  hasDatabaseSchemaDrift,
  type DatabaseColumnRow,
  type DatabaseIndexRow,
  type ExpectedDatabaseColumn,
  type ExpectedDatabaseIndex,
} from "./lib/database-schema-audit";

function expectedRuntimeSchema() {
  const tables = new Map<string, Set<string>>();
  const columns = new Map<string, Map<string, ExpectedDatabaseColumn>>();
  const indexes = new Map<string, Map<string, ExpectedDatabaseIndex>>();
  for (const value of Object.values(schema)) {
    try {
      const config = getTableConfig(value as MySqlTable);
      if (config.name && config.columns.length > 0) {
        tables.set(config.name, new Set(config.columns.map((column) => column.name)));
        columns.set(config.name, new Map(config.columns.map((column) => [
          column.name,
          {
            sqlType: column.getSQLType(),
            nullable: !column.notNull,
          },
        ])));
        indexes.set(config.name, new Map(config.indexes.map((index) => [
          index.config.name,
          {
            columns: index.config.columns
              .map((column) => "name" in column ? column.name : null)
              .filter((column): column is string => Boolean(column)),
            unique: index.config.unique,
          },
        ])));
      }
    } catch {
      // The schema module also exports types and relation helpers.
    }
  }
  return { tables, columns, indexes };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the schema audit.");

  const connection = await mysql.createConnection(databaseUrl);
  try {
    const [columnRows] = await connection.query<DatabaseColumnRow[]>(
      `SELECT table_name AS tableName, column_name AS columnName,
              column_type AS sqlType, is_nullable AS isNullable
       FROM information_schema.columns
       WHERE table_schema = DATABASE()`
    );
    const [indexRows] = await connection.query<DatabaseIndexRow[]>(
      `SELECT table_name AS tableName, index_name AS indexName, non_unique AS nonUnique,
              seq_in_index AS sequence, column_name AS columnName
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()`
    );
    const expected = expectedRuntimeSchema();
    if (expected.tables.size === 0) throw new Error("Runtime schema metadata is empty.");
    const audit = compareDatabaseSchema(
      expected.tables,
      columnRows,
      expected.indexes,
      indexRows,
      expected.columns
    );
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
