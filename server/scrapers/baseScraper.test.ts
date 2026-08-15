import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BaseScraper,
  parseRetryAfterMs,
  SCRAPER_RESPONSE_MAX_BYTES,
  ScraperHttpError,
  type ScrapeResult,
} from "./baseScraper";
import { ResponseSizeLimitError } from "../_core/outboundRequest";

class TestScraper extends BaseScraper {
  async scrape(): Promise<ScrapeResult> {
    return { jobs: [], errors: [], scrapedAt: new Date() };
  }

  normalize(rawJob: unknown) {
    return this.normalizeJob(rawJob);
  }

  pace(signal?: AbortSignal) {
    return this.rateLimit(signal);
  }

  retryRequest<T>(fn: () => Promise<T>, signal?: AbortSignal) {
    return this.retry(fn, { signal });
  }

  readText(response: Response) {
    return this.readResponseText(response);
  }

  readJson<T>(response: Response) {
    return this.readResponseJson<T>(response);
  }

  request(input: string | URL, init?: RequestInit) {
    return this.fetchSource(input, init);
  }

  assertHealthy(response: Response) {
    return this.assertResponseOk(response);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("base scraper application-link normalization", () => {
  const scraper = new TestScraper({
    platformName: "Test source",
    platformId: 991,
    baseUrl: "https://jobs.example.com/careers/",
    rateLimit: 0,
    maxRetries: 0,
  });

  it("resolves relative application links against the source URL", () => {
    expect(scraper.normalize({ title: "Engineer", applicationUrl: "roles/engineer" }))
      .toMatchObject({ applicationUrl: "https://jobs.example.com/careers/roles/engineer" });
  });

  it("omits non-web application links instead of preserving executable schemes", () => {
    expect(scraper.normalize({ title: "Engineer", applicationUrl: "javascript:alert(1)" }))
      .toMatchObject({ applicationUrl: undefined });
  });

  it("omits application links containing embedded credentials", () => {
    expect(scraper.normalize({
      title: "Engineer",
      applicationUrl: "https://candidate:secret@jobs.example.com/apply",
    })).toMatchObject({ applicationUrl: undefined });
  });

  it("preserves locale-formatted compensation for downstream match and filter decisions", () => {
    expect(scraper.normalize({
      title: "European Engineer",
      salaryMin: "EUR 60.000",
      salaryMax: "EUR 75 000",
      salaryCurrency: "eur",
    })).toMatchObject({
      salaryMin: 60000,
      salaryMax: 75000,
      salaryCurrency: "EUR",
    });
  });

  it("bounds provider-controlled fields to the database storage contract", () => {
    const normalized = scraper.normalize({
      title: "T".repeat(600),
      company: "C".repeat(300),
      location: "L".repeat(300),
      description: "D".repeat(20_000),
      requirements: "R".repeat(20_000),
      responsibilities: "P".repeat(20_000),
      benefits: "B".repeat(20_000),
      skills: "S".repeat(20_000),
      externalId: "E".repeat(300),
      applicationUrl: `https://jobs.example.com/${"a".repeat(1_100)}`,
    });

    expect(normalized.title).toHaveLength(500);
    expect(normalized.company).toHaveLength(255);
    expect(normalized.location).toHaveLength(255);
    expect(normalized.description).toHaveLength(16_000);
    expect(normalized.requirements).toHaveLength(16_000);
    expect(normalized.responsibilities).toHaveLength(16_000);
    expect(normalized.benefits).toHaveLength(16_000);
    expect(normalized.skills).toHaveLength(16_000);
    expect(normalized.externalId).toHaveLength(255);
    expect(normalized.applicationUrl).toBeUndefined();
  });

  it("does not split a surrogate pair when truncating provider text", () => {
    const normalized = scraper.normalize({
      title: `${"T".repeat(499)}😀overflow`,
      company: "Example",
    });

    expect(normalized.title).toBe("T".repeat(499));
    expect(normalized.title).not.toContain("�");
  });

  it("keeps oversized provider identities distinct after bounding them", () => {
    const sharedPrefix = "provider-record-".repeat(20);
    const first = scraper.normalize({ title: "One", externalId: `${sharedPrefix}first` });
    const second = scraper.normalize({ title: "Two", externalId: `${sharedPrefix}second` });

    expect(first.externalId).toHaveLength(255);
    expect(second.externalId).toHaveLength(255);
    expect(first.externalId).not.toBe(second.externalId);
  });

  it("does not retry permanent provider failures", async () => {
    const request = vi.fn().mockRejectedValue(new ScraperHttpError(404, null));
    await expect(scraper.retryRequest(request)).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledOnce();
  });

  it("blocks source redirects while preserving manager cancellation", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await scraper.request("https://jobs.example.com/feed", { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith("https://jobs.example.com/feed", expect.objectContaining({
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
    const requestSignal = fetchMock.mock.calls[0][1]?.signal;
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("cancels a rejected response body before retry handling", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status: 503 });

    expect(() => scraper.assertHealthy(response)).toThrow(ScraperHttpError);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it("honors bounded Retry-After guidance for transient provider failures", async () => {
    vi.useFakeTimers();
    const retryingScraper = new TestScraper({
      platformName: "Retry source",
      platformId: 992,
      baseUrl: "https://jobs.example.com/",
      rateLimit: 0,
      maxRetries: 2,
    });
    const request = vi.fn()
      .mockRejectedValueOnce(new ScraperHttpError(429, 5_000))
      .mockResolvedValueOnce("ok");
    const result = retryingScraper.retryRequest(request);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("ok");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("cancels a queued provider pacing wait", async () => {
    const pacedScraper = new TestScraper({
      platformName: "Paced source",
      platformId: 993,
      baseUrl: "https://jobs.example.com/",
      rateLimit: 60_000,
      maxRetries: 0,
    });
    await pacedScraper.pace();
    const controller = new AbortController();
    const queued = pacedScraper.pace(controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
  });

  it("parses delta and date Retry-After values with a five-minute ceiling", () => {
    expect(parseRetryAfterMs("2")).toBe(2_000);
    expect(parseRetryAfterMs("9999")).toBe(300_000);
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT", Date.parse("2026-10-21T07:27:58Z"))).toBe(2_000);
    expect(parseRetryAfterMs("invalid")).toBeNull();
  });

  it("parses healthy text feeds and JSON APIs within the shared response budget", async () => {
    await expect(scraper.readText(new Response("<rss />"))).resolves.toBe("<rss />");
    await expect(scraper.readJson<{ jobs: number }>(new Response(JSON.stringify({ jobs: 2 }))))
      .resolves.toEqual({ jobs: 2 });
  });

  it.each([
    ["text", (response: Response) => scraper.readText(response)],
    ["JSON", (response: Response) => scraper.readJson(response)],
  ])("rejects an oversized declared %s source response", async (_format, read) => {
    const response = new Response("{}", {
      headers: { "content-length": String(SCRAPER_RESPONSE_MAX_BYTES + 1) },
    });
    await expect(read(response)).rejects.toBeInstanceOf(ResponseSizeLimitError);
  });
});
