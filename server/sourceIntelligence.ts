import {
  getPlatformDiscoveryPolicy,
  scraperPlatformCatalog,
} from "./scrapers/platformCatalog";
import {
  getSourceGeography,
  type SourceRegion,
} from "./scrapers/regionalPlatforms";
import { hasScraper } from "./scrapers/index";

export const COMPARISON_FIELDS = [
  "title",
  "company",
  "location",
  "jobType",
  "salaryCurrency",
  "salaryMin",
  "salaryMax",
] as const;
type Comparable = Partial<
  Record<(typeof COMPARISON_FIELDS)[number], string | number | null>
>;
const normalized = (value: string | number | null | undefined) =>
  value == null || value === ""
    ? null
    : String(value).trim().replace(/\s+/g, " ").toLowerCase() || null;

export function compareSourceRecords(
  primary: Comparable,
  duplicate: Comparable
) {
  const differences: Array<{
    field: (typeof COMPARISON_FIELDS)[number];
    primary: string | number;
    duplicate: string | number;
  }> = [];
  const missingFields: Array<(typeof COMPARISON_FIELDS)[number]> = [];
  for (const field of COMPARISON_FIELDS) {
    const left = normalized(primary[field]),
      right = normalized(duplicate[field]);
    if (left === null || right === null) {
      missingFields.push(field);
      continue;
    }
    if (
      (field === "salaryMin" || field === "salaryMax") &&
      (!normalized(primary.salaryCurrency) ||
        normalized(primary.salaryCurrency) !==
          normalized(duplicate.salaryCurrency))
    )
      continue;
    if (left !== right)
      differences.push({
        field,
        primary: primary[field]!,
        duplicate: duplicate[field]!,
      });
  }
  return { differences, missingFields };
}

type Platform = {
  id: number;
  name: string;
  url: string;
  isActive: number;
  lastScraped?: Date | null;
  lastScrapeAttemptedAt?: Date | null;
  lastScrapeStatus?: string | null;
  lastScrapeJobCount?: number | null;
  category?: string | null;
};
export type SourceCounts = {
  platformId: number;
  listingCount: number;
  duplicateCount: number;
};
export type DirectoryInput = {
  query?: string;
  region?: SourceRegion;
  country?: string;
  language?: string;
  mode?: string;
  state?: string;
  limit: number;
  offset: number;
};

export function buildSourceDirectory(
  platforms: Platform[],
  counts: SourceCounts[],
  input: DirectoryInput
) {
  const stored = new Map(platforms.map(platform => [platform.name, platform]));
  const totals = new Map(counts.map(row => [row.platformId, row]));
  const seeds = [
    ...scraperPlatformCatalog,
    ...platforms.filter(
      platform =>
        !scraperPlatformCatalog.some(seed => seed.name === platform.name)
    ),
  ];
  const all = seeds.map(seed => {
    const platform = stored.get(seed.name);
    const policy = getPlatformDiscoveryPolicy(seed.name);
    const adapterAvailable = hasScraper(seed.name);
    const state =
      policy.mode === "unavailable"
        ? "unavailable"
        : policy.mode !== "automated" || !adapterAvailable
          ? "not_connected"
          : !platform
            ? "not_initialized"
            : platform.isActive !== 1
              ? "paused"
              : (platform.lastScrapeStatus ?? "never_run");
    const count = platform ? totals.get(platform.id) : undefined;
    return {
      name: seed.name,
      url: seed.url,
      id: platform?.id ?? null,
      category: seed.category ?? "General",
      ...getSourceGeography(seed.name),
      policy,
      adapterAvailable,
      state,
      lastScraped: platform?.lastScraped ?? null,
      lastAttemptedAt: platform?.lastScrapeAttemptedAt ?? null,
      lastScrapeJobCount: platform?.lastScrapeJobCount ?? null,
      listingCount: Number(count?.listingCount ?? 0),
      duplicateCount: Number(count?.duplicateCount ?? 0),
    };
  });
  const query = input.query?.trim().toLowerCase();
  const filtered = all
    .filter(
      item =>
        (!query ||
          `${item.name} ${item.category} ${item.policy.aliases?.join(" ") ?? ""}`
            .toLowerCase()
            .includes(query)) &&
        (!input.region || item.region === input.region) &&
        (!input.country ||
          item.countries.includes(input.country.toUpperCase())) &&
        (!input.language || item.languages.includes(input.language)) &&
        (!input.mode || item.policy.mode === input.mode) &&
        (!input.state || item.state === input.state)
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    items: filtered.slice(input.offset, input.offset + input.limit),
    total: filtered.length,
    hasMore: input.offset + input.limit < filtered.length,
    coverageComplete: false as const,
    summary: {
      total: all.length,
      automated: all.filter(
        item => item.policy.mode === "automated" && item.adapterAvailable
      ).length,
      scanned: all.filter(item => item.lastAttemptedAt !== null).length,
      listedCountries: new Set(all.flatMap(item => item.countries)).size,
    },
    countries: Array.from(new Set(all.flatMap(item => item.countries))).sort(),
    languages: Array.from(new Set(all.flatMap(item => item.languages))).sort(),
  };
}
