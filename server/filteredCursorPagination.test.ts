import { describe, expect, it, vi } from "vitest";
import { collectFilteredCursorPage } from "./filteredCursorPagination";

type Row = { id: number; matches: boolean };

describe("collectFilteredCursorPage", () => {
  it("continues through sparse filtered pages until it fills the requested page", async () => {
    const rows: Row[] = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      matches: index === 2 || index === 5 || index === 6,
    }));
    const fetchPage = vi.fn(
      async (cursor: number | undefined, limit: number) => {
        const start = cursor ?? 0;
        const pageRows = rows.slice(start, start + limit);
        return {
          items: pageRows.filter(row => row.matches),
          nextCursor:
            start + pageRows.length < rows.length
              ? start + pageRows.length
              : null,
          scannedCount: pageRows.length,
        };
      }
    );

    const result = await collectFilteredCursorPage({
      limit: 2,
      pageSize: 3,
      maxScannedCount: 12,
      fetchPage,
      cursorForItem: row => row.id,
    });

    expect(result.items.map(row => row.id)).toEqual([3, 6]);
    expect(result.nextCursor).toBe(6);
    expect(result.scannedCount).toBe(7);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("returns the scan cursor when the bounded scan ends before filling the page", async () => {
    const fetchPage = vi.fn(
      async (cursor: number | undefined, limit: number) => ({
        items: [] as Row[],
        nextCursor: (cursor ?? 0) + limit,
        scannedCount: limit,
      })
    );

    const result = await collectFilteredCursorPage({
      limit: 4,
      pageSize: 2,
      maxScannedCount: 4,
      fetchPage,
      cursorForItem: row => row.id,
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBe(4);
    expect(result.scannedCount).toBe(4);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("does not advance the returned cursor past an extra matching row", async () => {
    const rows: Row[] = [
      { id: 1, matches: true },
      { id: 2, matches: true },
      { id: 3, matches: true },
    ];
    const fetchPage = vi.fn(
      async (_cursor: number | undefined, limit: number) => ({
        items: rows.slice(0, limit).filter(row => row.matches),
        nextCursor: rows.length > limit ? limit : null,
        scannedCount: Math.min(rows.length, limit),
      })
    );

    const result = await collectFilteredCursorPage({
      limit: 2,
      pageSize: 3,
      maxScannedCount: 3,
      fetchPage,
      cursorForItem: row => row.id,
    });

    expect(result.items.map(row => row.id)).toEqual([1, 2]);
    expect(result.nextCursor).toBe(2);
  });

  it("stops safely if a page cannot report scan progress", async () => {
    const fetchPage = vi.fn(async () => ({
      items: [] as Row[],
      nextCursor: 0,
      scannedCount: 0,
    }));

    const result = await collectFilteredCursorPage({
      limit: 2,
      pageSize: 10,
      maxScannedCount: 100,
      fetchPage,
      cursorForItem: row => row.id,
    });

    expect(result.nextCursor).toBe(0);
    expect(result.scannedCount).toBe(0);
    expect(fetchPage).toHaveBeenCalledOnce();
  });
});
