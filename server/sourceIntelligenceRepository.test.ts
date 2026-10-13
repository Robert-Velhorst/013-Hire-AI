import { describe, expect, it, vi } from "vitest";
import {
  sampleJobs,
  samplePlatforms,
  sampleJobDuplicateLinks,
} from "./sampleData";

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  getAllJobPlatforms: vi.fn(async () => samplePlatforms),
}));

import {
  getSourceDirectory,
  getSourceComparisonPage,
} from "./sourceIntelligenceRepository";

describe("source intelligence sample repository", () => {
  it("labels sample counts and preserves each stored listing", async () => {
    const directory = await getSourceDirectory({ limit: 100, offset: 0 });
    expect(directory.dataMode).toBe("sample");
    expect(directory.summary.total).toBe(90);
    expect(directory.summary.automated).toBe(9);
    expect(
      directory.items.reduce((sum, item) => sum + item.listingCount, 0)
    ).toBe(sampleJobs.length);
    expect(
      directory.items.reduce((sum, item) => sum + item.duplicateCount, 0)
    ).toBe(sampleJobDuplicateLinks.length);
  });

  it("walks duplicate links exactly once with an exclusive cursor", async () => {
    const ids: number[] = [];
    let cursor: number | undefined;
    for (let page = 0; page <= sampleJobDuplicateLinks.length; page++) {
      const result = await getSourceComparisonPage({ limit: 1, cursor });
      expect(result.dataMode).toBe("sample");
      expect(result.unavailablePairs).toBe(0);
      expect(result.items.length).toBeLessThanOrEqual(1);
      ids.push(...result.items.map(item => item.duplicate.id));
      if (result.nextCursor === null) break;
      expect(result.nextCursor).toBeGreaterThan(cursor ?? 0);
      cursor = result.nextCursor;
    }
    expect(ids).toEqual(
      sampleJobDuplicateLinks
        .map(link => link.duplicateJobId)
        .sort((a, b) => a - b)
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      (
        await getSourceComparisonPage({
          limit: 1,
          cursor: Number.MAX_SAFE_INTEGER,
        })
      ).items
    ).toEqual([]);
  });
});
