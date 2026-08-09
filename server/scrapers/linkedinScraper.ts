import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult } from "./baseScraper";

/**
 * LinkedIn Jobs scraper
 * Note: LinkedIn has very strict anti-scraping measures.
 * This scraper uses their public job search RSS/API where available.
 * For production, consider using LinkedIn's official API with proper authentication.
 */
export class LinkedInScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "LinkedIn Jobs",
      platformId,
      baseUrl: "https://www.linkedin.com",
      rateLimit: 5000, // Very conservative
      maxRetries: 2,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting scrape...");
      await this.rateLimit(options?.signal);

      // LinkedIn's public job search API endpoint
      const keywords = options?.keywords || "remote";
      const location = options?.location || "";
      
      // Use LinkedIn's public jobs API (limited access)
      const apiUrl = `${this.config.baseUrl}/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_WT=2&start=0`;

      try {
        const response = await this.retry(async () => {
          const res = await fetch(apiUrl, {
            signal: options?.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });

          this.assertResponseOk(res);

          return this.readResponseText(res);
        }, { signal: options?.signal });

        // Parse HTML response for job listings
        const parsedJobs = this.parseJobListings(response);
        this.log(`Found ${parsedJobs.length} jobs`);

        for (const rawJob of parsedJobs) {
          const normalizedJob = this.normalizeJob({
            title: rawJob.title,
            company: rawJob.company,
            location: rawJob.location || "Remote",
            description: rawJob.description,
            applicationUrl: rawJob.link,
            externalId: rawJob.jobId,
            postedDate: rawJob.postedDate,
            jobType: "full-time",
          });

          jobs.push(normalizedJob);

          if (options?.limit && jobs.length >= options.limit) {
            break;
          }
        }
      } catch (apiError) {
        this.log(`LinkedIn API error: ${apiError}`, "warn");
        errors.push(`LinkedIn requires browser automation or official API for reliable scraping`);
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

    // Parse job cards from LinkedIn's HTML structure
    // This is a simplified parser - production would need more robust parsing
    const jobCardRegex = /<li[^>]*class="[^"]*job-search-card[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let match;

    while ((match = jobCardRegex.exec(html)) !== null) {
      const cardHtml = match[1];

      const title = this.extractAttribute(cardHtml, "base-search-card__title", "text");
      const company = this.extractAttribute(cardHtml, "base-search-card__subtitle", "text");
      const location = this.extractAttribute(cardHtml, "job-search-card__location", "text");
      const link = this.extractAttribute(cardHtml, "base-card__full-link", "href");
      const jobId = this.extractJobId(link);
      const postedTime = this.extractAttribute(cardHtml, "job-search-card__listdate", "datetime");

      if (title && link) {
        jobs.push({
          title: this.cleanTextContent(title),
          company: this.cleanTextContent(company),
          location: this.cleanTextContent(location),
          link,
          jobId,
          postedDate: postedTime ? new Date(postedTime) : undefined,
        });
      }
    }

    return jobs;
  }

  private extractAttribute(html: string, className: string, attr: string): string {
    if (attr === "text") {
      const regex = new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([^<]+)`, "i");
      const match = html.match(regex);
      return match ? match[1].trim() : "";
    } else {
      const regex = new RegExp(`class="[^"]*${className}[^"]*"[^>]*${attr}="([^"]+)"`, "i");
      const match = html.match(regex);
      if (!match) {
        // Try reverse order
        const regex2 = new RegExp(`${attr}="([^"]+)"[^>]*class="[^"]*${className}[^"]*"`, "i");
        const match2 = html.match(regex2);
        return match2 ? match2[1] : "";
      }
      return match[1];
    }
  }

  private extractJobId(url: string): string {
    if (!url) return "";
    const match = url.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : url;
  }

  private cleanTextContent(text: string): string {
    return text
      .replace(/\s+/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .trim();
  }
}
