import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

/**
 * Working Nomads scraper
 * Scrapes jobs from workingnomads.com using their API
 */
export class WorkingNomadsScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "Working Nomads",
      platformId,
      baseUrl: "https://www.workingnomads.com/api/exposed_jobs",
      rateLimit: 2000,
      maxRetries: 3,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting scrape...");
      await this.rateLimit(options?.signal);

      // Working Nomads has a public API
      const response = await this.retry(async () => {
          const res = await fetch(this.config.baseUrl, {
            signal: options?.signal,
          headers: {
            "User-Agent": "Hire.AI Job Aggregator",
            "Accept": "application/json",
          },
        });

          this.assertResponseOk(res);

        return this.readResponseJson(res);
      }, { signal: options?.signal });

      const rawJobs = Array.isArray(response) ? response : [];
      this.log(`Found ${rawJobs.length} jobs`);

      for (const rawJob of rawJobs) {
        try {
          // Apply keyword filter
          if (options?.keywords) {
            const keywords = options.keywords.toLowerCase();
            const title = (rawJob.title || "").toLowerCase();
            const description = (rawJob.description || "").toLowerCase();

            if (!title.includes(keywords) && !description.includes(keywords)) {
              continue;
            }
          }

          const normalizedJob = this.normalizeJob({
            title: rawJob.title,
            company: rawJob.company_name,
            location: rawJob.location || "Remote",
            description: rawJob.description,
            skills: rawJob.tags?.join(", "),
            jobType: this.mapJobType(rawJob.category_name),
            applicationUrl: rawJob.url,
            externalId: rawJob.slug || rawJob.id?.toString(),
            postedDate: rawJob.pub_date ? new Date(rawJob.pub_date) : undefined,
          });

          jobs.push(normalizedJob);

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

  private mapJobType(category: string | undefined): "full-time" | "part-time" | "contract" | "temporary" | undefined {
    if (!category) return undefined;
    
    const cat = category.toLowerCase();
    if (cat.includes("full")) return "full-time";
    if (cat.includes("part")) return "part-time";
    if (cat.includes("contract") || cat.includes("freelance")) return "contract";
    
    return "full-time";
  }
}
