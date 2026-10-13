import { z } from "zod";

export const adminTimestampIdCursorSchema = z.object({
  timestamp: z.coerce.date(),
  id: z.number().int().positive(),
}).strict();

export type AdminTimestampIdCursor = z.infer<typeof adminTimestampIdCursorSchema>;

export function isAfterDescendingTimestampIdCursor<T>(
  row: T,
  cursor: AdminTimestampIdCursor | undefined,
  getTimestamp: (row: T) => Date,
  getId: (row: T) => number
) {
  if (!cursor) return true;
  const timestamp = getTimestamp(row).getTime();
  const cursorTimestamp = cursor.timestamp.getTime();
  return timestamp < cursorTimestamp || (timestamp === cursorTimestamp && getId(row) < cursor.id);
}

export function createAdminCursorPage<T>(
  rows: T[],
  limit: number,
  total: number,
  getCursor: (row: T) => AdminTimestampIdCursor
) {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    items,
    total,
    limit,
    hasMore,
    nextCursor: hasMore && items.length > 0 ? getCursor(items[items.length - 1]!) : null,
  };
}
