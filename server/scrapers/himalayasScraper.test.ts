import { afterEach, describe, expect, it, vi } from "vitest";
import { HimalayasScraper } from "./himalayasScraper";

const raw = (id: number, extra = {}) => ({
  title: "Engineer",
  companyName: "Example",
  guid: `https://himalayas.app/companies/example/jobs/${id}`,
  applicationLink: "https://employer.example/apply",
  description: "Build systems",
  locationRestrictions: ["Netherlands"],
  timezoneRestrictions: [1, 2],
  pubDate: 1788550565,
  minSalary: 100000,
  maxSalary: 120000,
  salaryPeriod: "annual",
  currency: "EUR",
  ...extra,
});
const response = (jobs: unknown[], nextCursor: string | null = null) =>
  new Response(JSON.stringify({ jobs, nextCursor }));
afterEach(() => vi.unstubAllGlobals());

describe("Himalayas public feed", () => {
  it("follows cursors, bounds admitted jobs and preserves source attribution and restrictions", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response([raw(1)], "page2"))
      .mockResolvedValueOnce(response([raw(2), raw(3)], "page3"));
    vi.stubGlobal("fetch", fetch);
    const result = await new HimalayasScraper(90).scrape({ limit: 2 });
    expect(result.errors).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      new URL(String(fetch.mock.calls[1][0])).searchParams.get("cursor")
    ).toBe("page2");
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({
      platformId: 90,
      salaryMin: 100000,
      salaryCurrency: "EUR",
      sourceUrl: raw(1).guid,
      applicationUrl: raw(1).guid,
      postedDate: new Date(1788550565000),
    });
    expect(result.jobs[0].location).toContain("Netherlands");
    expect(result.jobs[0].requirements).toContain("UTC+1");
  });
  it("keeps unknown location and currency unknown and does not annualize hourly amounts", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response([
            raw(1, {
              locationRestrictions: [],
              timezoneRestrictions: [],
              salaryPeriod: "hourly",
              currency: null,
            }),
          ])
        )
    );
    const result = await new HimalayasScraper(90).scrape({ limit: 1 });
    expect(result.jobs[0]).toMatchObject({
      location: "Remote - location unspecified",
      salaryCurrency: null,
    });
    expect(result.jobs[0].salaryMin).toBeUndefined();
  });
  it("reports malformed responses as failures, not successful empty feeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"unavailable"}'))
    );
    const result = await new HimalayasScraper(90).scrape();
    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
  it("rejects external attribution URLs and contains repeated cursors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            response(
              [raw(1, { guid: "https://untrusted.example/job" })],
              "same"
            )
          )
        )
    );
    const result = await new HimalayasScraper(90).scrape({ limit: 3 });
    expect(result.jobs).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it("makes no requests for zero quota or cancellation", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await new HimalayasScraper(90).scrape({ limit: 0 })).jobs).toEqual(
      []
    );
    const signal = AbortSignal.abort();
    expect(
      (await new HimalayasScraper(90).scrape({ signal })).errors
    ).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
