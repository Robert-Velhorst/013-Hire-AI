import type { RowDataPacket } from "mysql2";

export interface ExplainRow extends RowDataPacket {
  table: string;
  type: string;
  key: string | null;
  rows: number;
  Extra: string | null;
}

export function assertIndexedWindowPlan(
  name: string,
  rows: ExplainRow[],
  expectedIndex: string,
) {
  const primary = rows.find((row) => row.table === "sf");
  if (!primary) throw new Error(`${name}: EXPLAIN did not include the success-fee table.`);
  if (primary.key !== expectedIndex) {
    throw new Error(`${name}: expected ${expectedIndex}, received ${primary.key ?? "no index"}.`);
  }
  if (primary.type.toUpperCase() === "ALL") {
    throw new Error(`${name}: the success-fee window performs a full table scan.`);
  }
  if ((primary.Extra ?? "").toLowerCase().includes("filesort")) {
    throw new Error(`${name}: the success-fee window performs a filesort.`);
  }
  return {
    name,
    index: primary.key,
    accessType: primary.type,
    estimatedRows: Number(primary.rows),
    extra: primary.Extra ?? "",
  };
}
