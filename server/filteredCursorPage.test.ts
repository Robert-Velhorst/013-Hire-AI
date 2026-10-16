import { describe, expect, it, vi } from "vitest";
import { fetchFilteredCursorPage } from "./filteredCursorPage";

type Row = { id: number; accepted: boolean };

function makeInput(
  rows: Row[],
  overrides: Partial<Parameters<typeof fetchFilteredCursorPage<Row, number>>[0]> = {}
) {
  const fetchBatch = vi.fn(async (cursor: number | undefined, limit: number) =>
    rows.filter((row) => cursor === undefined || row.id > cursor).slice(0, limit)
  );
  return {
    fetchBatch,
    input: {
      limit: 2,
      batchSize: 3,
      scanBudget: 12,
      cursor: undefined,
      fetchBatch,
      filter: (batch: Row[]) => batch.filter((row) => row.accepted),
      getCursor: (row: Row) => row.id,
      ...overrides,
    },
  };
}

describe("bounded filtered cursor pages", () => {
  it("scans past rejected rows and continues after the last returned match", async () => {
    const { fetchBatch, input } = makeInput([
      { id: 1, accepted: false },
      { id: 2, accepted: false },
      { id: 3, accepted: true },
      { id: 4, accepted: false },
      { id: 5, accepted: true },
      { id: 6, accepted: true },
    ]);

    const page = await fetchFilteredCursorPage(input);

    expect(page).toEqual({
      items: [{ id: 3, accepted: true }, { id: 5, accepted: true }],
      nextCursor: 5,
    });
    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(fetchBatch.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, 3]);
  });

  it("returns no continuation after exhausting candidates with too few matches", async () => {
    const { input } = makeInput([
      { id: 1, accepted: true },
      { id: 2, accepted: false },
    ]);

    await expect(fetchFilteredCursorPage(input)).resolves.toEqual({
      items: [{ id: 1, accepted: true }],
      nextCursor: null,
    });
  });

  it("returns a continuation when the scan budget is reached", async () => {
    const { input } = makeInput(
      Array.from({ length: 20 }, (_, index) => ({ id: index + 1, accepted: false })),
      { batchSize: 3, scanBudget: 6 }
    );

    await expect(fetchFilteredCursorPage(input)).resolves.toEqual({
      items: [],
      nextCursor: 6,
    });
  });
});
