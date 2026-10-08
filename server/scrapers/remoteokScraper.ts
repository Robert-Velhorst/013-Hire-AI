import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function remoteOkListingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "remoteok.com" ||
      url.username ||
      url.password ||
      url.port ||
      url.href.length > 1000
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * RemoteOK scraper
 * Scrapes jobs from remoteok.com using their public API
 */
export class RemoteOKScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "RemoteOK",
      platformId,
      baseUrl: "https://remoteok.com/api",
      rateLimit: 2000, // 2 seconds between requests
      maxRetries: 3,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: ScrapeResult["jobs"] = [];

    try {
      this.log("Starting scrape...");
      await this.rateLimit(options?.signal);

      // RemoteOK has a public API
      const response = await this.retry(async () => {
          const res = await this.fetchSource(this.config.baseUrl, {
            signal: options?.signal,
          headers: {
            "User-Agent": "Hire.AI Job Aggregator",
          },
        });

          this.assertResponseOk(res);

        return this.readResponseJson(res);
      }, { signal: options?.signal });

      // RemoteOK API returns an array of jobs
      // First item is metadata, rest are jobs
      const rawJobs = Array.isArray(response) ? response.slice(1).filter(record) : [];

      this.log(`Found ${rawJobs.length} jobs`);

      for (const rawJob of rawJobs) {
        try {
          const title = typeof rawJob.position === "string" ? rawJob.position : "";
          const company = typeof rawJob.company === "string" ? rawJob.company : "";
          const externalId = typeof rawJob.id === "string" || typeof rawJob.id === "number"
            ? String(rawJob.id)
            : typeof rawJob.slug === "string" ? rawJob.slug : "";
          const sourceUrl = remoteOkListingUrl(rawJob.url);
          if (!title.trim() || !company.trim() || !externalId.trim() || !sourceUrl) continue;

          // Apply filters if provided
          if (options?.keywords?.trim()) {
            const keywords = options.keywords.trim().toLowerCase();
            const normalizedTitle = title.toLowerCase();
            const description = (typeof rawJob.description === "string" ? rawJob.description : "").toLowerCase();
            const tags = Array.isArray(rawJob.tags) ? rawJob.tags.join(" ").toLowerCase() : "";

            if (!normalizedTitle.includes(keywords) && !description.includes(keywords) && !tags.includes(keywords)) {
              continue;
            }
          }
          if (options?.location?.trim() && !String(rawJob.location || "").toLowerCase().includes(options.location.trim().toLowerCase())) {
            continue;
          }

          const dateFromFeed = typeof rawJob.date === "string" ? new Date(rawJob.date) : null;
          const date = dateFromFeed && Number.isFinite(dateFromFeed.getTime())
            ? dateFromFeed
            : typeof rawJob.epoch === "number" && Number.isFinite(rawJob.epoch)
              ? new Date(rawJob.epoch * 1000)
              : undefined;

          const normalizedJob = this.normalizeJob({
            title: rawJob.position,
            company: rawJob.company,
            location: rawJob.location || "Remote",
            description: rawJob.description,
            skills: Array.isArray(rawJob.tags)
              ? rawJob.tags.filter((tag): tag is string => typeof tag === "string").join(", ")
              : undefined,
            jobType: "full-time",
            applicationUrl: sourceUrl,
            externalId,
            postedDate: date,
            salaryMin: rawJob.salary_min,
            salaryMax: rawJob.salary_max,
          });
          normalizedJob.sourceUrl = sourceUrl;

          jobs.push(normalizedJob);

          // Respect limit
          if (options?.limit && jobs.length >= options.limit) {
            break;
          }
        } catch (error) {
          const errorMsg = `Failed to parse job: ${error}`;
          this.log(errorMsg, "error");
          errors.push(errorMsg);
        }
      }

      this.log(`Successfully scraped ${jobs.length} jobs`);
    } catch (error) {
      const errorMsg = `Scraping failed: ${error}`;
      this.log(errorMsg, "error");
      errors.push(errorMsg);
    }

    return {
      jobs,
      errors,
      scrapedAt: new Date(),
    };
  }
}
