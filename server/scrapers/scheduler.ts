import { getScraperManager } from "./scraperManager";
import { processJobAlerts } from "../applicationFeatures";
import { randomUUID } from "node:crypto";
import {
  acquireJobDiscoveryLease,
  releaseJobDiscoveryLease,
  renewJobDiscoveryLease,
} from "../db";

const SCRAPER_FAILURE_MESSAGE = "Source scan could not complete.";
const SCRAPE_CYCLE_FAILURE_MESSAGE = "Scraping run could not complete.";
const LEASE_RENEWAL_INTERVAL_MS = 30_000;

export type ScrapingRunResult = "completed" | "failed" | "joined" | "skipped";

function sanitizePlatformErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];

  return Array.from(new Set(errors.map((error) => {
    const message = typeof error === "string" ? error.trim() : "";
    return /^Scrape timed out after \d+ms$/.test(message)
      ? message
      : SCRAPER_FAILURE_MESSAGE;
  })));
}

/**
 * Job Scraping Scheduler
 * Manages automated job scraping on a schedule
 */

export interface SchedulerConfig {
  intervalMinutes: number;
  maxJobsPerRun: number;
  // Undefined preserves an existing runtime configuration; null explicitly enables every source.
  enabledPlatforms?: string[] | null;
}

export interface SchedulerStatus {
  isStarted: boolean;
  isRunning: boolean;
  intervalMinutes: number;
  maxJobsPerRun: number;
  enabledPlatforms: string[] | null;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  totalJobsScraped: number;
  totalRunsCompleted: number;
  totalSuccessfulRuns: number;
  totalPartialRuns: number;
  totalFailedRuns: number;
  lastRunOutcome: "success" | "partial" | "failed" | null;
  /** Alerts refreshed from the most recently completed scrape cycle. */
  lastJobAlertsProcessed: number;
  /** Alert refresh failure is surfaced separately and never blocks discovery. */
  jobAlertRefreshFailed: boolean;
  errors: string[];
}

function classifyRunOutcome(platformResults: Record<string, { errors: string[] }>) {
  const results = Object.values(platformResults);
  if (results.length === 0) return "failed" as const;

  const failedSources = results.filter((result) => result.errors.length > 0).length;
  if (failedSources === 0) return "success" as const;
  if (failedSources === results.length) return "failed" as const;
  return "partial" as const;
}

export class JobScrapingScheduler {
  private config: SchedulerConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private activeCycle: Promise<ScrapingRunResult> | null = null;
  private activeCycleController: AbortController | null = null;
  private status: SchedulerStatus = {
    isStarted: false,
    isRunning: false,
    intervalMinutes: 0,
    maxJobsPerRun: 0,
    enabledPlatforms: null,
    lastRunAt: null,
    nextRunAt: null,
    totalJobsScraped: 0,
    totalRunsCompleted: 0,
    totalSuccessfulRuns: 0,
    totalPartialRuns: 0,
    totalFailedRuns: 0,
    lastRunOutcome: null,
    lastJobAlertsProcessed: 0,
    jobAlertRefreshFailed: false,
    errors: [],
  };

  constructor(config: SchedulerConfig) {
    this.config = {
      ...config,
      enabledPlatforms: config.enabledPlatforms?.slice() ?? null,
    };
    this.status.intervalMinutes = this.config.intervalMinutes;
    this.status.maxJobsPerRun = this.config.maxJobsPerRun;
    this.status.enabledPlatforms = this.config.enabledPlatforms?.slice() ?? null;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.intervalId) {
      console.log("[Scheduler] Already running");
      return;
    }
    if (this.activeCycleController?.signal.aborted) {
      console.log("[Scheduler] Shutdown still in progress");
      return;
    }

    this.status.isStarted = true;
    console.log(`[Scheduler] Starting with ${this.config.intervalMinutes} minute interval`);
    
    // Run immediately
    void this.runScraping();

    // Schedule recurring runs
    this.intervalId = setInterval(
      () => void this.runScraping(),
      this.config.intervalMinutes * 60 * 1000
    );

