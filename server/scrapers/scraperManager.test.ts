import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseScraper } from "./baseScraper";
import {
  SCRAPER_FAILURE_MESSAGE,
  SCRAPER_INITIALIZATION_FAILURE_MESSAGE,
  ScraperManager,
} from "./scraperManager";

const mocks = vi.hoisted(() => ({
  ensureScraperPlatformCatalog: vi.fn(),
  getDb: vi.fn(),
  recordPlatformScrapeOutcome: vi.fn(),
}));

vi.mock("../db", () => ({
  ensureScraperPlatformCatalog: mocks.ensureScraperPlatformCatalog,
  getDb: mocks.getDb,
  recordPlatformScrapeOutcome: mocks.recordPlatformScrapeOutcome,
}));

function createScraper(platformId: number) {
  return {
    getPlatformId: () => platformId,
    scrape: vi.fn().mockResolvedValue({
      jobs: [],
      errors: [],
      scrapedAt: new Date(),
    }),
  } as unknown as BaseScraper;
}

describe("scraper manager platform restrictions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureScraperPlatformCatalog.mockResolvedValue({ created: 0, total: 8 });
    mocks.getDb.mockResolvedValue(null);
    mocks.recordPlatformScrapeOutcome.mockResolvedValue(undefined);
  });

  it("ensures the source catalog before initializing configured scrapers", async () => {
    const manager = new ScraperManager();

    await manager.initialize();

    expect(mocks.ensureScraperPlatformCatalog).toHaveBeenCalledOnce();
    expect(manager.getInitializedPlatforms()).toContain("RemoteOK");
  });

  it("tracks account-only sources without initializing a scraper for them", async () => {
    const manager = new ScraperManager();

    await manager.initialize();

    expect(manager.getInitializedPlatforms()).not.toContain("LinkedIn Jobs");
    expect(manager.getInitializationError("LinkedIn Jobs")).toContain("approved integration");
  });

  it("runs only the explicitly enabled platform sources", async () => {
    const manager = new ScraperManager();
    const remoteOk = createScraper(1);
    const remotive = createScraper(2);
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("RemoteOK", remoteOk);
    scrapers.set("Remotive", remotive);

    const result = await manager.scrapeAll({ platformNames: ["RemoteOK"] });

    expect(remoteOk.scrape).toHaveBeenCalledOnce();
    expect(remotive.scrape).not.toHaveBeenCalled();
    expect(Object.keys(result.platformResults)).toEqual(["RemoteOK"]);
    expect(manager.getInitializedPlatforms()).toEqual(["RemoteOK", "Remotive"]);
  });

  it("reports an unavailable configured platform without scraping another source", async () => {
    const manager = new ScraperManager();
    const remoteOk = createScraper(1);
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("RemoteOK", remoteOk);

    const result = await manager.scrapeAll({ platformNames: ["Unavailable Board"] });

    expect(remoteOk.scrape).not.toHaveBeenCalled();
    expect(result.platformResults["Unavailable Board"].errors).toEqual([
      "No scraper available for platform: Unavailable Board",
    ]);
    expect(manager.getInitializationError("Unavailable Board")).toBeNull();
  });

  it("records a sanitized failure when an initialized source later becomes unavailable", async () => {
    const manager = new ScraperManager();
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    const platformIds = (manager as unknown as { platformIds: Map<string, number> }).platformIds;
    platformIds.set("RemoteOK", 1);

    const result = await manager.scrapePlatform("RemoteOK");

    expect(result.errors).toEqual(["No scraper available for platform: RemoteOK"]);
    expect(scrapers.size).toBe(0);
    expect(mocks.recordPlatformScrapeOutcome).toHaveBeenCalledWith(1, {
      jobCount: 0,
      errors: [SCRAPER_INITIALIZATION_FAILURE_MESSAGE],
    });
  });

  it("records an initialization failure against the configured source without exposing adapter details", async () => {
    const manager = new ScraperManager();
    const createScraper = vi
      .spyOn(manager as unknown as { createScraper: (name: string, id: number) => BaseScraper | null }, "createScraper")
      .mockImplementation(() => {
        throw new Error("Bearer adapter-secret");
      });
    const where = vi.fn().mockResolvedValue([{
      id: 91,
      name: "Failure Board",
      isActive: 1,
    }]);
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    });

    await manager.initialize();

    expect(manager.getInitializationError("Failure Board")).toBe(SCRAPER_INITIALIZATION_FAILURE_MESSAGE);
    expect(mocks.recordPlatformScrapeOutcome).toHaveBeenCalledWith(91, {
      jobCount: 0,
      errors: [SCRAPER_INITIALIZATION_FAILURE_MESSAGE],
    });
    expect(JSON.stringify(mocks.recordPlatformScrapeOutcome.mock.calls)).not.toContain("adapter-secret");
    createScraper.mockRestore();
  });

  it("times out one source without preventing a healthy source from completing", async () => {
    const manager = new ScraperManager({ scrapeTimeoutMs: 5, maxConcurrentScrapes: 2 });
    let slowSignal: AbortSignal | undefined;
    const slow = {
      getPlatformId: () => 1,
      scrape: vi.fn().mockImplementation((options?: { signal?: AbortSignal }) => {
        slowSignal = options?.signal;
        return new Promise(() => {});
      }),
    } as unknown as BaseScraper;
    const healthy = createScraper(2);
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Slow source", slow);
    scrapers.set("Healthy source", healthy);

    const result = await manager.scrapeAll();

    expect(result.platformResults["Slow source"].errors).toEqual(["Scrape timed out after 5ms"]);
    expect(slowSignal?.aborted).toBe(true);
    expect(result.platformResults["Healthy source"].errors).toEqual([]);
    expect(healthy.scrape).toHaveBeenCalledOnce();
    expect(mocks.recordPlatformScrapeOutcome).toHaveBeenCalledWith(2, {
      jobCount: 0,
      errors: [],
    });
    expect(mocks.recordPlatformScrapeOutcome).toHaveBeenCalledWith(1, {
      jobCount: 0,
      errors: ["Scrape timed out after 5ms"],
    });
  });

  it("serializes overlapping runs for the same platform", async () => {
    const manager = new ScraperManager({ scrapeTimeoutMs: 5_000, maxConcurrentScrapes: 3 });
    let releaseFirst = () => {};
    const firstResult = new Promise<{ jobs: []; errors: []; scrapedAt: Date }>((resolve) => {
      releaseFirst = () => resolve({ jobs: [], errors: [], scrapedAt: new Date() });
    });
    const source = {
      getPlatformId: () => 7,
      scrape: vi.fn()
        .mockImplementationOnce(() => firstResult)
        .mockResolvedValueOnce({ jobs: [], errors: [], scrapedAt: new Date() }),
    } as unknown as BaseScraper;
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Serialized source", source);

    const first = manager.scrapePlatform("Serialized source");
    const second = manager.scrapePlatform("Serialized source");
    await vi.waitFor(() => expect(source.scrape).toHaveBeenCalledOnce());
    releaseFirst();
    await Promise.all([first, second]);
    expect(source.scrape).toHaveBeenCalledTimes(2);
  });

  it("reports the effective bounded execution policy", () => {
    const manager = new ScraperManager({ scrapeTimeoutMs: 12_345, maxConcurrentScrapes: 4 });
    expect(manager.getExecutionPolicy()).toEqual({
      scrapeTimeoutMs: 12_345,
      maxConcurrentScrapes: 4,
      serializedPerPlatform: true,
    });
  });

  it("records a partial outcome when a source returns jobs alongside errors", async () => {
    const manager = new ScraperManager();
    const partial = {
      getPlatformId: () => 3,
      scrape: vi.fn().mockResolvedValue({
        jobs: [{ title: "Recovered role" }],
        errors: ["One feed page was unavailable"],
        scrapedAt: new Date(),
      }),
    } as unknown as BaseScraper;
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Partial source", partial);

    await manager.scrapePlatform("Partial source");

    expect(mocks.recordPlatformScrapeOutcome).toHaveBeenCalledWith(3, {
      jobCount: 1,
      errors: [SCRAPER_FAILURE_MESSAGE],
    });
  });

  it("does not expose a provider failure from a source adapter", async () => {
    const manager = new ScraperManager();
    const failed = {
      getPlatformId: () => 4,
      scrape: vi.fn().mockRejectedValue(new Error("Bearer provider-secret")),
    } as unknown as BaseScraper;
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Protected source", failed);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await manager.scrapePlatform("Protected source");

    expect(result.errors).toEqual([SCRAPER_FAILURE_MESSAGE]);
    expect(mocks.recordPlatformScrapeOutcome).toHaveBeenCalledWith(4, {
      jobCount: 0,
      errors: [SCRAPER_FAILURE_MESSAGE],
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("provider-secret");
    errorSpy.mockRestore();
  });

  it("refreshes a re-observed source listing instead of leaving an expired record unavailable", async () => {
    const existingJob = {
      id: 712,
      externalId: "source-job-712",
      platformId: 7,
      title: "Senior Platform Engineer",
      company: "Source Co",
      description: "Older description",
      requirements: null,
      responsibilities: null,
      benefits: null,
      location: "Remote",
      jobType: "full-time",
      salaryMin: 120000,
      salaryMax: 160000,
      salaryCurrency: "USD",
      skills: "TypeScript",
      applicationUrl: "https://jobs.example.com/712",
      applicationEmail: null,
      applicationProcess: null,
      sourceUrl: null,
      postedDate: new Date("2026-07-01T00:00:00.000Z"),
      expiryDate: new Date("2026-07-10T00:00:00.000Z"),
      isActive: 0,
      visaSponsorshipAvailable: 0,
      openHiringSupport: 0,
      diversityFriendly: 0,
    };
    const where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const selectResponses = [[existingJob], []];
    const limit = vi.fn().mockImplementation(() => Promise.resolve(selectResponses.shift() || []));
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    mocks.getDb.mockResolvedValue({ select, update });

    const result = await new ScraperManager().saveJobs([{
      externalId: "source-job-712",
      platformId: 7,
      title: "Senior Platform Engineer",
      company: "Source Co",
      description: "Updated source description",
      applicationUrl: "https://jobs.example.com/712?source=refresh",
      isActive: 1,
    }]);

    expect(result).toEqual({ saved: 0, refreshed: 1, duplicates: 0, errors: 0 });
    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      title: "Senior Platform Engineer",
      description: "Updated source description",
      applicationUrl: "https://jobs.example.com/712?source=refresh",
      expiryDate: null,
      isActive: 1,
    }));
  });

  it("reactivates an expired canonical listing when a linked source is re-observed", async () => {
    const duplicate = {
      id: 714,
      externalId: "source-job-714",
      platformId: 7,
      title: "Staff Data Engineer",
      company: "Source Co",
      expiryDate: new Date("2026-07-10T00:00:00.000Z"),
      isActive: 0,
    };
    const primary = {
      ...duplicate,
      id: 713,
      externalId: "canonical-job-713",
      platformId: 6,
      applicationUrl: "https://old-source.example.com/713",
    };
    const where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const selectResponses = [
      [duplicate],
      [{ primaryJobId: primary.id }],
      [primary],
    ];
    const select = vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockImplementation(() => Promise.resolve(selectResponses.shift() || [])),
        }),
      }),
    }));
    mocks.getDb.mockResolvedValue({ select, update });

    const result = await new ScraperManager().saveJobs([{
      externalId: "source-job-714",
      platformId: 7,
      title: "Staff Data Engineer",
      company: "Source Co",
      applicationUrl: "https://fresh-source.example.com/714",
      isActive: 1,
    }]);

    expect(result).toEqual({ saved: 0, refreshed: 1, duplicates: 0, errors: 0 });
    expect(update).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({
      applicationUrl: "https://fresh-source.example.com/714",
      expiryDate: null,
      isActive: 1,
    }));
  });

  it("refreshes a canonical listing when a duplicate source re-observes a no-expiry listing past its observation window", async () => {
    const duplicate = {
      id: 716,
      externalId: "source-job-716",
      platformId: 7,
      title: "Staff Platform Engineer",
      company: "Source Co",
      expiryDate: null,
      isActive: 1,
      updatedAt: new Date(Date.now() - 15 * 86400000),
      createdAt: new Date(Date.now() - 16 * 86400000),
    };
    const primary = {
      ...duplicate,
      id: 715,
      externalId: "canonical-job-715",
      platformId: 6,
      applicationUrl: "https://old-source.example.com/715",
    };
    const where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const selectResponses = [
      [duplicate],
      [{ primaryJobId: primary.id }],
      [primary],
    ];
    const select = vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockImplementation(() => Promise.resolve(selectResponses.shift() || [])),
        }),
      }),
    }));
    mocks.getDb.mockResolvedValue({ select, update });

    const result = await new ScraperManager().saveJobs([{
      externalId: "source-job-716",
      platformId: 7,
      title: "Staff Platform Engineer",
      company: "Source Co",
      applicationUrl: "https://fresh-source.example.com/715",
      isActive: 1,
    }]);

    expect(result).toEqual({ saved: 0, refreshed: 1, duplicates: 0, errors: 0 });
    expect(update).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({
      applicationUrl: "https://fresh-source.example.com/715",
      updatedAt: expect.any(Date),
      isActive: 1,
    }));
  });
});
