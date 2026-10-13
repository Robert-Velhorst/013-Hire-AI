import { describe, expect, it } from "vitest";
import {
  compareSourceRecords,
  buildSourceDirectory,
} from "./sourceIntelligence";

describe("source record comparisons", () => {
  it("separates absent evidence from observed differences", () => {
    const result = compareSourceRecords(
      {
        title: "Engineer",
        company: "A",
        location: "Netherlands",
        salaryMin: 50000,
        salaryMax: 70000,
        salaryCurrency: "EUR",
      },
      {
        title: " engineer ",
        company: "a",
        location: "Germany",
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
      }
    );
    expect(result.differences.map(item => item.field)).toEqual(["location"]);
    expect(result.missingFields).toContain("salaryMin");
    expect(result.missingFields).toContain("jobType");
  });
  it("does not compare amounts across different currencies", () => {
    const result = compareSourceRecords(
      { salaryCurrency: "USD", salaryMin: 70000 },
      { salaryCurrency: "EUR", salaryMin: 50000 }
    );
    expect(result.differences.map(item => item.field)).toEqual([
      "salaryCurrency",
    ]);
  });
  it("reports separate salary bounds and contract differences in the same currency", () => {
    const result = compareSourceRecords(
      {
        salaryCurrency: "EUR",
        salaryMin: 60000,
        salaryMax: 90000,
        jobType: "contract",
      },
      {
        salaryCurrency: "eur",
        salaryMin: 60000,
        salaryMax: 95000,
        jobType: "full-time",
      }
    );
    expect(result.differences.map(item => item.field)).toEqual([
      "jobType",
      "salaryMax",
    ]);
  });
});

describe("worldwide source directory", () => {
  it("includes the catalog even before initialization without inventing scan success", () => {
    const result = buildSourceDirectory([], [], {
      region: "europe",
      country: "NL",
      limit: 50,
      offset: 0,
    });
    expect(
      result.items.some(item => item.name === "Nationale Vacaturebank")
    ).toBe(true);
    expect(
      result.items.every(
        item => item.lastScraped === null && item.listingCount === 0
      )
    ).toBe(true);
    expect(result.summary.total).toBeGreaterThan(62);
  });
  it("keeps paused and failed sources distinct from working adapters", () => {
    const platforms = [
      {
        id: 90,
        name: "Himalayas",
        url: "https://himalayas.app/",
        isActive: 0,
        lastScrapeStatus: "failed",
        lastScraped: null,
        lastScrapeAttemptedAt: new Date(),
      },
    ];
    const result = buildSourceDirectory(
      platforms,
      [{ platformId: 90, listingCount: 4, duplicateCount: 2 }],
      { query: "Himalayas", limit: 50, offset: 0 }
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      state: "paused",
      listingCount: 4,
      duplicateCount: 2,
      adapterAvailable: true,
    });
  });
  it("filters and paginates without claiming the world's total platform count", () => {
    const result = buildSourceDirectory([], [], { limit: 2, offset: 0 });
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.coverageComplete).toBe(false);
  });
});
