import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

/**
 * We Work Remotely scraper
 * Scrapes jobs from weworkremotely.com
 */
export class WeWorkRemotelyScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "We Work Remotely",
      platformId,
      baseUrl: "https://weworkremotely.com",
      rateLimit: 2000,
      maxRetries: 3,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting scrape...");

      // We Work Remotely has RSS feeds for different categories
      const categories = [
        "remote-jobs/programming",
        "remote-jobs/design",
        "remote-jobs/copywriting",
        "remote-jobs/devops-sysadmin",
        "remote-jobs/business-exec-management",
        "remote-jobs/finance-legal",
        "remote-jobs/product",
        "remote-jobs/customer-support",
        "remote-jobs/sales-marketing",
        "remote-jobs/human-resources",
      ];

      for (const category of categories) {
        try {
          await this.rateLimit(options?.signal);
          const rssUrl = `${this.config.baseUrl}/categories/${category}.rss`;
          
          const response = await this.retry(async () => {
          const res = await this.fetchSource(rssUrl, {
            signal: options?.signal,
              headers: {
                "User-Agent": "Hire.AI Job Aggregator",
                "Accept": "application/rss+xml, application/xml, text/xml",
              },
            });

          this.assertResponseOk(res);

            return this.readResponseText(res);
          }, { signal: options?.signal });

          // Parse RSS XML
          const parsedJobs = this.parseRSS(response);
          
          for (const rawJob of parsedJobs) {
            // Apply keyword filter if provided
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
              company: rawJob.company,
              location: "Remote",
              description: rawJob.description,
              applicationUrl: rawJob.link,
              externalId: rawJob.guid || rawJob.link,
              postedDate: rawJob.pubDate,
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

  private parseRSS(xml: string): any[] {
    const jobs: any[] = [];
    
    // Simple XML parsing for RSS items
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      
      const title = this.extractTag(itemXml, "title");
      const link = this.extractTag(itemXml, "link");
      const description = this.extractTag(itemXml, "description");
      const pubDate = this.extractTag(itemXml, "pubDate");
      const guid = this.extractTag(itemXml, "guid");

      // Extract company from title (format: "Company: Job Title")
      let company = "";
      let jobTitle = title;
      if (title.includes(":")) {
        const parts = title.split(":");
        company = parts[0].trim();
        jobTitle = parts.slice(1).join(":").trim();
      }

      jobs.push({
        title: jobTitle,
        company,
        link,
        description: this.cleanHtml(description),
        pubDate: pubDate ? new Date(pubDate) : undefined,
        guid,
      });
    }

    return jobs;
  }

  private extractTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = xml.match(regex);
    return match ? (match[1] || match[2] || "").trim() : "";
  }

  private cleanHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }
}
