import { BaseScraper, type ScrapeRequestOptions, type ScrapeResult, type ScraperConfig } from "./baseScraper";
import { getLocationPreferenceFit } from "../../shared/locationEligibility";
import { normalizeSalary } from "../jobNormalization";

/**
 * Generic scraper that can be configured for different platforms
 * Uses common patterns for RSS feeds and HTML scraping
 */
export class GenericScraper extends BaseScraper {
  private scraperType: "rss" | "html" | "api";
  private feedUrl?: string;
  private apiUrl?: string;
  private selectors: {
    jobCard?: string;
    title?: string;
    company?: string;
    location?: string;
    link?: string;
    description?: string;
  };

  constructor(
    config: ScraperConfig & {
      type: "rss" | "html" | "api";
      feedUrl?: string;
      apiUrl?: string;
      selectors?: {
        jobCard?: string;
        title?: string;
        company?: string;
        location?: string;
        link?: string;
        description?: string;
      };
    }
  ) {
    super(config);
    this.scraperType = config.type;
    this.feedUrl = config.feedUrl;
    this.apiUrl = config.apiUrl;
    this.selectors = config.selectors || {};
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    switch (this.scraperType) {
      case "rss":
        return this.scrapeRSS(options);
      case "api":
        return this.scrapeAPI(options);
      case "html":
      default:
        return this.scrapeHTML(options);
    }
  }

  private async scrapeRSS(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting RSS scrape...");
      await this.rateLimit(options?.signal);

      const url = this.feedUrl || `${this.config.baseUrl}/feed/`;

      const response = await this.retry(async () => {
        const res = await fetch(url, {
          signal: options?.signal,
          headers: {
            "User-Agent": "Hire.AI Job Aggregator",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
          },
        });

        this.assertResponseOk(res);

        return this.readResponseText(res);
      }, { signal: options?.signal });

      const parsedJobs = this.parseRSS(response);

      for (const rawJob of parsedJobs) {
        const normalizedJob = this.normalizeJob(rawJob);
        if (!this.matchesRequestedOptions(normalizedJob, options)) continue;
        jobs.push(normalizedJob);

        if (options?.limit && jobs.length >= options.limit) {
          break;
        }
      }

      this.log(`Successfully scraped ${jobs.length} jobs`);
    } catch (error) {
      const errorMsg = `RSS scraping failed: ${error}`;
      this.log(errorMsg, "error");
      errors.push(errorMsg);
    }

