import { afterEach, describe, expect, it, vi } from "vitest";
import { JustRemoteScraper } from "./justremoteScraper";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("JustRemote scraper HTML text extraction", () => {
  it("decodes standard entities in extracted job fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        `
      <div class="job-card"><div>
        <a href="/remote-jobs/staff-platform-engineer"><h2>Engineer &amp; Data &quot;Platform&quot;</h2></a>
        <span class="company">R&amp;D&nbsp;Labs&#39;</span>
        <span class="location">Remote &mdash; Europe</span>
      </div></div>
    `,
        { status: 200 }
      )
    ) as typeof fetch;

    const result = await new JustRemoteScraper(51).scrape({ limit: 1 });

    expect(result.errors).toEqual([]);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        title: 'Engineer & Data "Platform"',
        company: "R&D Labs'",
        location: "Remote \u2014 Europe",
        applicationUrl:
          "https://justremote.co/remote-jobs/staff-platform-engineer",
      }),
    ]);
  });

  it("does not recursively decode entity-encoded markup", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        `
      <div class="job-card"><div>
        <a href="/remote-jobs/encoded-title"><h2>Encoded &amp;lt;script&amp;gt; title</h2></a>
      </div></div>
    `,
        { status: 200 }
      )
    ) as typeof fetch;

    const result = await new JustRemoteScraper(51).scrape({ limit: 1 });

    expect(result.jobs[0]?.title).toBe("Encoded &lt;script&gt; title");
  });

  it("uses the same entity handling in the fallback listing parser", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        `
      <a href="/jobs/fallback-designer"><span class="title">Designer &amp; Product &quot;Remote&quot;</span></a>
    `,
        { status: 200 }
      )
    ) as typeof fetch;

    const result = await new JustRemoteScraper(51).scrape({ limit: 1 });

    expect(result.jobs[0]?.title).toBe('Designer & Product "Remote"');
  });
});
