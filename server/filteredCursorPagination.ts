export type FilteredCursorPage<T, Cursor> = {
  items: T[];
  nextCursor: Cursor | null;
  scannedCount: number;
};

export async function collectFilteredCursorPage<T, Cursor>(options: {
  cursor?: Cursor;
  limit: number;
  pageSize: number;
  maxScannedCount: number;
  fetchPage: (
    cursor: Cursor | undefined,
    limit: number
  ) => Promise<FilteredCursorPage<T, Cursor>>;
  cursorForItem: (item: T) => Cursor;
}) {
  const items: T[] = [];
  let cursor = options.cursor;
  let scannedCount = 0;

  while (scannedCount < options.maxScannedCount) {
    const pageLimit = Math.min(
      options.pageSize,
      options.maxScannedCount - scannedCount
    );
    const page = await options.fetchPage(cursor, pageLimit);
    scannedCount += page.scannedCount;
    items.push(...page.items);

    if (items.length > options.limit) {
      const resultItems = items.slice(0, options.limit);
      return {
        items: resultItems,
        nextCursor: options.cursorForItem(resultItems[resultItems.length - 1]),
        scannedCount,
      };
    }

    if (page.scannedCount <= 0) {
      return { items, nextCursor: page.nextCursor, scannedCount };
    }

    if (!page.nextCursor) {
      return { items, nextCursor: null, scannedCount };
    }
    cursor = page.nextCursor;
  }

  return {
    items: items.slice(0, options.limit),
    nextCursor: cursor ?? null,
    scannedCount,
  };
}
