import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

/**
 * Jobspresso scraper
 * Scrapes jobs from jobspresso.co using their RSS feed
 */
export class JobspressoScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "Jobspresso",
      platformId,
      baseUrl: "https://jobspresso.co",
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

      // Jobspresso has an RSS feed
      const rssUrl = `${this.config.baseUrl}/feed/`;

      const response = await this.retry(async () => {
          const res = await fetch(rssUrl, {
            signal: options?.signal,
          headers: {
            "User-Agent": "Hire.AI Job Aggregator",
            "Accept": "application/rss+xml, application/xml, text/xml",
          },
        });

          this.assertResponseOk(res);

        return res.text();
      }, { signal: options?.signal });

      const parsedJobs = this.parseRSS(response);
      this.log(`Found ${parsedJobs.length} jobs from RSS`);

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
      const creator = this.extractTag(itemXml, "dc:creator");

      // Extract company from title or creator
      let company = creator || "";
      let jobTitle = title;
      
      // Title format is often "Job Title at Company"
      if (title.includes(" at ")) {
        const parts = title.split(" at ");
        jobTitle = parts[0].trim();
        company = parts.slice(1).join(" at ").trim();
      }

      jobs.push({
        title: jobTitle,
        company: company || "Company via Jobspresso",
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
