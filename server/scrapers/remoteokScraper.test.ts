import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteOKScraper } from "./remoteokScraper";

afterEach(() => vi.unstubAllGlobals());

describe("Remote OK feed adapter", () => {
  it("parses provider ISO dates and uses the numeric epoch fallback", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            last_updated: 1_800_000_000,
            legal: "credit Remote OK and link to each original listing",
          },
          {
            id: "external-link-before-valid-records",
            position: "Remote engineer",
            company: "Example Three",
            url: "https://example.test/remote-jobs/external-link",
          },
          {
            id: "iso-job",
            position: "Remote support specialist",
            company: "Example One",
            location: "Worldwide",
            date: "2026-10-07T16:00:05+00:00",
            url: "https://remoteok.com/remote-jobs/iso-job",
            tags: ["support", "customer service"],
          },
          {
            id: "epoch-job",
            position: "Remote operations coordinator",
            company: "Example Two",
            location: "Remote - Europe",
            epoch: 1_800_000_000,
            url: "https://remoteok.com/remote-jobs/epoch-job",
            tags: ["operations"],
          },
          {
            id: "fallback-epoch-job",
            position: "Remote analyst",
            company: "Example Four",
            location: "Remote - Worldwide",
            date: "invalid-date",
            epoch: 1_800_000_001,
            url: "https://remoteok.com/remote-jobs/fallback-epoch-job",
          },
          {
            id: "external-link",
            position: "Remote engineer",
            company: "Example Three",
            url: "https://example.test/remote-jobs/external-link",
          },
          null,
        ]),
        { headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new RemoteOKScraper(27).scrape({ limit: 3 });

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]).toMatchObject({
      externalId: "iso-job",
      postedDate: new Date("2026-10-07T16:00:05Z"),
      applicationUrl: "https://remoteok.com/remote-jobs/iso-job",
      sourceUrl: "https://remoteok.com/remote-jobs/iso-job",
    });
    expect(result.jobs[1]).toMatchObject({
      externalId: "epoch-job",
      postedDate: new Date(1_800_000_000_000),
    });
    expect(result.jobs[2]).toMatchObject({
      externalId: "fallback-epoch-job",
      postedDate: new Date(1_800_000_001_000),
    });
    expect(result.jobs.map(job => job.externalId)).not.toContain(
      "external-link"
    );
  });

  it("applies keyword tags and location filters before returning the bounded page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify([
            {},
            {
              id: "wrong-location",
              position: "Support",
              company: "A",
              location: "Asia",
              tags: ["support"],
            },
            {
              id: "wrong-keyword",
              position: "Designer",
              company: "B",
              location: "Europe",
              tags: ["design"],
            },
            {
              id: "match",
              position: "Customer specialist",
              company: "C",
              location: "Europe",
              tags: ["support"],
              url: "https://remoteok.com/remote-jobs/match",
            },
          ])
        )
      )
    );

    const result = await new RemoteOKScraper(27).scrape({
      keywords: " support ",
      location: "europe",
      limit: 1,
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].externalId).toBe("match");
  });
});
