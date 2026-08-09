import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

/**
 * Remote.co scraper
 * Scrapes jobs from remote.co
 */
export class RemoteCoScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "Remote.co",
      platformId,
      baseUrl: "https://remote.co",
      rateLimit: 2000,
      maxRetries: 3,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting scrape...");
      
      // Remote.co has job categories
      const categories = [
        "remote-jobs/developer",
        "remote-jobs/design",
        "remote-jobs/writing",
        "remote-jobs/customer-service",
        "remote-jobs/sales",
        "remote-jobs/marketing",
        "remote-jobs/accounting",
        "remote-jobs/project-management",
        "remote-jobs/qa",
        "remote-jobs/data",
      ];

      for (const category of categories) {
        try {
      await this.rateLimit(options?.signal);
          const url = `${this.config.baseUrl}/${category}/`;

          const response = await this.retry(async () => {
          const res = await this.fetchSource(url, {
            signal: options?.signal,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
            });

          this.assertResponseOk(res);

            return this.readResponseText(res);
          }, { signal: options?.signal });

          const parsedJobs = this.parseJobListings(response);

          for (const rawJob of parsedJobs) {
            if (options?.keywords) {
              const keywords = options.keywords.toLowerCase();
              const title = (rawJob.title || "").toLowerCase();
              if (!title.includes(keywords)) {
                continue;
              }
            }

            const normalizedJob = this.normalizeJob({
              title: rawJob.title,
              company: rawJob.company,
              location: "Remote",
              description: rawJob.description,
              applicationUrl: rawJob.link,
              externalId: rawJob.link,
              jobType: "full-time",
            });

            jobs.push(normalizedJob);

            if (options?.limit && jobs.length >= options.limit) {
              break;
            }
          }
        } catch (error) {
          const errorMsg = `Failed to scrape category ${category}: ${error}`;
          this.log(errorMsg, "warn");
          errors.push(errorMsg);
        }

        if (options?.limit && jobs.length >= options.limit) {
          break;
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

  private parseJobListings(html: string): any[] {
    const jobs: any[] = [];

    // Parse job listings from Remote.co HTML
    // Looking for job card patterns
    const jobRegex = /<a[^>]*class="[^"]*card[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = jobRegex.exec(html)) !== null) {
      const link = match[1];
      const cardContent = match[2];

      // Extract title and company from card content
      const titleMatch = cardContent.match(/<h2[^>]*>([^<]+)<\/h2>/i) || 
                         cardContent.match(/<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/span>/i);
      const companyMatch = cardContent.match(/<p[^>]*class="[^"]*company[^"]*"[^>]*>([^<]+)<\/p>/i) ||
                          cardContent.match(/<span[^>]*class="[^"]*company[^"]*"[^>]*>([^<]+)<\/span>/i);

      const title = titleMatch ? this.cleanHtmlText(titleMatch[1]) : "";
      const company = companyMatch ? this.cleanHtmlText(companyMatch[1]) : "Company via Remote.co";

      if (title && link) {
        const fullLink = link.startsWith("http") ? link : `${this.config.baseUrl}${link}`;
        jobs.push({
          title,
          company,
          link: fullLink,
        });
      }
    }

    // Alternative parsing for different HTML structure
    if (jobs.length === 0) {
      const altJobRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
      while ((match = altJobRegex.exec(html)) !== null) {
        const articleContent = match[1];
        
        const linkMatch = articleContent.match(/href="([^"]+)"/);
        const titleMatch = articleContent.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i);
        const companyMatch = articleContent.match(/company[^>]*>([^<]+)</i);

        if (linkMatch && titleMatch) {
          const link = linkMatch[1].startsWith("http") ? linkMatch[1] : `${this.config.baseUrl}${linkMatch[1]}`;
          jobs.push({
            title: this.cleanHtmlText(titleMatch[1]),
            company: companyMatch ? this.cleanHtmlText(companyMatch[1]) : "Company via Remote.co",
            link,
          });
        }
      }
    }

    return jobs;
  }

  private cleanHtmlText(text: string): string {
    return text
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }
}
