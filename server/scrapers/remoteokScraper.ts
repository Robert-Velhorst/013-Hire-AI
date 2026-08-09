import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

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
    const jobs: any[] = [];

    try {
      this.log("Starting scrape...");
      await this.rateLimit(options?.signal);

      // RemoteOK has a public API
      const response = await this.retry(async () => {
          const res = await fetch(this.config.baseUrl, {
            signal: options?.signal,
          headers: {
            "User-Agent": "Hire.AI Job Aggregator",
          },
        });

          this.assertResponseOk(res);

        return res.json();
      }, { signal: options?.signal });

      // RemoteOK API returns an array of jobs
      // First item is metadata, rest are jobs
      const rawJobs = Array.isArray(response) ? response.slice(1) : [];

      this.log(`Found ${rawJobs.length} jobs`);

      for (const rawJob of rawJobs) {
        try {
          // Apply filters if provided
          if (options?.keywords) {
            const keywords = options.keywords.toLowerCase();
            const title = (rawJob.position || "").toLowerCase();
            const description = (rawJob.description || "").toLowerCase();

            if (!title.includes(keywords) && !description.includes(keywords)) {
              continue;
            }
          }

          const normalizedJob = this.normalizeJob({
            title: rawJob.position,
            company: rawJob.company,
            location: rawJob.location || "Remote",
            description: rawJob.description,
            skills: rawJob.tags?.join(", "),
            jobType: "full-time",
            applicationUrl: rawJob.url,
            externalId: rawJob.id || rawJob.slug,
            postedDate: rawJob.date ? new Date(rawJob.date * 1000) : undefined,
            salaryMin: rawJob.salary_min,
            salaryMax: rawJob.salary_max,
          });

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
