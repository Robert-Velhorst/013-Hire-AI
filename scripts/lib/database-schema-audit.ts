export type DatabaseColumnRow = {
  tableName: string;
  columnName: string;
};

export type ExpectedDatabaseIndex = {
  columns: string[];
  unique: boolean;
};

export type DatabaseIndexRow = {
  tableName: string;
  indexName: string;
  nonUnique: number;
  sequence: number;
  columnName: string | null;
};

export type DatabaseSchemaAudit = {
  expectedTableCount: number;
  actualTableCount: number;
  expectedIndexCount: number;
  actualIndexCount: number;
  missingTables: string[];
  missingColumns: string[];
  unexpectedColumns: string[];
  missingIndexes: string[];
  mismatchedIndexes: string[];
};

export function hasDatabaseSchemaDrift(audit: DatabaseSchemaAudit) {
  return audit.missingTables.length > 0 ||
    audit.missingColumns.length > 0 ||
    audit.unexpectedColumns.length > 0 ||
    audit.missingIndexes.length > 0 ||
    audit.mismatchedIndexes.length > 0;
}

export function compareDatabaseSchema(
  expected: ReadonlyMap<string, ReadonlySet<string>>,
  actualRows: DatabaseColumnRow[],
  expectedIndexes: ReadonlyMap<string, ReadonlyMap<string, ExpectedDatabaseIndex>> = new Map(),
  actualIndexRows: DatabaseIndexRow[] = []
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
  const missingIndexes: string[] = [];
  const mismatchedIndexes: string[] = [];
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

  const actualIndexes = new Map<string, Map<string, ExpectedDatabaseIndex>>();
  for (const row of [...actualIndexRows].sort((left, right) => left.sequence - right.sequence)) {
    if (!row.columnName) continue;
    const tableIndexes = actualIndexes.get(row.tableName) ?? new Map<string, ExpectedDatabaseIndex>();
    const index = tableIndexes.get(row.indexName) ?? {
      columns: [],
      unique: row.nonUnique === 0,
    };
    index.columns.push(row.columnName);
    tableIndexes.set(row.indexName, index);
    actualIndexes.set(row.tableName, tableIndexes);
  }

  for (const [tableName, indexes] of expectedIndexes) {
    const actualTableIndexes = actualIndexes.get(tableName);
    for (const [indexName, expectedIndex] of indexes) {
      const actualIndex = actualTableIndexes?.get(indexName);
      const qualifiedName = `${tableName}.${indexName}`;
      if (!actualIndex) {
        missingIndexes.push(qualifiedName);
      } else if (
        actualIndex.unique !== expectedIndex.unique ||
        actualIndex.columns.join(",") !== expectedIndex.columns.join(",")
      ) {
        mismatchedIndexes.push(
          `${qualifiedName}: expected ${expectedIndex.unique ? "unique " : ""}(${expectedIndex.columns.join(",")}), actual ${actualIndex.unique ? "unique " : ""}(${actualIndex.columns.join(",")})`
        );
      }
    }
  }

  return {
    expectedTableCount: expected.size,
    actualTableCount: actual.size,
    expectedIndexCount: Array.from(expectedIndexes.values())
      .reduce((count, indexes) => count + indexes.size, 0),
    actualIndexCount: Array.from(actualIndexes.values())
      .reduce((count, indexes) => count + indexes.size, 0),
    missingTables: missingTables.sort(),
    missingColumns: missingColumns.sort(),
    unexpectedColumns: unexpectedColumns.sort(),
    missingIndexes: missingIndexes.sort(),
    mismatchedIndexes: mismatchedIndexes.sort(),
  };
}
