import { afterEach, describe, expect, it, vi } from "vitest";
import { WeWorkRemotelyScraper } from "./weworkremotelyScraper";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("We Work Remotely feed parsing", () => {
  it("stops parsing the current feed when its admitted job quota is full", async () => {
    const items = Array.from({ length: 50 }, (_, index) =>
      `<item><title>Example ${index}: Engineer ${index}</title><link>https://weworkremotely.com/jobs/${index}</link><description>Role ${index}</description></item>`
    ).join("");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(
      `<rss><channel>${items}</channel></rss>`,
      { status: 200 }
    )) as typeof fetch;
    const scraper = new WeWorkRemotelyScraper(1);
    const internals = scraper as unknown as { cleanHtml: (html: string) => string };
    const cleanHtml = vi.spyOn(internals, "cleanHtml");

    const result = await scraper.scrape({ limit: 1 });

    expect(result.jobs).toHaveLength(1);
    expect(cleanHtml).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
});
