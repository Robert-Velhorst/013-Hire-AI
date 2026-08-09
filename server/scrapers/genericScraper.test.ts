import { afterEach, describe, expect, it, vi } from "vitest";
import { GenericScraper } from "./genericScraper";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("generic scraper structured job extraction", () => {
  it("normalizes JSON-LD JobPosting data before falling back to HTML heuristics", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(`
        <script type="application/ld+json">
          {"@context":"https://schema.org","@graph":[{
            "@type":"JobPosting",
            "title":"Senior Platform Engineer",
            "description":"<p>Build reliable remote systems.</p>",
            "url":"/jobs/platform-engineer",
            "datePosted":"2026-07-13T10:00:00.000Z",
            "validThrough":"2026-08-13T10:00:00.000Z",
            "employmentType":"FULL_TIME",
            "identifier":{"value":"platform-123"},
            "hiringOrganization":{"name":"Example Systems"},
            "jobLocationType":"TELECOMMUTE",
            "baseSalary":{"currency":"USD","value":{"minValue":"140000","maxValue":180000}}
          }]}
        </script>
      `, { status: 200 })) as typeof fetch;
    const scraper = new GenericScraper({
      platformName: "Structured Test Source",
      platformId: 72,
      baseUrl: "https://jobs.example.com",
      rateLimit: 0,
      maxRetries: 0,
      type: "html",
    });

    const result = await scraper.scrape();

    expect(result.errors).toEqual([]);
    expect(result.jobs).toEqual([expect.objectContaining({
      platformId: 72,
      title: "Senior Platform Engineer",
      company: "Example Systems",
      location: "Remote",
      description: "Build reliable remote systems.",
      applicationUrl: "https://jobs.example.com/jobs/platform-engineer",
      externalId: "platform-123",
      jobType: "full-time",
      salaryMin: 140000,
      salaryMax: 180000,
      salaryCurrency: "USD",
      expiryDate: new Date("2026-08-13T10:00:00.000Z"),
    })]);
  });

  it("annualizes locale-formatted JSON-LD compensation before source jobs are persisted", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(`
        <script type="application/ld+json">
          {"@type":"JobPosting","title":"European Platform Engineer","url":"/jobs/european-platform-engineer","hiringOrganization":{"name":"European Systems"},"jobLocationType":"TELECOMMUTE","baseSalary":{"currency":"EUR","value":{"minValue":"40","maxValue":"50","unitText":"HOUR"}}}
        </script>
      `, { status: 200 })) as typeof fetch;
    const scraper = new GenericScraper({
      platformName: "Structured EU Test Source",
      platformId: 76,
      baseUrl: "https://jobs.example.com",
      rateLimit: 0,
      maxRetries: 0,
      type: "html",
    });

    const result = await scraper.scrape();

    expect(result.errors).toEqual([]);
    expect(result.jobs).toEqual([expect.objectContaining({
      salaryMin: 83200,
      salaryMax: 104000,
      salaryCurrency: "EUR",
    })]);
  });

  it("ignores malformed structured data and resolves heuristic HTML links against a nested source URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(
      '<script type="application/ld+json">{not-json}</script><article class="job"><h2>Fallback Engineer</h2><a href="/jobs/fallback">Apply</a></article>',
      { status: 200 }
    )) as typeof fetch;
    const scraper = new GenericScraper({
      platformName: "Fallback Test Source",
      platformId: 73,
      baseUrl: "https://jobs.example.com/careers/",
      rateLimit: 0,
      maxRetries: 0,
      type: "html",
    });

    const result = await scraper.scrape();

    expect(result.errors).toEqual([]);
    expect(result.jobs[0]).toMatchObject({
      title: "Fallback Engineer",
      applicationUrl: "https://jobs.example.com/jobs/fallback",
    });
  });

  it("keeps relative RSS links usable and excludes unsafe application destinations", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(`
        <rss><channel>
          <item><title>Safe Writer - Example Press</title><link>roles/writer</link><guid>writer-1</guid></item>
          <item><title>Unsafe Writer - Example Press</title><link>javascript:alert(1)</link><guid>writer-2</guid></item>
        </channel></rss>
      `, { status: 200 })) as typeof fetch;
    const scraper = new GenericScraper({
      platformName: "RSS Test Source",
      platformId: 74,
      baseUrl: "https://jobs.example.com/careers/",
      rateLimit: 0,
      maxRetries: 0,
      type: "rss",
    });

    const result = await scraper.scrape();

    expect(result.errors).toEqual([]);
    expect(result.jobs).toEqual([expect.objectContaining({
      title: "Safe Writer",
      company: "Example Press",
      applicationUrl: "https://jobs.example.com/careers/roles/writer",
      externalId: "writer-1",
    })]);
  });

  it("preserves configured API query parameters and excludes known location conflicts", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        jobs: [
          {
            id: "eu-platform",
            title: "Platform Engineer",
            company: "European Systems",
            location: "Remote - Netherlands",
            description: "Build platform services for distributed teams.",
            requirements: "Experience with TypeScript and distributed systems.",
            skills: ["TypeScript", "React"],
            employment_type: "FULL_TIME",
            salary_min: "40",
            salary_max: "50",
            salary_currency: "EUR",
            salary_period: "HOUR",
            url: "https://jobs.example.com/eu-platform",
          },
          {
            id: "us-platform",
            title: "Platform Engineer",
            company: "North American Systems",
            location: "Remote - United States",
            description: "Build platform services for distributed teams.",
            url: "https://jobs.example.com/us-platform",
          },
        ],
      }), { status: 200 })) as typeof fetch;
    const scraper = new GenericScraper({
      platformName: "API Test Source",
      platformId: 75,
      baseUrl: "https://jobs.example.com",
      apiUrl: "https://api.example.com/jobs?source=hire-ai",
      rateLimit: 0,
      maxRetries: 0,
      type: "api",
    });

    const result = await scraper.scrape({ keywords: "Platform Engineer", location: "Europe" });

    expect(result.errors).toEqual([]);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "eu-platform",
        company: "European Systems",
        jobType: "full-time",
        skills: "TypeScript, React",
        salaryMin: 83200,
        salaryMax: 104000,
        salaryCurrency: "EUR",
      }),
    ]);
    const requestedUrl = new URL(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    expect(requestedUrl.searchParams.get("source")).toBe("hire-ai");
    expect(requestedUrl.searchParams.get("q")).toBe("Platform Engineer");
    expect(requestedUrl.searchParams.get("location")).toBe("Europe");
  });
});
