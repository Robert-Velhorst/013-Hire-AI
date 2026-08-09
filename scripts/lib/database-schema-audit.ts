export type DatabaseColumnRow = {
  tableName: string;
  columnName: string;
  sqlType?: string;
  isNullable?: "YES" | "NO";
};

export type ExpectedDatabaseColumn = {
  sqlType: string;
  nullable: boolean;
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
  mismatchedColumns: string[];
  unexpectedColumns: string[];
  missingIndexes: string[];
  mismatchedIndexes: string[];
};

export function hasDatabaseSchemaDrift(audit: DatabaseSchemaAudit) {
  return audit.missingTables.length > 0 ||
    audit.missingColumns.length > 0 ||
    audit.mismatchedColumns.length > 0 ||
    audit.unexpectedColumns.length > 0 ||
    audit.missingIndexes.length > 0 ||
    audit.mismatchedIndexes.length > 0;
}

export function compareDatabaseSchema(
  expected: ReadonlyMap<string, ReadonlySet<string>>,
  actualRows: DatabaseColumnRow[],
  expectedIndexes: ReadonlyMap<string, ReadonlyMap<string, ExpectedDatabaseIndex>> = new Map(),
  actualIndexRows: DatabaseIndexRow[] = [],
  expectedColumnDefinitions: ReadonlyMap<string, ReadonlyMap<string, ExpectedDatabaseColumn>> = new Map()
): DatabaseSchemaAudit {
  const actual = new Map<string, Set<string>>();
  const actualColumnDefinitions = new Map<string, Map<string, ExpectedDatabaseColumn>>();
  for (const row of actualRows) {
    const columns = actual.get(row.tableName) ?? new Set<string>();
    columns.add(row.columnName);
    actual.set(row.tableName, columns);
    if (row.sqlType && row.isNullable) {
      const definitions = actualColumnDefinitions.get(row.tableName) ?? new Map<string, ExpectedDatabaseColumn>();
      definitions.set(row.columnName, {
        sqlType: row.sqlType,
        nullable: row.isNullable === "YES",
      });
      actualColumnDefinitions.set(row.tableName, definitions);
    }
  }

  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const mismatchedColumns: string[] = [];
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

  const normalizeSqlType = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  for (const [tableName, definitions] of expectedColumnDefinitions) {
    const actualDefinitions = actualColumnDefinitions.get(tableName);
    for (const [columnName, expectedDefinition] of definitions) {
      const actualDefinition = actualDefinitions?.get(columnName);
      if (!actualDefinition) continue;
      if (
        normalizeSqlType(actualDefinition.sqlType) !== normalizeSqlType(expectedDefinition.sqlType) ||
        actualDefinition.nullable !== expectedDefinition.nullable
      ) {
        mismatchedColumns.push(
          `${tableName}.${columnName}: expected ${expectedDefinition.sqlType} ${expectedDefinition.nullable ? "NULL" : "NOT NULL"}, actual ${actualDefinition.sqlType} ${actualDefinition.nullable ? "NULL" : "NOT NULL"}`
        );
      }
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
    mismatchedColumns: mismatchedColumns.sort(),
    unexpectedColumns: unexpectedColumns.sort(),
    missingIndexes: missingIndexes.sort(),
    mismatchedIndexes: mismatchedIndexes.sort(),
  };
}
