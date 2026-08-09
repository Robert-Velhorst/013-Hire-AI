import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

/**
 * JustRemote scraper
 * Scrapes jobs from justremote.co
 */
export class JustRemoteScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "JustRemote",
      platformId,
      baseUrl: "https://justremote.co",
      rateLimit: 2000,
      maxRetries: 3,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting scrape...");

      const categories = [
        "remote-developer-jobs",
        "remote-design-jobs",
        "remote-marketing-jobs",
        "remote-sales-jobs",
        "remote-customer-support-jobs",
        "remote-writing-jobs",
        "remote-hr-jobs",
        "remote-finance-jobs",
      ];

      for (const category of categories) {
        try {
      await this.rateLimit(options?.signal);
          const url = `${this.config.baseUrl}/${category}`;

          const response = await this.retry(async () => {
          const res = await fetch(url, {
            signal: options?.signal,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
            });

          this.assertResponseOk(res);

            return res.text();
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
              location: rawJob.location || "Remote",
              description: rawJob.description,
              applicationUrl: rawJob.link,
              externalId: rawJob.link,
              jobType: rawJob.jobType,
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

    // Parse job cards from JustRemote HTML
    const jobCardRegex = /<div[^>]*class="[^"]*job-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let match;

    while ((match = jobCardRegex.exec(html)) !== null) {
      const cardHtml = match[1];

      const linkMatch = cardHtml.match(/href="([^"]+job[^"]+)"/i);
      const titleMatch = cardHtml.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i) ||
                        cardHtml.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</i);
      const companyMatch = cardHtml.match(/class="[^"]*company[^"]*"[^>]*>([^<]+)</i);
      const locationMatch = cardHtml.match(/class="[^"]*location[^"]*"[^>]*>([^<]+)</i);

      if (titleMatch) {
        const link = linkMatch ? 
          (linkMatch[1].startsWith("http") ? linkMatch[1] : `${this.config.baseUrl}${linkMatch[1]}`) : 
          "";
        
        jobs.push({
          title: this.cleanHtmlText(titleMatch[1]),
          company: companyMatch ? this.cleanHtmlText(companyMatch[1]) : "Company via JustRemote",
          location: locationMatch ? this.cleanHtmlText(locationMatch[1]) : "Remote",
          link,
        });
      }
    }

    // Alternative parsing
    if (jobs.length === 0) {
      const altRegex = /<a[^>]*href="([^"]*\/jobs\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = altRegex.exec(html)) !== null) {
        const link = match[1].startsWith("http") ? match[1] : `${this.config.baseUrl}${match[1]}`;
        const content = match[2];
        
        const titleMatch = content.match(/<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/i) ||
                          content.match(/>([A-Z][^<]{10,50})</);
        
        if (titleMatch) {
          jobs.push({
            title: this.cleanHtmlText(titleMatch[1]),
            company: "Company via JustRemote",
            location: "Remote",
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
      .replace(/\s+/g, " ")
      .trim();
  }
}
