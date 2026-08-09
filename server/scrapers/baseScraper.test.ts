import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseScraper, parseRetryAfterMs, ScraperHttpError, type ScrapeResult } from "./baseScraper";

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
}

afterEach(() => vi.useRealTimers());

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

  it("does not retry permanent provider failures", async () => {
    const request = vi.fn().mockRejectedValue(new ScraperHttpError(404, null));
    await expect(scraper.retryRequest(request)).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledOnce();
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
});
