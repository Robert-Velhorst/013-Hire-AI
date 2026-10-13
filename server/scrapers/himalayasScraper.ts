import {
  BaseScraper,
  type ScrapeRequestOptions,
  type ScrapeResult,
} from "./baseScraper";

const MAX_PAGES = 5;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const timestamp = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000)
    : text(value);

/** Bounded public API ingestion. Attribution stays on Himalayas, including the application link. */
export class HimalayasScraper extends BaseScraper {
  constructor(platformId: number) {
    super({
      platformName: "Himalayas",
      platformId,
      baseUrl: "https://himalayas.app/jobs/api",
      rateLimit: 1000,
      maxRetries: 2,
    });
  }

  async scrape(options?: ScrapeRequestOptions): Promise<ScrapeResult> {
    const jobs: ScrapeResult["jobs"] = [];
    const errors: string[] = [];
    const quota = Number.isFinite(options?.limit)
      ? Math.max(0, Math.min(100, Math.floor(options!.limit!)))
      : 100;
    if (quota === 0) return { jobs, errors, scrapedAt: new Date() };
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_PAGES && jobs.length < quota; page++) {
        await this.rateLimit(options?.signal);
        const url = new URL(this.config.baseUrl);
        url.searchParams.set(
          "limit",
          String(Math.min(20, quota - jobs.length))
        );
        if (cursor) url.searchParams.set("cursor", cursor);
        const payload = await this.retry(
          async () => {
            const response = await this.fetchSource(url, {
              signal: options?.signal,
              headers: { "User-Agent": "Hire.AI Job Aggregator" },
            });
            this.assertResponseOk(response);
            return this.readResponseJson<{
              jobs?: unknown;
              nextCursor?: unknown;
            }>(response);
          },
          { signal: options?.signal }
        );
        if (!payload || !Array.isArray(payload.jobs))
          throw new Error("Invalid feed envelope");
        for (const record of payload.jobs) {
          if (jobs.length >= quota) break;
          try {
            if (!record || typeof record !== "object")
              throw new Error("Invalid record");
            const raw = record as Record<string, unknown>;
            const title = text(raw.title),
              company = text(raw.companyName),
              guid = text(raw.guid);
            if (!title.trim() || !company.trim() || !guid)
              throw new Error("Missing identity");
            const backlink = new URL(guid);
            if (
              backlink.protocol !== "https:" ||
              backlink.hostname !== "himalayas.app" ||
              backlink.username ||
              backlink.password ||
              backlink.port
            )
              throw new Error("Invalid source link");
            if (seenIds.has(guid)) continue;
            seenIds.add(guid);
            const countries = strings(raw.locationRestrictions);
            const zones = Array.isArray(
              raw.timezoneRestrictions ?? raw.timezoneRestriction
            )
              ? ((raw.timezoneRestrictions ??
                  raw.timezoneRestriction) as unknown[])
              : [];
            const timezones = zones.filter(
              (value): value is number =>
                typeof value === "number" &&
                Number.isFinite(value) &&
                value >= -12 &&
                value <= 14
            );
            const location = countries.length
              ? `Remote - ${countries.join(", ")}`
              : "Remote - location unspecified";
            if (
              options?.location?.trim() &&
              !location
                .toLowerCase()
                .includes(options.location.trim().toLowerCase())
            )
              continue;
            const categories = strings(raw.categories ?? raw.category);
            if (
              options?.keywords?.trim() &&
              !`${title} ${company} ${categories.join(" ")} ${text(raw.description)}`
                .toLowerCase()
                .includes(options.keywords.trim().toLowerCase())
            )
              continue;
            const annual =
              !raw.salaryPeriod ||
              ["annual", "yearly", "annually"].includes(
                text(raw.salaryPeriod).toLowerCase()
              );
            const amount = (value: unknown) =>
              annual &&
              typeof value === "number" &&
              Number.isFinite(value) &&
              value >= 0 &&
              value <= 2147483647
                ? Math.round(value)
                : undefined;
            const currency = /^[a-z]{3}$/i.test(text(raw.currency))
              ? text(raw.currency).toUpperCase()
              : null;
            jobs.push({
              ...this.normalizeJob({
                title,
                company,
                externalId: guid,
                location,
                description: text(raw.description) || text(raw.excerpt),
                requirements: timezones.length
                  ? `Timezone restrictions: ${timezones.map(zone => `UTC${zone >= 0 ? "+" : ""}${zone}`).join(", ")}`
                  : undefined,
                skills: categories.join(", "),
                jobType: raw.employmentType,
                applicationUrl: backlink.href,
                postedDate: timestamp(raw.pubDate),
                expiryDate: timestamp(raw.expiryDate),
                salaryMin: amount(raw.minSalary),
                salaryMax: amount(raw.maxSalary),
                salaryCurrency: currency,
              }),
              sourceUrl: this.cleanText(backlink.href, 1000),
              salaryCurrency: currency,
            });
          } catch {
            errors.push("One Himalayas listing could not be normalized.");
          }
        }
        if (payload.nextCursor == null || payload.nextCursor === "") break;
        if (
          typeof payload.nextCursor !== "string" ||
          payload.nextCursor.length > 2000 ||
          seenCursors.has(payload.nextCursor)
        )
          throw new Error("Invalid cursor");
        cursor = payload.nextCursor;
        seenCursors.add(cursor);
      }
    } catch {
      errors.push("Himalayas request could not complete.");
    }
    return { jobs, errors: Array.from(new Set(errors)), scrapedAt: new Date() };
  }
}
