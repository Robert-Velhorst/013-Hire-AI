import type { BaseScraper, ScrapeRequestOptions, ScrapeResult } from "./baseScraper";
import { getScraperForPlatform, getSupportedPlatforms, hasScraper } from "./index";
import { ensureScraperPlatformCatalog, getDb, recordPlatformScrapeOutcome } from "../db";
import { jobDuplicates, jobs, jobPlatforms } from "../../drizzle/schema";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { samplePlatforms } from "../sampleData";
import { findBestJobDuplicateCandidate } from "../jobDeduplication";
import { isJobListingCurrent } from "../../shared/jobListingFreshness";
import { getPlatformDiscoveryPolicy, isAutomatedDiscoveryPlatform, isCatalogedPlatform } from "./platformCatalog";
import { ENV } from "../_core/env";

export interface ScrapeOptions {
  keywords?: string;
  location?: string;
  limit?: number;
  platformNames?: string[];
}

export interface ScraperManagerOptions {
  scrapeTimeoutMs?: number;
  maxConcurrentScrapes?: number;
}

const DEFAULT_SCRAPE_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_CONCURRENT_SCRAPES = 3;
export const SCRAPER_FAILURE_MESSAGE = "Source scan could not complete.";
export const SCRAPER_INITIALIZATION_FAILURE_MESSAGE = "Source initialization could not complete.";

function sanitizeScrapeError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";

  // This is generated locally, contains no provider-controlled detail, and gives
  // operators useful context when a source exceeds its configured deadline.
  return /^Scrape timed out after \d+ms$/.test(message)
    ? message
    : SCRAPER_FAILURE_MESSAGE;
}

function sanitizeScrapeErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  return Array.from(new Set(errors.map((error) => sanitizeScrapeError(error))));
}

function isCurrentListing(job: { isActive?: number | null; expiryDate?: Date | null; updatedAt?: Date | null; createdAt?: Date | null }, now: Date) {
  return isJobListingCurrent(job, now);
}

function refreshedListingValues(job: any, current: any, now: Date) {
  return {
    title: job.title ?? current.title,
    company: job.company ?? current.company,
    description: job.description ?? current.description,
    requirements: job.requirements ?? current.requirements,
    responsibilities: job.responsibilities ?? current.responsibilities,
    benefits: job.benefits ?? current.benefits,
    location: job.location ?? current.location,
    jobType: job.jobType ?? current.jobType,
    salaryMin: job.salaryMin ?? current.salaryMin,
    salaryMax: job.salaryMax ?? current.salaryMax,
    salaryCurrency: job.salaryCurrency ?? current.salaryCurrency,
    skills: job.skills ?? current.skills,
    applicationUrl: job.applicationUrl ?? current.applicationUrl,
    applicationEmail: job.applicationEmail ?? current.applicationEmail,
    applicationProcess: job.applicationProcess ?? current.applicationProcess,
    sourceUrl: job.sourceUrl ?? current.sourceUrl,
    postedDate: job.postedDate ?? current.postedDate,
    // Re-observing a source identity supersedes a prior expiry for that source.
    expiryDate: job.expiryDate ?? null,
    isActive: 1,
    visaSponsorshipAvailable: job.visaSponsorshipAvailable ?? current.visaSponsorshipAvailable,
    openHiringSupport: job.openHiringSupport ?? current.openHiringSupport,
    diversityFriendly: job.diversityFriendly ?? current.diversityFriendly,
    updatedAt: now,
  };
}

/**
 * Scraper Manager
 * Coordinates scraping across all platforms and manages job deduplication
 */

export class ScraperManager {
  private scrapers: Map<string, BaseScraper> = new Map();
  private platformIds: Map<string, number> = new Map();
  private initializationErrors: Map<string, string> = new Map();
  private readonly scrapeTimeoutMs: number;
  private readonly maxConcurrentScrapes: number;
  private readonly platformRunTails = new Map<string, Promise<void>>();

  constructor(options: ScraperManagerOptions = {}) {
    this.scrapeTimeoutMs = Math.min(300_000, Math.max(1, Math.floor(options.scrapeTimeoutMs ?? DEFAULT_SCRAPE_TIMEOUT_MS)));
    this.maxConcurrentScrapes = Math.min(10, Math.max(1, Math.floor(options.maxConcurrentScrapes ?? DEFAULT_MAX_CONCURRENT_SCRAPES)));
  }