    return { jobs, errors, scrapedAt: new Date() };
  }

  private async scrapeAPI(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting API scrape...");
      await this.rateLimit(options?.signal);

      const url = this.buildApiUrl(options);

      const response = await this.retry(async () => {
        const res = await fetch(url, {
          signal: options?.signal,
          headers: {
            "User-Agent": "Hire.AI Job Aggregator",
            "Accept": "application/json",
          },
        });

        this.assertResponseOk(res);

        return this.readResponseJson<any>(res);
      }, { signal: options?.signal });

      const rawJobs = Array.isArray(response) ? response : response.jobs || response.data || [];

      for (const rawJob of rawJobs) {
        const salary = this.normalizeApiSalary(rawJob);
        const normalizedJob = this.normalizeJob({
          title: rawJob.title || rawJob.name,
          company: rawJob.company || rawJob.company_name || rawJob.employer,
          location: rawJob.location || "Remote",
          description: rawJob.description || rawJob.content,
          requirements: rawJob.requirements || rawJob.qualifications,
          responsibilities: rawJob.responsibilities || rawJob.duties,
          skills: Array.isArray(rawJob.skills) ? rawJob.skills.join(", ") : rawJob.skills || rawJob.tags,
          jobType: rawJob.jobType || rawJob.job_type || rawJob.employmentType || rawJob.employment_type,
          salaryMin: salary.min,
          salaryMax: salary.max,
          salaryCurrency: salary.currency,
          applicationUrl: rawJob.url || rawJob.link || rawJob.apply_url,
          externalId: rawJob.id?.toString() || rawJob.slug,
          postedDate: rawJob.date || rawJob.published_at || rawJob.created_at,
        });

        if (!this.matchesRequestedOptions(normalizedJob, options)) continue;
        jobs.push(normalizedJob);

        if (options?.limit && jobs.length >= options.limit) {
          break;
        }
      }

      this.log(`Successfully scraped ${jobs.length} jobs`);
    } catch (error) {
      const errorMsg = `API scraping failed: ${error}`;
      this.log(errorMsg, "error");
      errors.push(errorMsg);
    }

    return { jobs, errors, scrapedAt: new Date() };
  }

  private async scrapeHTML(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const errors: string[] = [];
    const jobs: any[] = [];

    try {
      this.log("Starting HTML scrape...");
      await this.rateLimit(options?.signal);

      const response = await this.retry(async () => {
        const res = await fetch(this.config.baseUrl, {
          signal: options?.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        this.assertResponseOk(res);

        return this.readResponseText(res);
      }, { signal: options?.signal });

      // Generic HTML parsing - looks for common job listing patterns
      const parsedJobs = this.parseHTML(response);

      for (const rawJob of parsedJobs) {
        const normalizedJob = this.normalizeJob(rawJob);
        if (!this.matchesRequestedOptions(normalizedJob, options)) continue;
        jobs.push(normalizedJob);

        if (options?.limit && jobs.length >= options.limit) {
          break;
        }
      }

      this.log(`Successfully scraped ${jobs.length} jobs`);
    } catch (error) {
      const errorMsg = `HTML scraping failed: ${error}`;
      this.log(errorMsg, "error");
      errors.push(errorMsg);
    }

    return { jobs, errors, scrapedAt: new Date() };
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

      // Try to extract company from title
      let company = `Company via ${this.config.platformName}`;
      let jobTitle = title;
      
      if (title.includes(" at ")) {
        const parts = title.split(" at ");
        jobTitle = parts[0].trim();
        company = parts.slice(1).join(" at ").trim();
      } else if (title.includes(" - ")) {
        const parts = title.split(" - ");
        if (parts.length >= 2) {
          jobTitle = parts[0].trim();
          company = parts[1].trim();
        }
      }

      const applicationUrl = this.absoluteUrl(link);
      if (!jobTitle || !applicationUrl) continue;

      jobs.push({
        title: jobTitle,
        company,
        location: "Remote",
        description: this.cleanHtml(description),
        applicationUrl,
        externalId: guid || link,
        postedDate: pubDate ? new Date(pubDate) : undefined,
      });
    }

    return jobs;
  }

  private parseHTML(html: string): any[] {
    const structuredJobs = this.parseJsonLdJobPostings(html);
    if (structuredJobs.length > 0) return structuredJobs;

    const jobs: any[] = [];

    // Try common job card patterns
    const patterns = [
      /<article[^>]*class="[^"]*job[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
      /<div[^>]*class="[^"]*job-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
      /<li[^>]*class="[^"]*job[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
      /<a[^>]*class="[^"]*job[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const content = match[1] || match[2] || "";
        const link = match[1]?.startsWith("http") ? match[1] : this.extractLink(content);

        const title = this.extractFromHtml(content, ["h2", "h3", "title", "job-title"]);
        const company = this.extractFromHtml(content, ["company", "employer", "organization"]);

        const applicationUrl = this.absoluteUrl(link);
        if (title && applicationUrl) {
          jobs.push({
            title: this.cleanHtml(title),
            company: company ? this.cleanHtml(company) : `Company via ${this.config.platformName}`,
            location: "Remote",
            applicationUrl,
            externalId: link,
          });
        }
      }

      if (jobs.length > 0) break;
    }

    return jobs;
  }

  private parseJsonLdJobPostings(html: string): any[] {
    const scripts = Array.from(html.matchAll(
      /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ));
    const jobs: any[] = [];

    for (const script of scripts) {
      try {
        const queue: unknown[] = [JSON.parse(script[1])];
        while (queue.length > 0) {
          const current = queue.shift();
          if (Array.isArray(current)) {
            queue.push(...current);
            continue;
          }
          if (!current || typeof current !== "object") continue;

          const record = current as Record<string, unknown>;
          const types = Array.isArray(record["@type"])
            ? record["@type"]
            : [record["@type"]];
          if (types.some((type) => type === "JobPosting")) {
            const job = this.toJsonLdJobPosting(record);
            if (job) jobs.push(job);
          }

          for (const value of Object.values(record)) {
            if (value && typeof value === "object") queue.push(value);
          }
        }
      } catch {
        // Ignore malformed structured data and continue with other scripts or HTML heuristics.
      }
    }

    return jobs;
  }

  private toJsonLdJobPosting(record: Record<string, unknown>) {
    const title = this.stringValue(record.title);
    const applicationUrl = this.absoluteUrl(this.stringValue(record.url));
    if (!title || !applicationUrl) return null;

    const organization = this.recordValue(record.hiringOrganization);
    const identifier = this.recordValue(record.identifier);
    const salary = this.recordValue(record.baseSalary);
    const salaryValue = this.recordValue(salary?.value);
    const normalizedSalary = this.normalizeJsonLdSalary(salary, salaryValue);

    return {
      title,
      company: this.stringValue(organization?.name) || `Company via ${this.config.platformName}`,
      location: this.jsonLdLocation(record),
      description: this.cleanHtml(this.stringValue(record.description) || ""),
      applicationUrl,
      externalId: this.stringValue(identifier?.value) || this.stringValue(record.identifier) || applicationUrl,
      postedDate: this.stringValue(record.datePosted),
      expiryDate: this.stringValue(record.validThrough),
      jobType: this.jsonLdEmploymentType(record.employmentType),
      salaryMin: normalizedSalary.min,
      salaryMax: normalizedSalary.max,
      salaryCurrency: normalizedSalary.currency,
    };
  }

  private jsonLdLocation(record: Record<string, unknown>) {
    if (this.stringValue(record.jobLocationType)?.toUpperCase() === "TELECOMMUTE") return "Remote";

    const locations = Array.isArray(record.jobLocation) ? record.jobLocation : [record.jobLocation];
    const parts = locations.flatMap((location) => {
      const address = this.recordValue(this.recordValue(location)?.address);
      return [
        this.stringValue(address?.addressLocality),
        this.stringValue(address?.addressRegion),
        this.stringValue(address?.addressCountry),
      ].filter((part): part is string => Boolean(part));
    });
    if (parts.length > 0) return Array.from(new Set(parts)).join(", ");

    return "Remote";
  }

  private jsonLdEmploymentType(value: unknown) {
    const employmentType = Array.isArray(value) ? value[0] : value;
    return this.stringValue(employmentType)?.replace(/_/g, "-");
  }

  private buildApiUrl(options?: { keywords?: string; location?: string }) {
    const url = new URL(this.apiUrl || this.config.baseUrl);
    if (options?.keywords?.trim()) url.searchParams.set("q", options.keywords.trim());
    if (options?.location?.trim()) url.searchParams.set("location", options.location.trim());
    return url.toString();
  }

  private matchesRequestedOptions(
    job: { title?: string | null; company?: string | null; description?: string | null; location?: string | null },
    options?: { keywords?: string; location?: string }
  ) {
    const keywords = options?.keywords?.trim().toLowerCase();
    if (keywords) {
      const searchable = [job.title, job.company, job.description]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase();
      if (!searchable.includes(keywords)) return false;
    }

    // A generic remote listing without jurisdiction is still reviewable, but
    // a source that explicitly conflicts with the requested geography is not.
    if (options?.location?.trim() && getLocationPreferenceFit(job.location, options.location) === "gap") {
      return false;
    }

    return true;
  }

  private absoluteUrl(value?: string) {
    if (!value) return undefined;
    try {
      const url = new URL(value, this.config.baseUrl);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  private recordValue(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }

  private stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private normalizeJsonLdSalary(
    salary?: Record<string, unknown>,
    salaryValue?: Record<string, unknown>
  ) {
    const min = salaryValue?.minValue ?? salaryValue?.value;
    const max = salaryValue?.maxValue ?? salaryValue?.value;
    const currency = this.stringValue(salary?.currency);
    const unit = this.stringValue(salaryValue?.unitText) || this.stringValue(salary?.unitText);
    const values = [min, max]
      .filter((value) => typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))
      .map(String);

    if (values.length === 0) {
      return { min: undefined, max: undefined, currency };
    }

    const normalized = normalizeSalary([...values, currency, unit].filter(Boolean).join(" - "));
    return {
      min: normalized.normalizedYearly.min ?? undefined,
      max: normalized.normalizedYearly.max ?? undefined,
      currency: normalized.currency,
    };
  }

  private normalizeApiSalary(rawJob: Record<string, unknown>) {
    const min = this.scalarValue(rawJob.salaryMin ?? rawJob.salary_min ?? rawJob.minSalary ?? rawJob.min_salary);
    const max = this.scalarValue(rawJob.salaryMax ?? rawJob.salary_max ?? rawJob.maxSalary ?? rawJob.max_salary);
    const range = this.scalarValue(rawJob.salary ?? rawJob.salaryRange ?? rawJob.salary_range ?? rawJob.compensation);
    const currency = this.stringValue(rawJob.salaryCurrency ?? rawJob.salary_currency ?? rawJob.currency);
    const period = this.stringValue(rawJob.salaryPeriod ?? rawJob.salary_period ?? rawJob.payPeriod ?? rawJob.pay_period);
    const values = [min, max].filter((value): value is string => Boolean(value));
    const salaryText = [...(values.length > 0 ? values : [range]), currency, period]
      .filter((value): value is string => Boolean(value))
      .join(" - ");

    if (!salaryText) {
      return { min: undefined, max: undefined, currency: undefined };
    }

    const normalized = normalizeSalary(salaryText);
    return {
      min: normalized.normalizedYearly.min ?? undefined,
      max: normalized.normalizedYearly.max ?? undefined,
      currency: normalized.currency,
    };
  }

  private scalarValue(value: unknown) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return undefined;
  }

  private extractTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = xml.match(regex);
    return match ? (match[1] || match[2] || "").trim() : "";
  }

  private extractLink(html: string): string {
    const match = html.match(/href="([^"]+)"/);
    return match ? match[1] : "";
  }

  private extractFromHtml(html: string, classNames: string[]): string {
    for (const className of classNames) {
      const regex = new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([^<]+)`, "i");
      const match = html.match(regex);
      if (match) return match[1].trim();

      const tagRegex = new RegExp(`<${className}[^>]*>([^<]+)<\/${className}>`, "i");
      const tagMatch = html.match(tagRegex);
      if (tagMatch) return tagMatch[1].trim();
    }
    return "";
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
