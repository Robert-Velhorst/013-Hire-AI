import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

/**
 * Indeed scraper
 * Note: Indeed has strict anti-scraping measures. This uses their RSS feeds.
 * For production, consider using Indeed's official API or a third-party service.
 */
export class IndeedScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "Indeed",
      platformId,
      baseUrl: "https://www.indeed.com",
      rateLimit: 5000, // Very conservative rate limit
      maxRetries: 2,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting scrape...");
      await this.rateLimit(options?.signal);

      // Indeed has RSS feeds for job searches
      const query = options?.keywords || "remote";
      const location = options?.location || "";
      
      // Build RSS URL
      const rssUrl = `${this.config.baseUrl}/rss?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11`;

      try {
        const response = await this.retry(async () => {
          const res = await this.fetchSource(rssUrl, {
            signal: options?.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "application/rss+xml, application/xml, text/xml, */*",
            },
          });

          this.assertResponseOk(res);

          return this.readResponseText(res);
        }, { signal: options?.signal });

        const parsedJobs = this.parseRSS(response);
        this.log(`Found ${parsedJobs.length} jobs from RSS`);

        for (const rawJob of parsedJobs) {
          const normalizedJob = this.normalizeJob({
            title: rawJob.title,
            company: rawJob.company,
            location: rawJob.location || "Remote",
            description: rawJob.description,
            applicationUrl: rawJob.link,
            externalId: this.extractJobId(rawJob.link),
            postedDate: rawJob.pubDate,
            jobType: "full-time",
          });

          jobs.push(normalizedJob);

          if (options?.limit && jobs.length >= options.limit) {
            break;
          }
        }
      } catch (rssError) {
        this.log(`RSS feed error: ${rssError}`, "warn");
        errors.push(`Indeed RSS feed may be rate limited or blocked`);
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
      const source = this.extractTag(itemXml, "source");

      // Extract company and location from description or source
      const { company, location } = this.parseJobMeta(description, source);

      jobs.push({
        title,
        company,
        location,
        link,
        description: this.cleanHtml(description),
        pubDate: pubDate ? new Date(pubDate) : undefined,
      });
    }

    return jobs;
  }

  private parseJobMeta(description: string, source: string): { company: string; location: string } {
    let company = source || "Company via Indeed";
    let location = "Remote";

    // Try to extract company and location from description
    // Indeed descriptions often start with "Company - Location - ..."
    const cleanDesc = this.cleanHtml(description);
    const parts = cleanDesc.split(" - ");
    
    if (parts.length >= 2) {
      if (parts[0] && parts[0].length < 100) {
        company = parts[0].trim();
      }
      if (parts[1] && parts[1].length < 50) {
        location = parts[1].trim();
      }
    }

    return { company, location };
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

  private extractJobId(url: string): string {
    // Extract job ID from Indeed URL
    const match = url.match(/jk=([a-f0-9]+)/i);
    return match ? match[1] : url;
  }
}
