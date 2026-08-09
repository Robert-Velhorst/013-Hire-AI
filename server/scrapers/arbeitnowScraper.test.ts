import { afterEach, describe, expect, it, vi } from "vitest";
import { ArbeitnowScraper } from "./arbeitnowScraper";

afterEach(() => vi.unstubAllGlobals());

describe("Arbeitnow public API adapter", () => {
  it("keeps only explicit remote listings and preserves provider attribution", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      {
        slug: "remote-platform-engineer",
        company_name: "Cloud GmbH",
        title: "Remote Platform Engineer",
        description: "Build cloud systems with Kubernetes.",
        remote: true,
        url: "https://www.arbeitnow.com/jobs/companies/cloud-gmbh/remote-platform-engineer",
        tags: ["Cloud", "Kubernetes"],
        job_types: ["full-time"],
        location: "Berlin, Germany",
        created_at: 1786204800,
      },
      {
        slug: "office-platform-engineer",
        company_name: "Office GmbH",
        title: "Platform Engineer",
        remote: false,
        url: "https://www.arbeitnow.com/jobs/companies/office-gmbh/platform-engineer",
      },
    ] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ArbeitnowScraper(62).scrape({
      keywords: "Kubernetes",
      location: "Germany",
      limit: 10,
    });

    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("page")).toBe("1");
    expect(result.errors).toEqual([]);
    expect(result.jobs).toEqual([expect.objectContaining({
      platformId: 62,
      externalId: "remote-platform-engineer",
      title: "Remote Platform Engineer",
      company: "Cloud GmbH",
      location: "Berlin, Germany",
      jobType: "full-time",
      skills: "Cloud, Kubernetes",
      applicationUrl: "https://www.arbeitnow.com/jobs/companies/cloud-gmbh/remote-platform-engineer",
    })]);
  });

  it("does not trust missing or truthy-looking remote markers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { slug: "missing", title: "Role", company_name: "Co", url: "https://www.arbeitnow.com/jobs/missing" },
      { slug: "string", title: "Role", company_name: "Co", remote: "true", url: "https://www.arbeitnow.com/jobs/string" },
    ] }), { status: 200 })));
    expect((await new ArbeitnowScraper(62).scrape()).jobs).toEqual([]);
  });

  it("honors cancellation before network access", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await new ArbeitnowScraper(62).scrape({ signal: controller.signal });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});
