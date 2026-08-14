import { describe, expect, it } from "vitest";
import {
  getScraperSourceHealthSummary,
  getScraperSourceOutcomeCounts,
} from "./scraperSourceHealth";

describe("scraper source health", () => {
  it("distinguishes a failed latest source run from a clean one", () => {
    expect(getScraperSourceHealthSummary({
      lastScrapeStatus: "failed",
      lastScrapeJobCount: 0,
      lastScrapeError: "HTTP 429 from source",
    })).toMatchObject({
      outcome: "failed",
      jobCount: 0,
      error: "HTTP 429 from source",
    });

    expect(getScraperSourceHealthSummary({
      lastScrapeStatus: "success",
      lastScrapeJobCount: 14,
      lastScrapeError: "stale error that must not be displayed",
    })).toMatchObject({
      outcome: "success",
      jobCount: 14,
      error: null,
    });
  });

  it("keeps unrecorded legacy state awaiting a verified run", () => {
    expect(getScraperSourceHealthSummary({})).toMatchObject({
      outcome: "awaiting",
      jobCount: null,
    });
  });

  it("does not treat a zero-listing success as discovery coverage", () => {
    expect(getScraperSourceHealthSummary({
      lastScrapeStatus: "success",
      lastScrapeJobCount: 0,
    })).toMatchObject({
      outcome: "empty",
      jobCount: 0,
      error: null,
    });
  });

  it("counts empty, partial, and failed sources as attention items", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    expect(getScraperSourceOutcomeCounts([
      { lastScrapeStatus: "success", lastScrapeJobCount: 4, lastScrapeAttemptedAt: "2026-07-13T11:00:00.000Z" },
      { lastScrapeStatus: "success", lastScrapeJobCount: 0, lastScrapeAttemptedAt: "2026-07-13T11:00:00.000Z" },
      { lastScrapeStatus: "partial", lastScrapeAttemptedAt: "2026-07-13T11:00:00.000Z" },
      { lastScrapeStatus: "failed", lastScrapeAttemptedAt: "2026-07-11T11:00:00.000Z" },
      {},
    ], now)).toEqual({
      success: 1,
      empty: 1,
      partial: 1,
      failed: 1,
      awaiting: 1,
      issues: 3,
      freshSuccess: 1,
      freshEmpty: 1,
      freshPartial: 1,
      freshFailed: 0,
      freshIssues: 2,
      staleOutcomes: 1,
    });
  });

  it("keeps stale source outcomes visible without treating them as a current incident", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    const summary = getScraperSourceHealthSummary({
      lastScrapeStatus: "failed",
      lastScrapeJobCount: 0,
      lastScrapeError: "Rate limited",
      lastScrapeAttemptedAt: "2026-07-11T12:00:00.000Z",
    }, now);

    expect(summary).toMatchObject({ outcome: "failed", isFresh: false, error: "Rate limited" });
  });
});
