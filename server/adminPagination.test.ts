import { describe, expect, it } from "vitest";
import {
  adminTimestampIdCursorSchema,
  createAdminCursorPage,
  isAfterDescendingTimestampIdCursor,
} from "./adminPagination";

describe("admin timestamp/id cursor pagination", () => {
  const rows = [
    { id: 9, createdAt: new Date("2026-10-01T00:00:00.000Z") },
    { id: 8, createdAt: new Date("2026-10-01T00:00:00.000Z") },
    { id: 7, createdAt: new Date("2026-09-30T00:00:00.000Z") },
  ];

  it("uses ID as a deterministic tie-breaker and excludes new rows ahead of a cursor", () => {
    const cursor = { timestamp: rows[1]!.createdAt, id: rows[1]!.id };
    expect(rows.filter(row => isAfterDescendingTimestampIdCursor(row, cursor, item => item.createdAt, item => item.id)))
      .toEqual([rows[2]]);
    expect(isAfterDescendingTimestampIdCursor(
      { id: 10, createdAt: rows[0]!.createdAt },
      cursor,
      item => item.createdAt,
      item => item.id
    )).toBe(false);
  });

  it("returns a continuation cursor only when an additional row exists", () => {
    const first = createAdminCursorPage(rows.slice(0, 3), 2, 3, row => ({ timestamp: row.createdAt, id: row.id }));
    expect(first).toMatchObject({ items: rows.slice(0, 2), total: 3, limit: 2, hasMore: true, nextCursor: { id: 8 } });
    const last = createAdminCursorPage([rows[2]!], 2, 3, row => ({ timestamp: row.createdAt, id: row.id }));
    expect(last).toMatchObject({ items: [rows[2]], hasMore: false, nextCursor: null });
  });

  it("rejects malformed and extra cursor fields", () => {
    expect(adminTimestampIdCursorSchema.safeParse({ timestamp: "not-a-date", id: 3 }).success).toBe(false);
    expect(adminTimestampIdCursorSchema.safeParse({ timestamp: "2026-10-01T00:00:00Z", id: 0 }).success).toBe(false);
    expect(adminTimestampIdCursorSchema.safeParse({ timestamp: "2026-10-01T00:00:00Z", id: 3, status: "all" }).success).toBe(false);
  });
});
