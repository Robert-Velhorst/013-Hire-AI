import { createHash } from "node:crypto";
import type { Job } from "../../drizzle/schema";
import { JOB_STORAGE_MAX_CHARS } from "../../shared/jobStoragePolicy";
import { normalizeSalary } from "../jobNormalization";
import {
  outboundRequestSignal,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "../_core/outboundRequest";

export const SCRAPER_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Base scraper class for job platforms
 * All platform-specific scrapers should extend this class
 */

export interface ScraperConfig {
  platformName: string;
  platformId: number;
  baseUrl: string;
  rateLimit: number; // milliseconds between requests
  maxRetries: number;
}

export interface ScrapeResult {
  jobs: Partial<Job>[];
  errors: string[];
  scrapedAt: Date;
  skippedReason?: "poll_interval";
}

export interface ScrapeRequestOptions {
  keywords?: string;
  location?: string;
  limit?: number;
  signal?: AbortSignal;
}

export class ScraperHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | null,
  ) {
    super(`HTTP ${status}`);
    this.name = "ScraperHttpError";
  }
}

function abortError() {
  const error = new Error("Source request was cancelled.");
  error.name = "AbortError";
  return error;
}

function wait(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds * 1000), 300_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(date - now, 0), 300_000);
}

export abstract class BaseScraper {
  protected config: ScraperConfig;
  protected lastRequestTime: number = 0;
  private requestSlot: Promise<void> = Promise.resolve();

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  getPlatformId(): number {
    return this.config.platformId;
  }

  /**
   * Main scraping method - must be implemented by each platform scraper
   */
  abstract scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult>;

