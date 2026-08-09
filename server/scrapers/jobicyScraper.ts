import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

type JobicyJob = {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobIndustry?: string | string[];
  jobType?: string;
  jobGeo?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number | string;
  salaryMax?: number | string;
  salaryCurrency?: string;
  salaryPeriod?: string;
};

function includesFilter(value: unknown, filter: string | undefined) {
  if (!filter?.trim()) return true;
  return String(value ?? "").toLowerCase().includes(filter.trim().toLowerCase());
}

function annualSalary(job: JobicyJob) {
  const period = job.salaryPeriod?.trim().toLowerCase();
  if (period && !["annual", "annually", "year", "yearly"].includes(period)) {
    return { min: undefined, max: undefined };
  }
  return { min: job.salaryMin, max: job.salaryMax };
}

/** Public, remote-only JSON feed documented by Jobicy. */
export class JobicyScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "Jobicy",
      platformId,
      baseUrl: "https://jobicy.com/api/v2/remote-jobs",
      rateLimit: 2_000,
      maxRetries: 3,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const jobs: ScrapeResult["jobs"] = [];
    const errors: string[] = [];

    try {
      await this.rateLimit(options?.signal);
      const url = new URL(this.config.baseUrl);
      url.searchParams.set("count", String(Math.min(100, Math.max(1, options?.limit ?? 100))));
      if (options?.keywords?.trim()) url.searchParams.set("tag", options.keywords.trim());

      const payload = await this.retry(async () => {
        const response = await fetch(url, {
          signal: options?.signal,
          headers: { "User-Agent": "Hire.AI Job Aggregator" },
        });
        this.assertResponseOk(response);
        return this.readResponseJson<{ jobs?: unknown }>(response);
      }, { signal: options?.signal });

      const rawJobs = Array.isArray(payload.jobs) ? payload.jobs as JobicyJob[] : [];
      for (const rawJob of rawJobs) {
        try {
          if (!rawJob.id || !rawJob.jobTitle || !rawJob.companyName || !rawJob.url) continue;
          if (!includesFilter(rawJob.jobGeo, options?.location)) continue;
          const salary = annualSalary(rawJob);
          jobs.push(this.normalizeJob({
            title: rawJob.jobTitle,
            company: rawJob.companyName,
            location: rawJob.jobGeo || "Remote",
            description: rawJob.jobDescription,
            skills: Array.isArray(rawJob.jobIndustry) ? rawJob.jobIndustry.join(", ") : rawJob.jobIndustry,
            jobType: rawJob.jobType,
            applicationUrl: rawJob.url,
            externalId: String(rawJob.id),
            postedDate: rawJob.pubDate,
            salaryMin: salary.min,
            salaryMax: salary.max,
            salaryCurrency: rawJob.salaryCurrency,
          }));
          if (options?.limit && jobs.length >= options.limit) break;
        } catch {
          errors.push("One Jobicy listing could not be normalized.");
        }
      }
    } catch (error) {
      errors.push(`Jobicy request failed: ${error}`);
    }

    return { jobs, errors, scrapedAt: new Date() };
  }
}