    this.status.nextRunAt = new Date(Date.now() + this.config.intervalMinutes * 60 * 1000);
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.status.nextRunAt = null;
      console.log("[Scheduler] Stopped");
    }
    this.status.isStarted = false;
    this.activeCycleController?.abort();
    await this.activeCycle;
  }

  /**
   * Run a single scraping cycle
   */
  async runScraping(): Promise<ScrapingRunResult> {
    if (this.activeCycle) {
      console.log("[Scheduler] Scraping already in progress, joining current run");
      const result = await this.activeCycle;
      return result === "failed" ? "failed" : "joined";
    }

    const controller = new AbortController();
    this.activeCycleController = controller;
    let cycle: Promise<ScrapingRunResult>;
    cycle = this.executeScraping(controller.signal).finally(() => {
      if (this.activeCycle === cycle) {
        this.activeCycle = null;
        this.activeCycleController = null;
      }
    });
    this.activeCycle = cycle;
    return await cycle;
  }

  private async executeScraping(shutdownSignal: AbortSignal): Promise<ScrapingRunResult> {
    const leaseToken = randomUUID();
    let acquired = false;
    try {
      acquired = await acquireJobDiscoveryLease(leaseToken);
    } catch {
      console.error("[Scheduler] Discovery lease could not be acquired");
      this.status.errors = [SCRAPE_CYCLE_FAILURE_MESSAGE];
      this.status.totalRunsCompleted++;
      this.status.totalFailedRuns++;
      this.status.lastRunOutcome = "failed";
      this.status.lastRunAt = new Date();
      return "failed";
    }
    if (!acquired) {
      console.log("[Scheduler] Discovery is already running on another server instance");
      return "skipped";
    }

    const controller = new AbortController();
    const abortForShutdown = () => controller.abort();
    shutdownSignal.addEventListener("abort", abortForShutdown, { once: true });
    let leaseLost = false;
    const renewalTimer = setInterval(() => {
      void renewJobDiscoveryLease(leaseToken).then((renewed) => {
        if (!renewed) {
          leaseLost = true;
          controller.abort();
        }
      }).catch(() => {
        leaseLost = true;
        controller.abort();
      });
    }, LEASE_RENEWAL_INTERVAL_MS);
    renewalTimer.unref();
    let completed = false;

    this.status.isRunning = true;
    this.status.errors = [];
    this.status.lastJobAlertsProcessed = 0;
    this.status.jobAlertRefreshFailed = false;
    const startTime = Date.now();

    console.log("[Scheduler] Starting scraping run...");

    try {
      const manager = await getScraperManager();
      
      const scrapingOptions: { limit: number; platformNames?: string[]; signal: AbortSignal } = {
        limit: this.config.maxJobsPerRun,
        signal: controller.signal,
      };
      if (this.config.enabledPlatforms?.length) {
        scrapingOptions.platformNames = this.config.enabledPlatforms;
      }
      const result = await manager.runScrapingCycle(scrapingOptions);

      if (controller.signal.aborted) throw new Error("Scraping cycle was cancelled.");

      this.status.totalJobsScraped += result.totalSaved;
      this.status.totalRunsCompleted++;
      this.status.lastRunAt = new Date();

      const outcome = classifyRunOutcome(result.platformResults);
      this.status.lastRunOutcome = outcome;
      if (outcome === "success") this.status.totalSuccessfulRuns++;
      else if (outcome === "partial") this.status.totalPartialRuns++;
      else this.status.totalFailedRuns++;

      // Alert matching updates the command center only. Employer notifications
      // remain limited to confirmed interview-invite evidence.
      try {
        const alertResult = await processJobAlerts();
        this.status.lastJobAlertsProcessed = alertResult.processed;
      } catch {
        this.status.jobAlertRefreshFailed = true;
        this.status.errors.push("Job alerts: refresh could not complete.");
      }

      // Collect errors from platform results
      for (const [platform, platformResult] of Object.entries(result.platformResults)) {
        const errors = sanitizePlatformErrors(platformResult.errors);
        if (errors.length > 0) {
          this.status.errors.push(`${platform}: ${errors.join(", ")}`);
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      console.log(`[Scheduler] Scraping complete in ${duration.toFixed(1)}s. Saved ${result.totalSaved} jobs.`);
      completed = true;

    } catch {
      console.error(`[Scheduler] ${SCRAPE_CYCLE_FAILURE_MESSAGE}`);
      this.status.errors.push(SCRAPE_CYCLE_FAILURE_MESSAGE);
      this.status.totalRunsCompleted++;
      this.status.totalFailedRuns++;
      this.status.lastRunOutcome = "failed";
      this.status.lastRunAt = new Date();
    } finally {
      clearInterval(renewalTimer);
      shutdownSignal.removeEventListener("abort", abortForShutdown);
      await releaseJobDiscoveryLease(leaseToken, completed && !leaseLost).catch(() => false);
      this.status.isRunning = false;
      this.status.nextRunAt = this.intervalId 
        ? new Date(Date.now() + this.config.intervalMinutes * 60 * 1000)
        : null;
    }
    return this.status.lastRunOutcome === "failed" ? "failed" : "completed";
  }

  /**
   * Get current scheduler status
   */
  getStatus(): SchedulerStatus {
    return {
      ...this.status,
      enabledPlatforms: this.status.enabledPlatforms?.slice() ?? null,
      errors: [...this.status.errors],
    };
  }

  /**
   * Update scheduler configuration
   */
  updateConfig(config: Partial<SchedulerConfig>): void {
    const shouldRestart = Boolean(
      this.intervalId &&
      config.intervalMinutes !== undefined &&
      config.intervalMinutes !== this.config.intervalMinutes
    );
    this.config = {
      ...this.config,
      ...config,
      enabledPlatforms: config.enabledPlatforms === undefined
        ? this.config.enabledPlatforms
        : config.enabledPlatforms?.slice() ?? null,
    };
    this.status.intervalMinutes = this.config.intervalMinutes;
    this.status.maxJobsPerRun = this.config.maxJobsPerRun;
    this.status.enabledPlatforms = this.config.enabledPlatforms?.slice() ?? null;
    
    // Restart if running with new interval
    if (shouldRestart) {
      clearInterval(this.intervalId!);
      this.intervalId = setInterval(
        () => void this.runScraping(),
        this.config.intervalMinutes * 60 * 1000
      );
      this.status.nextRunAt = new Date(Date.now() + this.config.intervalMinutes * 60 * 1000);
    }
  }
}

// Singleton instance
let schedulerInstance: JobScrapingScheduler | null = null;

export function getScheduler(config?: Partial<SchedulerConfig>): JobScrapingScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new JobScrapingScheduler({
      intervalMinutes: config?.intervalMinutes ?? 60,
      maxJobsPerRun: config?.maxJobsPerRun ?? 100,
      enabledPlatforms: config?.enabledPlatforms,
    });
  } else if (config) {
    schedulerInstance.updateConfig(config);
  }
  return schedulerInstance;
}

