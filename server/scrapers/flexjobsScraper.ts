import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

/**
 * FlexJobs scraper
 * Note: FlexJobs is a paid service, so this scraper works with their public job listings
 */
export class FlexJobsScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "FlexJobs",
      platformId,
      baseUrl: "https://www.flexjobs.com",
      rateLimit: 3000, // More conservative rate limit
      maxRetries: 3,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting scrape...");
      await this.rateLimit(options?.signal);

      // FlexJobs does not expose a public API. Use its RSS feed when available
      // and leave unsupported discovery empty until an approved source exists.
      
      const rssUrl = `${this.config.baseUrl}/rss/jobs.rss`;
      
      try {
        const response = await this.retry(async () => {
          const res = await this.fetchSource(rssUrl, {
            signal: options?.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "application/rss+xml, application/xml, text/xml, */*",
            },
          });

          this.assertResponseOk(res);

          return this.readResponseText(res);
        }, { signal: options?.signal });

        const parsedJobs = this.parseRSS(response);
        
        for (const rawJob of parsedJobs) {
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
            company: rawJob.company || "Company via FlexJobs",
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
      } catch (rssError) {
        this.log(`RSS feed not available; no approved FlexJobs source is configured: ${rssError}`, "warn");
        errors.push("FlexJobs RSS feed is unavailable; no approved discovery source is configured.");
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
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      
      const title = this.extractTag(itemXml, "title");
      const link = this.extractTag(itemXml, "link");
      const description = this.extractTag(itemXml, "description");
      const pubDate = this.extractTag(itemXml, "pubDate");
      const guid = this.extractTag(itemXml, "guid");

      jobs.push({
        title,
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
      .replace(/\s+/g, " ")
      .trim();
  }
}
