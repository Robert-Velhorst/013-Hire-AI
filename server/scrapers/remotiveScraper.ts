import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";
import { normalizeSalary } from "../jobNormalization";

/**
 * Remotive scraper
 * Scrapes jobs from remotive.com using their public API
 */
export class RemotiveScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "Remotive",
      platformId,
      baseUrl: "https://remotive.com/api/remote-jobs",
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

      // Remotive has a public API
      let url = this.config.baseUrl;
      if (options?.keywords) {
        url += `?search=${encodeURIComponent(options.keywords)}`;
      }

      const response = await this.retry(async () => {
          const res = await this.fetchSource(url, {
            signal: options?.signal,
          headers: {
            "User-Agent": "Hire.AI Job Aggregator",
          },
        });

          this.assertResponseOk(res);

        return this.readResponseJson(res);
      }, { signal: options?.signal });

      const rawJobs = response.jobs || [];
      this.log(`Found ${rawJobs.length} jobs`);

      for (const rawJob of rawJobs) {
        try {
          const salary = normalizeSalary(rawJob.salary);
          const normalizedJob = this.normalizeJob({
            title: rawJob.title,
            company: rawJob.company_name,
            location: rawJob.candidate_required_location || "Remote",
            description: rawJob.description,
            skills: rawJob.tags?.join(", "),
            jobType: rawJob.job_type,
            applicationUrl: rawJob.url,
            externalId: rawJob.id?.toString(),
            postedDate: rawJob.publication_date ? new Date(rawJob.publication_date) : undefined,
            salaryMin: salary.normalizedYearly.min ?? undefined,
            salaryMax: salary.normalizedYearly.max ?? undefined,
            salaryCurrency: salary.currency,
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
}