  /**
   * Initialize all scrapers
   */
  async initialize(): Promise<void> {
    await ensureScraperPlatformCatalog();
    const db = await getDb();
    const platforms = db
      ? await db.select().from(jobPlatforms).where(eq(jobPlatforms.isActive, 1))
      : samplePlatforms.filter((platform) => platform.isActive === 1);

    console.log(`[ScraperManager] Initializing scrapers for ${platforms.length} platforms`);

    // Initialize scrapers for platforms we have implemented
    for (const platform of platforms) {
      this.platformIds.set(platform.name, platform.id);
      if (isCatalogedPlatform(platform.name) && !isAutomatedDiscoveryPlatform(platform.name)) {
        // The catalog deliberately contains account-only, marketplace, alias,
        // and discontinued sources. Tracking them is useful; unattended
        // collection is not permitted without an approved ingestion contract.
        this.initializationErrors.set(platform.name, getPlatformDiscoveryPolicy(platform.name).reason);
        continue;
      }
      try {
        const scraper = this.createScraper(platform.name, platform.id);
        if (scraper) {
          this.scrapers.set(platform.name, scraper);
          console.log(`[ScraperManager] Initialized scraper for ${platform.name}`);
        }
      } catch {
        this.initializationErrors.set(platform.name, SCRAPER_INITIALIZATION_FAILURE_MESSAGE);
        console.error(`[ScraperManager] Failed to initialize scraper for ${platform.name}.`);
        await this.recordScrapeOutcome(platform.name, platform.id, {
          jobs: [],
          errors: [SCRAPER_INITIALIZATION_FAILURE_MESSAGE],
          scrapedAt: new Date(),
        });
      }
    }

    console.log(`[ScraperManager] Initialized ${this.scrapers.size} scrapers`);
  }

  /**
   * Create a scraper instance for a platform
   */
  private createScraper(platformName: string, platformId: number): BaseScraper | null {
    return getScraperForPlatform(platformName, platformId);
  }

  /**
   * Get list of supported platforms
   */
  getSupportedPlatforms(): string[] {
    return getSupportedPlatforms();
  }

  /**
   * Registered adapters and configured source records are intentionally separate.
   * A scraper can only be scheduled after an active platform record gives it a
   * durable platform id for job provenance and deduplication.
   */
  getInitializedPlatforms(): string[] {
    return Array.from(this.scrapers.keys()).sort((left, right) => left.localeCompare(right));
  }

  getInitializationError(platformName: string): string | null {
    return this.initializationErrors.get(platformName) ?? null;
  }

  getExecutionPolicy() {
    return {
      scrapeTimeoutMs: this.scrapeTimeoutMs,
      maxConcurrentScrapes: this.maxConcurrentScrapes,
      serializedPerPlatform: true,
    } as const;
  }

  /**
   * Check if a platform has a scraper
   */
  hasScraper(platformName: string): boolean {
    return hasScraper(platformName);
  }

