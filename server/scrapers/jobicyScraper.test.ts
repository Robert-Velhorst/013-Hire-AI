import { afterEach, describe, expect, it, vi } from "vitest";
import { JobicyScraper } from "./jobicyScraper";

afterEach(() => vi.unstubAllGlobals());

describe("Jobicy public API adapter", () => {
  it("normalizes documented remote-job fields and preserves annual salary semantics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [
      {
        id: 901,
        url: "https://jobicy.com/jobs/901",
        jobTitle: "Senior Platform Engineer",
        companyName: "Example Systems",
        jobIndustry: ["Engineering", "Cloud"],
        jobType: "full-time",
        jobGeo: "Europe",
        jobDescription: "Build reliable platforms.",
        pubDate: "2026-08-08T10:00:00Z",
        salaryMin: 90000,
        salaryMax: 120000,
        salaryCurrency: "eur",
        salaryPeriod: "yearly",
      },
      {
        id: 902,
        url: "https://jobicy.com/jobs/902",
        jobTitle: "US Support Engineer",
        companyName: "Other Systems",
        jobGeo: "USA",
      },
    ] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new JobicyScraper(61).scrape({
      keywords: "platform engineer",
      location: "europe",
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.searchParams.get("count")).toBe("10");
    expect(requestedUrl.searchParams.get("tag")).toBe("platform engineer");
    expect(result.errors).toEqual([]);
    expect(result.jobs).toEqual([expect.objectContaining({
      platformId: 61,
      externalId: "901",
      title: "Senior Platform Engineer",
      company: "Example Systems",
      location: "Europe",
      jobType: "full-time",
      salaryMin: 90000,
      salaryMax: 120000,
      salaryCurrency: "EUR",
      skills: "Engineering, Cloud",
      applicationUrl: "https://jobicy.com/jobs/901",
    })]);
  });

  it("does not mislabel hourly compensation as an annual salary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [{
      id: "hourly-1",
      url: "https://jobicy.com/jobs/hourly-1",
      jobTitle: "Contract Designer",
      companyName: "Design Co",
      jobGeo: "Anywhere",
      salaryMin: 50,
      salaryMax: 70,
      salaryCurrency: "USD",
      salaryPeriod: "hourly",
    }] }), { status: 200 })));

    const [job] = (await new JobicyScraper(61).scrape()).jobs;
    expect(job.salaryMin).toBeUndefined();
    expect(job.salaryMax).toBeUndefined();
  });

  it("honors cancellation without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await new JobicyScraper(61).scrape({ signal: controller.signal });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});
