export type DatabaseColumnRow = {
  tableName: string;
  columnName: string;
};

export type DatabaseSchemaAudit = {
  expectedTableCount: number;
  actualTableCount: number;
  missingTables: string[];
  missingColumns: string[];
  unexpectedColumns: string[];
};

export function hasDatabaseSchemaDrift(audit: DatabaseSchemaAudit) {
  return audit.missingTables.length > 0 ||
    audit.missingColumns.length > 0 ||
    audit.unexpectedColumns.length > 0;
}

export function compareDatabaseSchema(
  expected: ReadonlyMap<string, ReadonlySet<string>>,
  actualRows: DatabaseColumnRow[]
): DatabaseSchemaAudit {
  const actual = new Map<string, Set<string>>();
  for (const row of actualRows) {
    const columns = actual.get(row.tableName) ?? new Set<string>();
    columns.add(row.columnName);
    actual.set(row.tableName, columns);
  }

  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const unexpectedColumns: string[] = [];
  for (const [tableName, expectedColumns] of expected) {
    const actualColumns = actual.get(tableName);
    if (!actualColumns) {
      missingTables.push(tableName);
      continue;
    }
    for (const columnName of expectedColumns) {
      if (!actualColumns.has(columnName)) missingColumns.push(`${tableName}.${columnName}`);
    }
    for (const columnName of actualColumns) {
      if (!expectedColumns.has(columnName)) unexpectedColumns.push(`${tableName}.${columnName}`);
    }
  }

  return {
    expectedTableCount: expected.size,
    actualTableCount: actual.size,
    missingTables: missingTables.sort(),
    missingColumns: missingColumns.sort(),
    unexpectedColumns: unexpectedColumns.sort(),
  };
}
