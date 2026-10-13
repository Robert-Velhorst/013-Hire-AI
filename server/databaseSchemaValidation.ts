import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import * as schema from "../drizzle/schema";
import {
  compareDatabaseSchema,
  hasDatabaseSchemaDrift,
  type DatabaseColumnRow,
  type DatabaseIndexRow,
  type DatabaseForeignKeyRow,
  type ExpectedDatabaseColumn,
  type ExpectedDatabaseForeignKey,
  type ExpectedDatabaseIndex,
} from "../scripts/lib/database-schema-audit";

export function expectedRuntimeSchema() {
  const tables = new Map<string, Set<string>>();
  const columns = new Map<string, Map<string, ExpectedDatabaseColumn>>();
  const indexes = new Map<string, Map<string, ExpectedDatabaseIndex>>();
  const foreignKeys = new Map<string, ExpectedDatabaseForeignKey[]>();
  for (const value of Object.values(schema)) {
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as MySqlTable);
    } catch {
      // The schema also exports non-table relation helpers.
      continue;
    }
    if (!config.name || !config.columns.length) continue;
    tables.set(config.name, new Set(config.columns.map(column => column.name)));
    columns.set(
      config.name,
      new Map(
        config.columns.map(column => [
          column.name,
          {
            sqlType: column.getSQLType(),
            nullable: !column.notNull,
          },
        ])
      )
    );
    const tableIndexes = new Map(
      config.indexes.map(index => [
        index.config.name,
        {
          columns: index.config.columns
            .map(column => ("name" in column ? column.name : null))
            .filter((column): column is string => Boolean(column)),
          unique: index.config.unique ?? false,
        },
      ])
    );
    const primaryColumns = config.columns
      .filter(column => column.primary)
      .map(column => column.name);
    if (primaryColumns.length)
      tableIndexes.set("PRIMARY", { columns: primaryColumns, unique: true });
    indexes.set(config.name, tableIndexes);
    foreignKeys.set(
      config.name,
      config.foreignKeys.map(foreignKey => {
        const reference = foreignKey.reference();
        return {
          columns: reference.columns.map(column => column.name),
          referencedTable: getTableConfig(reference.foreignTable).name,
          referencedColumns: reference.foreignColumns.map(
            column => column.name
          ),
          onDelete: foreignKey.onDelete ?? "restrict",
          onUpdate: foreignKey.onUpdate ?? "no action",
        };
      })
    );
  }
  if (tables.size === 0) throw new Error("Runtime schema metadata is empty");
  return { tables, columns, indexes, foreignKeys };
}

/** Read-only, startup-only metadata checks. Never repair a deployment database implicitly. */
export async function auditRuntimeDatabaseSchema(
  connection: Pick<Connection, "query">
) {
  const [columnRows] = await connection.query<
    (DatabaseColumnRow & RowDataPacket)[]
  >({
    sql: `SELECT table_name AS tableName, column_name AS columnName,
                 column_type AS sqlType, is_nullable AS isNullable
          FROM information_schema.columns WHERE table_schema = DATABASE()`,
    timeout: 15_000,
  });
  const [indexRows] = await connection.query<
    (DatabaseIndexRow & RowDataPacket)[]
  >({
    sql: `SELECT table_name AS tableName, index_name AS indexName, non_unique AS nonUnique,
                 seq_in_index AS sequence, column_name AS columnName
          FROM information_schema.statistics WHERE table_schema = DATABASE()`,
    timeout: 15_000,
  });
  const [foreignKeyRows] = await connection.query<
    (DatabaseForeignKeyRow & RowDataPacket)[]
  >({
    sql: `SELECT kcu.table_name AS tableName, kcu.constraint_name AS constraintName,
                 kcu.column_name AS columnName, kcu.ordinal_position AS sequence,
                 kcu.referenced_table_name AS referencedTable,
                 kcu.referenced_column_name AS referencedColumn,
                 rc.delete_rule AS deleteRule, rc.update_rule AS updateRule
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.referential_constraints rc
            ON rc.constraint_schema = kcu.constraint_schema
           AND rc.constraint_name = kcu.constraint_name AND rc.table_name = kcu.table_name
          WHERE kcu.table_schema = DATABASE() AND kcu.referenced_table_name IS NOT NULL`,
    timeout: 15_000,
  });
  const expected = expectedRuntimeSchema();
  return compareDatabaseSchema(
    expected.tables,
    columnRows,
    expected.indexes,
    indexRows,
    expected.columns,
    expected.foreignKeys,
    foreignKeyRows
  );
}

export async function assertProductionDatabaseSchema(databaseUrl: string) {
  if (!databaseUrl.trim())
    throw new Error("Production database is not configured");
  const connection = await mysql.createConnection({
    uri: databaseUrl,
    connectTimeout: 15_000,
  });
  try {
    const audit = await auditRuntimeDatabaseSchema(connection);
    if (hasDatabaseSchemaDrift(audit)) {
      throw new Error(
        "Database schema does not match the runtime model; run the schema audit and reviewed migrations"
      );
    }
  } finally {
    // A timeout/error must not leave a startup connection or queued command alive.
    connection.destroy();
  }
}
