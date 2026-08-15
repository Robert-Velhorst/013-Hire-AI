import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseScraper } from "./baseScraper";
import {
  SCRAPER_FAILURE_MESSAGE,
  SCRAPER_INITIALIZATION_FAILURE_MESSAGE,
  ScraperManager,
} from "./scraperManager";

const mocks = vi.hoisted(() => ({
  ensureScraperPlatformCatalog: vi.fn(),
  claimPlatformScrapeAttempt: vi.fn(),
  getDb: vi.fn(),
  recordPlatformScrapeOutcome: vi.fn(),
}));

vi.mock("../db", () => ({
  claimPlatformScrapeAttempt: mocks.claimPlatformScrapeAttempt,
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
    mocks.claimPlatformScrapeAttempt.mockResolvedValue(true);
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

  it("enforces one fair job budget across every selected source", async () => {
    const manager = new ScraperManager({ maxConcurrentScrapes: 3 });
    const makeFilledScraper = (platformId: number) => ({
      getPlatformId: () => platformId,
      scrape: vi.fn().mockImplementation(async (options?: { limit?: number }) => ({
        jobs: Array.from({ length: (options?.limit ?? 0) + 5 }, (_, index) => ({
          platformId,
          title: `Job ${platformId}-${index}`,
        })),
        errors: [],
        scrapedAt: new Date(),
      })),
    }) as unknown as BaseScraper;
    const first = makeFilledScraper(1);
    const second = makeFilledScraper(2);
    const third = makeFilledScraper(3);
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("First", first);
    scrapers.set("Second", second);
    scrapers.set("Third", third);

    const result = await manager.scrapeAll({ limit: 10 });

    expect(first.scrape).toHaveBeenCalledWith(expect.objectContaining({ limit: 4 }));
    expect(second.scrape).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
    expect(third.scrape).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
    expect(result.totalJobs).toBe(10);
    expect(Object.values(result.platformResults).map(({ jobs }) => jobs.length).sort())
      .toEqual([3, 3, 4]);
  });

  it("polls every source when the cycle budget is smaller than the source count", async () => {
    const manager = new ScraperManager({ maxConcurrentScrapes: 3 });
    const sources = Array.from({ length: 3 }, (_, index) => ({
      getPlatformId: () => index + 1,
      scrape: vi.fn().mockResolvedValue({
        jobs: [{ platformId: index + 1, title: `Job ${index + 1}` }],
        errors: [],
        scrapedAt: new Date(),
      }),
    } as unknown as BaseScraper));
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    sources.forEach((source, index) => scrapers.set(`Source ${index + 1}`, source));

    const result = await manager.scrapeAll({ limit: 1 });

    expect(sources.every((source) => vi.mocked(source.scrape).mock.calls.length === 1)).toBe(true);
    expect(result.totalJobs).toBe(1);
    expect(Object.values(result.platformResults).flatMap(({ jobs }) => jobs)).toHaveLength(1);
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

  it("aborts active work and does not dequeue another source", async () => {
    const manager = new ScraperManager({ scrapeTimeoutMs: 5_000, maxConcurrentScrapes: 1 });
    const saveJobs = vi.spyOn(manager, "saveJobs");
    const controller = new AbortController();
    let activeSignal: AbortSignal | undefined;
    const active = {
      getPlatformId: () => 1,
      scrape: vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) => {
        activeSignal = signal;
        return new Promise(() => {});
      }),
    } as unknown as BaseScraper;
    const queued = createScraper(2);
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Active source", active);
    scrapers.set("Queued source", queued);

    const cycle = manager.runScrapingCycle({ signal: controller.signal });
    await vi.waitFor(() => expect(active.scrape).toHaveBeenCalledOnce());
    controller.abort();

    await expect(cycle).rejects.toMatchObject({ name: "AbortError" });
    expect(activeSignal?.aborted).toBe(true);
    expect(queued.scrape).not.toHaveBeenCalled();
    expect(saveJobs).not.toHaveBeenCalled();
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

  it("cancels a queued same-source run without breaking provider serialization", async () => {
    const manager = new ScraperManager({ scrapeTimeoutMs: 5_000, maxConcurrentScrapes: 1 });
    let releaseFirst = () => {};
    const firstResult = new Promise<{ jobs: []; errors: []; scrapedAt: Date }>((resolve) => {
      releaseFirst = () => resolve({ jobs: [], errors: [], scrapedAt: new Date() });
    });
    const source = {
      getPlatformId: () => 7,
      scrape: vi.fn()
        .mockImplementationOnce(() => firstResult)
        .mockResolvedValue({ jobs: [], errors: [], scrapedAt: new Date() }),
    } as unknown as BaseScraper;
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Serialized source", source);

    const first = manager.scrapePlatform("Serialized source");
    await vi.waitFor(() => expect(source.scrape).toHaveBeenCalledOnce());
    const controller = new AbortController();
    const cancelled = manager.scrapeAll({
      platformNames: ["Serialized source"],
      signal: controller.signal,
    });
    controller.abort();

    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(source.scrape).toHaveBeenCalledOnce();
    releaseFirst();
    await first;
    await manager.scrapePlatform("Serialized source");
    expect(source.scrape).toHaveBeenCalledTimes(2);
  });

  it("enforces a provider polling interval across serialized runs", async () => {
    const manager = new ScraperManager();
    const source = createScraper(61);
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Jobicy", source);

    const first = await manager.scrapePlatform("Jobicy");
    const second = await manager.scrapePlatform("Jobicy");

    expect(first.errors).toEqual([]);
    expect(second).toMatchObject({ errors: [], skippedReason: "poll_interval" });
    expect(source.scrape).toHaveBeenCalledOnce();
    expect(mocks.recordPlatformScrapeOutcome).toHaveBeenCalledOnce();
    expect(mocks.claimPlatformScrapeAttempt).toHaveBeenCalledOnce();
  });

  it("skips when another worker owns the provider request window", async () => {
    mocks.claimPlatformScrapeAttempt.mockResolvedValue(false);
    const manager = new ScraperManager();
    const source = createScraper(61);
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Jobicy", source);

    const result = await manager.scrapePlatform("Jobicy");
    expect(result).toMatchObject({ errors: [], skippedReason: "poll_interval" });
    expect(source.scrape).not.toHaveBeenCalled();
    expect(mocks.recordPlatformScrapeOutcome).not.toHaveBeenCalled();
  });

  it("releases provider serialization when a durable polling claim fails", async () => {
    mocks.claimPlatformScrapeAttempt
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(true);
    const manager = new ScraperManager();
    const source = createScraper(61);
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Jobicy", source);

    await expect(manager.scrapePlatform("Jobicy")).rejects.toThrow("database unavailable");
    const retry = await manager.scrapePlatform("Jobicy");

    expect(retry.errors).toEqual([]);
    expect(source.scrape).toHaveBeenCalledOnce();
    expect(mocks.claimPlatformScrapeAttempt).toHaveBeenCalledTimes(2);
  });

  it("waits for sibling workers before propagating a worker failure", async () => {
    const manager = new ScraperManager({ maxConcurrentScrapes: 2 });
    let releaseHealthy = () => {};
    const healthyResult = new Promise<{ jobs: []; errors: []; scrapedAt: Date }>((resolve) => {
      releaseHealthy = () => resolve({ jobs: [], errors: [], scrapedAt: new Date() });
    });
    const failed = {
      getPlatformId: () => 61,
      scrape: vi.fn(),
    } as unknown as BaseScraper;
    const healthy = {
      getPlatformId: () => 62,
      scrape: vi.fn().mockImplementation(() => healthyResult),
    } as unknown as BaseScraper;
    const scrapers = (manager as unknown as { scrapers: Map<string, BaseScraper> }).scrapers;
    scrapers.set("Jobicy", failed);
    scrapers.set("Healthy source", healthy);
    mocks.claimPlatformScrapeAttempt.mockRejectedValueOnce(new Error("claim unavailable"));

    let rejected = false;
    const cycle = manager.scrapeAll().catch((error) => {
      rejected = true;
      throw error;
    });
    await vi.waitFor(() => expect(healthy.scrape).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(rejected).toBe(false);

    releaseHealthy();
    await expect(cycle).rejects.toThrow("claim unavailable");
    expect(rejected).toBe(true);
  });

  it("restores provider polling intervals from durable source state", async () => {
    const recentAttempt = new Date();
    const where = vi.fn().mockResolvedValue([{
      id: 61,
      name: "Jobicy",
      isActive: 1,
      lastScrapeAttemptedAt: recentAttempt,
    }]);
    mocks.getDb.mockResolvedValue({ select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })) });
    const manager = new ScraperManager();
    await manager.initialize();

    const result = await manager.scrapePlatform("Jobicy");
    expect(result).toMatchObject({ errors: [], skippedReason: "poll_interval" });
    expect(mocks.recordPlatformScrapeOutcome).not.toHaveBeenCalled();
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

  it("batch-loads source identities and canonical links for multi-job refreshes", async () => {
    const existingJobs = [
      { id: 801, externalId: "source-801", platformId: 8, title: "Engineer I", company: "Batch Co", isActive: 1 },
      { id: 802, externalId: "source-802", platformId: 8, title: "Engineer II", company: "Batch Co", isActive: 1 },
    ];
    const selectResponses = [existingJobs, []];
    const select = vi.fn(() => ({
      from: () => ({
        where: vi.fn().mockImplementation(() => Promise.resolve(selectResponses.shift() ?? [])),
      }),
    }));
    const where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({ select, update });

    const result = await new ScraperManager().saveJobs(existingJobs.map((job) => ({
      ...job,
      description: `Updated ${job.externalId}`,
    })));

    expect(result).toEqual({ saved: 0, refreshed: 2, duplicates: 0, errors: 0 });
    expect(select).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("falls back to isolated indexed reads when batch prefetch is unavailable", async () => {
    const existingJobs = [
      { id: 811, externalId: "source-811", platformId: 8, title: "Engineer I", company: "Fallback Co", isActive: 1 },
      { id: 812, externalId: "source-812", platformId: 8, title: "Engineer II", company: "Fallback Co", isActive: 1 },
    ];
    let selectCall = 0;
    const fallbackResponses = [[existingJobs[0]], [], [existingJobs[1]], []];
    const select = vi.fn(() => {
      selectCall += 1;
      return {
        from: () => ({
          where: () => selectCall === 1
            ? Promise.reject(new Error("batch unavailable"))
            : { limit: vi.fn().mockResolvedValue(fallbackResponses.shift() ?? []) },
        }),
      };
    });
    const where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({ select, update });

    const result = await new ScraperManager().saveJobs(existingJobs);

    expect(result).toEqual({ saved: 0, refreshed: 2, duplicates: 0, errors: 0 });
    expect(update).toHaveBeenCalledTimes(2);
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
