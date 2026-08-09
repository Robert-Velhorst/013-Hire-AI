import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

type ArbeitnowJob = {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number | string;
};

function contains(value: unknown, filter: string | undefined) {
  if (!filter?.trim()) return true;
  return String(value ?? "").toLowerCase().includes(filter.trim().toLowerCase());
}

/** One bounded page from Arbeitnow's documented no-key job API. */
export class ArbeitnowScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "Arbeitnow",
      platformId,
      baseUrl: "https://www.arbeitnow.com/api/job-board-api",
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
      url.searchParams.set("page", "1");
      const payload = await this.retry(async () => {
        const response = await fetch(url, {
          signal: options?.signal,
          headers: { "User-Agent": "Hire.AI Job Aggregator" },
        });
        this.assertResponseOk(response);
        return this.readResponseJson<{ data?: unknown }>(response);
      }, { signal: options?.signal });

      const rawJobs = Array.isArray(payload.data) ? payload.data as ArbeitnowJob[] : [];
      for (const rawJob of rawJobs) {
        try {
          if (rawJob.remote !== true) continue;
          if (!rawJob.slug || !rawJob.title || !rawJob.company_name || !rawJob.url) continue;
          if (!contains(`${rawJob.title} ${rawJob.description} ${(rawJob.tags ?? []).join(" ")}`, options?.keywords)) continue;
          if (!contains(rawJob.location, options?.location)) continue;
          jobs.push(this.normalizeJob({
            externalId: rawJob.slug,
            title: rawJob.title,
            company: rawJob.company_name,
            description: rawJob.description,
            location: rawJob.location || "Remote - Germany",
            skills: rawJob.tags?.join(", "),
            jobType: rawJob.job_types?.[0],
            // Arbeitnow requires API consumers to link back to the provider.
            applicationUrl: rawJob.url,
            postedDate: typeof rawJob.created_at === "number"
              ? new Date(rawJob.created_at * 1000)
              : rawJob.created_at,
          }));
          if (options?.limit && jobs.length >= options.limit) break;
        } catch {
          errors.push("One Arbeitnow listing could not be normalized.");
        }
      }
    } catch (error) {
      errors.push(`Arbeitnow request failed: ${error}`);
    }
    return { jobs, errors, scrapedAt: new Date() };
  }
}