/**
 * Job data normalizer
 * Standardizes job data across different platforms
 */
export class JobNormalizer {
  /**
   * Normalize salary to annual USD
   */
  normalizeSalary(salary: {
    min?: number | null;
    max?: number | null;
    currency?: string | null;
    period?: string | null;
  }): { min: number | null; max: number | null } {
    let { min, max } = salary;
    const currency = salary.currency?.toUpperCase() || "USD";
    const period = salary.period?.toLowerCase() || "yearly";

    // Convert to annual
    if (period === "hourly" || period === "hour") {
      if (min) min = min * 2080; // 40 hours * 52 weeks
      if (max) max = max * 2080;
    } else if (period === "monthly" || period === "month") {
      if (min) min = min * 12;
      if (max) max = max * 12;
    } else if (period === "weekly" || period === "week") {
      if (min) min = min * 52;
      if (max) max = max * 52;
    }

    // Convert to USD (simplified - in production use real exchange rates)
    const exchangeRates: Record<string, number> = {
      USD: 1,
      EUR: 1.1,
      GBP: 1.27,
      CAD: 0.74,
      AUD: 0.65,
      INR: 0.012,
    };

    const rate = exchangeRates[currency] || 1;
    if (min) min = Math.round(min * rate);
    if (max) max = Math.round(max * rate);

    return { min: min || null, max: max || null };
  }

  /**
   * Normalize location string
   */
  normalizeLocation(location: string | null | undefined): string {
    if (!location) return "Remote";
    
    const loc = location.toLowerCase().trim();
    
    if (loc.includes("remote") || loc.includes("anywhere") || loc.includes("worldwide")) {
      return "Remote";
    }
    
    if (loc.includes("usa") || loc.includes("united states")) {
      return "Remote (USA)";
    }
    
    if (loc.includes("europe") || loc.includes("eu")) {
      return "Remote (Europe)";
    }
    
    // Capitalize first letter of each word
    return location
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  /**
   * Normalize job type
   */
  normalizeJobType(type: string | null | undefined): "full-time" | "part-time" | "contract" | "temporary" | null {
    if (!type) return null;
    
    const t = type.toLowerCase();
    
    if (t.includes("full") || t.includes("permanent")) return "full-time";
    if (t.includes("part")) return "part-time";
    if (t.includes("contract") || t.includes("freelance") || t.includes("consultant")) return "contract";
    if (t.includes("temp") || t.includes("intern")) return "temporary";
    
    return null;
  }

  /**
   * Extract skills from job description
   */
  extractSkills(description: string | null | undefined): string[] {
    if (!description) return [];
    
    const commonSkills = [
      "javascript", "typescript", "python", "java", "c++", "c#", "ruby", "go", "rust", "php",
      "react", "vue", "angular", "node.js", "express", "django", "flask", "rails", "spring",
      "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "jenkins", "ci/cd",
      "sql", "mysql", "postgresql", "mongodb", "redis", "elasticsearch",
      "html", "css", "sass", "tailwind", "bootstrap",
      "git", "agile", "scrum", "jira",
      "machine learning", "ai", "data science", "analytics",
      "figma", "sketch", "adobe", "photoshop", "illustrator",
      "marketing", "seo", "content", "copywriting", "social media",
    ];
    
    const descLower = description.toLowerCase();
    const foundSkills: string[] = [];
    
    for (const skill of commonSkills) {
      if (descLower.includes(skill)) {
        foundSkills.push(skill);
      }
    }
    
    return foundSkills;
  }

  /**
   * Clean and normalize description text
   */
  normalizeDescription(description: string | null | undefined): string {
    if (!description) return "";
    
    return description
      .replace(/<[^>]*>/g, " ") // Remove HTML tags
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim()
      .slice(0, 10000); // Limit length
  }
}

export const jobNormalizer = new JobNormalizer();
