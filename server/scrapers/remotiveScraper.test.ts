import { afterEach, describe, expect, it, vi } from "vitest";
import { RemotiveScraper } from "./remotiveScraper";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Remotive salary ingestion", () => {
  it("normalizes international salary formats before persisting a source job", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        jobs: [{
          id: 44,
          title: "Platform Engineer",
          company_name: "European Systems",
          candidate_required_location: "Remote - Europe",
          description: "Build reliable platform services.",
          job_type: "full_time",
          url: "https://remotive.com/remote-jobs/software-dev/platform-engineer-44",
          publication_date: "2026-07-13T10:00:00.000Z",
          salary: "EUR 60.000 - 75.000 annually",
        }],
      }), { status: 200 })) as typeof fetch;

    const result = await new RemotiveScraper(44).scrape();

    expect(result.errors).toEqual([]);
    expect(result.jobs).toEqual([expect.objectContaining({
      salaryMin: 60000,
      salaryMax: 75000,
      salaryCurrency: "EUR",
    })]);
  });
});
