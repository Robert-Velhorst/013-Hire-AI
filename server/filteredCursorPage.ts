export async function fetchFilteredCursorPage<T, Cursor>(input: {
  limit: number;
  batchSize: number;
  scanBudget: number;
  cursor: Cursor | undefined;
  fetchBatch: (cursor: Cursor | undefined, limit: number) => Promise<T[]>;
  filter: (items: T[]) => T[];
  getCursor: (item: T) => Cursor;
}) {
  let cursor = input.cursor;
  let lastScannedCursor: Cursor | null = null;
  let scanned = 0;
  let exhausted = false;
  const matchingItems: T[] = [];

  while (scanned < input.scanBudget) {
    const batchLimit = Math.min(input.batchSize, input.scanBudget - scanned);
    const batch = await input.fetchBatch(cursor, batchLimit);
    if (batch.length === 0) {
      exhausted = true;
      break;
    }

    matchingItems.push(...input.filter(batch));
    scanned += batch.length;
    lastScannedCursor = input.getCursor(batch[batch.length - 1]!);

    if (matchingItems.length > input.limit) {
      const items = matchingItems.slice(0, input.limit);
      return { items, nextCursor: input.getCursor(items[items.length - 1]!) };
    }

    cursor = lastScannedCursor;
    if (batch.length < batchLimit) {
      exhausted = true;
      break;
    }
  }

  return {
    items: matchingItems.slice(0, input.limit),
    nextCursor: !exhausted ? lastScannedCursor : null,
  };
}