  private async scrapeWithDeadline(
    platformName: string,
    scraper: BaseScraper,
    options?: ScrapeRequestOptions
  ): Promise<ScrapeResult> {
    const previousRun = this.platformRunTails.get(platformName) ?? Promise.resolve();
    let releaseRun = () => {};
    const currentRun = new Promise<void>((resolve) => { releaseRun = resolve; });
    this.platformRunTails.set(platformName, currentRun);
    await previousRun;

    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        scraper.scrape({ ...options, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => {
              reject(new Error(`Scrape timed out after ${this.scrapeTimeoutMs}ms`));
              controller.abort();
            },
            this.scrapeTimeoutMs
          );
        }),
      ]);
      const sanitizedResult = {
        ...result,
        errors: sanitizeScrapeErrors(result.errors),
      };
      await this.recordScrapeOutcome(platformName, scraper.getPlatformId(), sanitizedResult);
      return sanitizedResult;
    } catch (error) {
      const result = { jobs: [], errors: [sanitizeScrapeError(error)], scrapedAt: new Date() };
      console.error(`[ScraperManager] Failed to scrape ${platformName}.`);
      await this.recordScrapeOutcome(platformName, scraper.getPlatformId(), result);
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseRun();
      if (this.platformRunTails.get(platformName) === currentRun) {
        this.platformRunTails.delete(platformName);
      }
    }
  }

  private async recordScrapeOutcome(platformName: string, platformId: number, result: ScrapeResult) {
    try {
      await recordPlatformScrapeOutcome(platformId, {
        jobCount: result.jobs.length,
        errors: result.errors,
      });
    } catch {
      // A metadata write must not convert a completed external scan into a failed one.
      console.error(`[ScraperManager] Failed to record scrape outcome for ${platformName}.`);
    }
  }

  private async recordUnavailablePlatform(platformName: string) {
    const platformId = this.platformIds.get(platformName);
    if (!platformId) return;

    await this.recordScrapeOutcome(platformName, platformId, {
      jobs: [],
      errors: [SCRAPER_INITIALIZATION_FAILURE_MESSAGE],
      scrapedAt: new Date(),
    });
  }

  /**
   * Scrape jobs from a specific platform
   */
  async scrapePlatform(
    platformName: string,
    options?: {
      keywords?: string;
      location?: string;
      limit?: number;
    }
  ): Promise<ScrapeResult> {
    const scraper = this.scrapers.get(platformName);
    if (!scraper) {
      await this.recordUnavailablePlatform(platformName);
      return {
        jobs: [],
        errors: [`No scraper available for platform: ${platformName}`],
        scrapedAt: new Date(),
      };
    }

    console.log(`[ScraperManager] Scraping ${platformName}...`);
    const result = await this.scrapeWithDeadline(platformName, scraper, options);
    console.log(
      `[ScraperManager] Scraped ${result.jobs.length} jobs from ${platformName} (${result.errors.length} errors)`
    );

    return result;
  }

  /**
   * Scrape jobs from all platforms
   */
  async scrapeAll(options?: ScrapeOptions): Promise<{
    totalJobs: number;
    platformResults: Record<string, ScrapeResult>;
  }> {
    const platformResults: Record<string, ScrapeResult> = {};
    let totalJobs = 0;

    const requestedPlatformNames = Array.from(new Set(
      options?.platformNames?.map((platformName) => platformName.trim()).filter(Boolean) ?? []
    ));
    const selectedScrapers = requestedPlatformNames.length > 0
      ? Array.from(this.scrapers.entries()).filter(([platformName]) => requestedPlatformNames.includes(platformName))
      : Array.from(this.scrapers.entries());

    console.log(`[ScraperManager] Starting scrape of ${selectedScrapers.length} platforms`);

    for (const platformName of requestedPlatformNames) {
      if (!this.scrapers.has(platformName)) {
        await this.recordUnavailablePlatform(platformName);
        platformResults[platformName] = {
          jobs: [],
          errors: [`No scraper available for platform: ${platformName}`],
          scrapedAt: new Date(),
        };
      }
    }

    const pendingScrapers = [...selectedScrapers];
    const workers = Array.from(
      { length: Math.min(this.maxConcurrentScrapes, pendingScrapers.length) },
      async () => {
        while (pendingScrapers.length > 0) {
          const entry = pendingScrapers.shift();
          if (!entry) return;
          const [platformName, scraper] = entry;
          console.log(`[ScraperManager] Scraping ${platformName}...`);
          const result = await this.scrapeWithDeadline(platformName, scraper, options);
          platformResults[platformName] = result;
          totalJobs += result.jobs.length;
        }
      }
    );
    await Promise.all(workers);

    console.log(`[ScraperManager] Scraping complete. Total jobs: ${totalJobs}`);

    return {
      totalJobs,
      platformResults,
    };
  }

  /**
   * Save scraped jobs to database with deduplication
   */
  async saveJobs(scrapedJobs: any[]): Promise<{
    saved: number;
    refreshed: number;
    duplicates: number;
    errors: number;
  }> {
    const db = await getDb();
    if (!db) {
      return { saved: 0, refreshed: 0, duplicates: scrapedJobs.length, errors: 0 };
    }

    let saved = 0;
    let refreshed = 0;
    let duplicates = 0;
    let errors = 0;
    const now = new Date();

    for (const job of scrapedJobs) {
      try {
        // Check for duplicates by external ID and platform
        if (job.externalId && job.platformId) {
          const existing = await db
            .select()
            .from(jobs)
            .where(and(eq(jobs.externalId, job.externalId), eq(jobs.platformId, job.platformId)))
            .limit(1);

          if (existing.length > 0) {
            const current = existing[0];
            await db
              .update(jobs)
              .set(refreshedListingValues(job, current, now))
              .where(eq(jobs.id, current.id));

            const sourceLink = await db
              .select({ primaryJobId: jobDuplicates.primaryJobId })
              .from(jobDuplicates)
              .where(eq(jobDuplicates.duplicateJobId, current.id))
              .limit(1);
            if (sourceLink[0]) {
              const primary = await db
                .select()
                .from(jobs)
                .where(eq(jobs.id, sourceLink[0].primaryJobId))
                .limit(1);
              if (primary[0] && !isCurrentListing(primary[0], now)) {
                // The canonical row represents the aggregate opportunity. A live
                // linked source must keep it discoverable and actionable.
                await db
                  .update(jobs)
                  .set(refreshedListingValues(job, primary[0], now))
                  .where(eq(jobs.id, primary[0].id));
              }
            }
            refreshed++;
            continue;
          }
        }

        const duplicateCandidates = job.company && job.title
          ? await db
              .select({
                id: jobs.id,
                applicationUrl: jobs.applicationUrl,
                sourceUrl: jobs.sourceUrl,
                title: jobs.title,
                company: jobs.company,
                description: jobs.description,
                location: jobs.location,
              })
              .from(jobs)
              .where(and(
                or(
                  eq(jobs.company, job.company),
                  eq(jobs.title, job.title)
                ),
                eq(jobs.isActive, 1),
                or(isNull(jobs.expiryDate), gt(jobs.expiryDate, now)),
                sql`NOT EXISTS (
                  SELECT 1 FROM ${jobDuplicates}
                  WHERE ${jobDuplicates.duplicateJobId} = ${jobs.id}
                )`
              ))
              .limit(100)
          : [];
        const crossPlatformDuplicate = findBestJobDuplicateCandidate(job, duplicateCandidates);
        if (crossPlatformDuplicate) {
          const duplicateWrite = await db.insert(jobs).values(job);
          const duplicateJobId = Number(duplicateWrite[0].insertId);
          await db.insert(jobDuplicates).values({
            primaryJobId: crossPlatformDuplicate.job.id,
            duplicateJobId,
            similarityScore: Math.round(crossPlatformDuplicate.match.similarity * 100),
          });
          duplicates++;
          continue;
        }

        // Insert new job
        await db.insert(jobs).values(job);
        saved++;
      } catch {
        console.error("[ScraperManager] Failed to save job.");
        errors++;
      }
    }

    console.log(
      `[ScraperManager] Saved ${saved} jobs, refreshed ${refreshed} existing listings, linked ${duplicates} duplicates, ${errors} errors`
    );

    return { saved, refreshed, duplicates, errors };
  }

  /**
   * Run a full scraping cycle
   */
  async runScrapingCycle(options?: ScrapeOptions): Promise<{
    totalScraped: number;
    totalSaved: number;
    totalRefreshed: number;
    totalDuplicates: number;
    totalErrors: number;
    platformResults: Record<string, ScrapeResult>;
  }> {
    console.log("[ScraperManager] Starting scraping cycle");

    // Scrape all platforms
    const { totalJobs, platformResults } = await this.scrapeAll(options);

    // Collect all jobs
    const allJobs = Object.values(platformResults).flatMap((result) => result.jobs);

    // Save to database
    const { saved, refreshed, duplicates, errors } = await this.saveJobs(allJobs);

    console.log("[ScraperManager] Scraping cycle complete");

    return {
      totalScraped: totalJobs,
      totalSaved: saved,
      totalRefreshed: refreshed,
      totalDuplicates: duplicates,
      totalErrors: errors,
      platformResults,
    };
  }
}

// Singleton instance
let scraperManagerInstance: ScraperManager | null = null;

export async function getScraperManager(): Promise<ScraperManager> {
  if (!scraperManagerInstance) {
    scraperManagerInstance = new ScraperManager({
      scrapeTimeoutMs: ENV.jobScrapingSourceTimeoutMs,
      maxConcurrentScrapes: ENV.jobScrapingMaxConcurrentSources,
    });
    await scraperManagerInstance.initialize();
  }
  return scraperManagerInstance;
}