  /**
   * Rate limiting helper
   */
  protected async rateLimit(signal?: AbortSignal): Promise<void> {
    let release = () => {};
    const previous = this.requestSlot;
    this.requestSlot = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const waitTime = this.config.rateLimit - (Date.now() - this.lastRequestTime);
      if (waitTime > 0) await wait(waitTime, signal);
      if (signal?.aborted) throw abortError();
      this.lastRequestTime = Date.now();
    } finally {
      release();
    }
  }

  /**
   * Retry logic for failed requests
   */
  protected async retry<T>(
    fn: () => Promise<T>,
    options: { retries?: number; signal?: AbortSignal } = {}
  ): Promise<T> {
    const retries = options.retries ?? this.config.maxRetries;
    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw abortError();
      try {
        return await fn();
      } catch (error) {
        const retryable = error instanceof ScraperHttpError
          ? [408, 425, 429].includes(error.status) || error.status >= 500
          : error instanceof TypeError;
        if (!retryable || attempt >= retries || options.signal?.aborted) throw error;
        const exponentialDelay = Math.min(1000 * (2 ** attempt), 30_000);
        const retryAfterMs = error instanceof ScraperHttpError ? error.retryAfterMs ?? 0 : 0;
        await wait(Math.max(exponentialDelay, retryAfterMs), options.signal);
        await this.rateLimit(options.signal);
      }
    }
  }

  protected assertResponseOk(response: Response): void {
    if (response.ok) return;
    void response.body?.cancel().catch(() => undefined);
    throw new ScraperHttpError(response.status, parseRetryAfterMs(response.headers.get("retry-after")));
  }

  protected fetchSource(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const requestDeadline = outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard);
    const signal = init.signal
      ? AbortSignal.any([init.signal, requestDeadline])
      : requestDeadline;
    return fetch(input, {
      ...init,
      signal,
      redirect: "error",
    });
  }

  protected readResponseText(response: Response): Promise<string> {
    return readBoundedResponseText(response, SCRAPER_RESPONSE_MAX_BYTES);
  }

  protected readResponseJson<T = any>(response: Response): Promise<T> {
    return readBoundedResponseJson<T>(response, SCRAPER_RESPONSE_MAX_BYTES);
  }

  /**
   * Normalize job data to match our schema
   */
  protected normalizeJob(rawJob: any): Partial<Job> {
    return {
      platformId: this.config.platformId,
      title: this.cleanText(rawJob.title, JOB_STORAGE_MAX_CHARS.title),
      company: this.cleanText(rawJob.company, JOB_STORAGE_MAX_CHARS.company),
      location: this.cleanText(rawJob.location, JOB_STORAGE_MAX_CHARS.location) || "Remote",
      description: this.cleanText(rawJob.description, JOB_STORAGE_MAX_CHARS.text),
      requirements: this.cleanText(rawJob.requirements, JOB_STORAGE_MAX_CHARS.text),
      responsibilities: this.cleanText(rawJob.responsibilities, JOB_STORAGE_MAX_CHARS.text),
      benefits: this.cleanText(rawJob.benefits, JOB_STORAGE_MAX_CHARS.text),
      skills: this.cleanText(rawJob.skills, JOB_STORAGE_MAX_CHARS.text),
      jobType: this.normalizeJobType(rawJob.jobType),
      salaryMin: this.parseSalary(rawJob.salaryMin),
      salaryMax: this.parseSalary(rawJob.salaryMax),
      salaryCurrency: this.normalizeSalaryCurrency(rawJob.salaryCurrency),
      applicationUrl: this.normalizeApplicationUrl(rawJob.applicationUrl),
      externalId: this.normalizeExternalId(rawJob.externalId || rawJob.id),
      postedDate: this.parseDate(rawJob.postedDate),
      expiryDate: this.parseDate(rawJob.expiryDate),
      isActive: 1,
    };
  }

  /**
   * Clean and normalize text
   */
  protected cleanText(text: any, maxChars: number): string | undefined {
    if (!text) return undefined;
    const normalized = String(text)
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\n+/g, "\n");
    if (!normalized) return undefined;
    if (normalized.length <= maxChars) return normalized;

    const end = /[\uD800-\uDBFF]/.test(normalized[maxChars - 1])
      ? maxChars - 1
      : maxChars;
    return normalized.slice(0, end);
  }

  /**
   * Normalize job type
   */
  protected normalizeJobType(type: any): "full-time" | "part-time" | "contract" | "temporary" | undefined {
    if (!type) return undefined;

    const typeStr = String(type).toLowerCase();

    if (typeStr.includes("full") || typeStr.includes("fulltime")) return "full-time";
    if (typeStr.includes("part") || typeStr.includes("parttime")) return "part-time";
    if (typeStr.includes("contract")) return "contract";
    if (typeStr.includes("temp")) return "temporary";

    return undefined;
  }

  /**
   * Parse salary string to number
   */
  protected parseSalary(salary: any): number | undefined {
    if (!salary) return undefined;
    if (typeof salary === "number") return Number.isFinite(salary) ? salary : undefined;

    return normalizeSalary(String(salary)).min ?? undefined;
  }

  protected normalizeSalaryCurrency(currency: unknown): string {
    if (typeof currency !== "string" || !currency.trim()) return "USD";

    const code = currency.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) return code;

    return normalizeSalary(currency).currency;
  }

  private normalizeExternalId(value: unknown): string | undefined {
    const normalized = this.cleanText(value, SCRAPER_RESPONSE_MAX_BYTES);
    if (!normalized || normalized.length <= JOB_STORAGE_MAX_CHARS.externalId) return normalized;

    const digest = createHash("sha256").update(normalized).digest("hex");
    const prefixLength = JOB_STORAGE_MAX_CHARS.externalId - digest.length - 1;
    return `${this.cleanText(normalized, prefixLength)}:${digest}`;
  }

  /** Resolve provider-relative job links and exclude non-web destinations. */
  protected normalizeApplicationUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || !value.trim()) return undefined;

    try {
      const url = new URL(value.trim(), this.config.baseUrl);
      const normalized = url.toString();
      return (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password &&
        normalized.length <= JOB_STORAGE_MAX_CHARS.applicationUrl
        ? normalized
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Parse date string
   */
  protected parseDate(date: any): Date | undefined {
    if (!date) return undefined;
    if (date instanceof Date) return date;

    try {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? undefined : parsed;
    } catch {
      return undefined;
    }
  }

  /**
   * Log scraping activity
   */
  protected log(message: string, level: "info" | "warn" | "error" = "info"): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${this.config.platformName}] [${level.toUpperCase()}] ${message}`);
  }
}
