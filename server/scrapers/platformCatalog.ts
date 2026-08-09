export type ScraperPlatformSeed = {
  name: string;
  url: string;
  tier: "tier1" | "tier2" | "tier3" | "tier4";
  category: string;
};

export type PlatformDiscoveryMode = "automated" | "manual" | "alias" | "unavailable";

export interface PlatformDiscoveryPolicy {
  mode: PlatformDiscoveryMode;
  sourceType: "job_board" | "aggregator" | "marketplace";
  reason: string;
  aliases?: readonly string[];
  minimumPollIntervalMs?: number;
}

/**
 * Persistent source metadata for every adapter in the scraper registry.
 * Adding this catalog never starts a scrape; it only gives supported adapters
 * a durable platform identity for provenance, scheduling, and deduplication.
 */
export const scraperPlatformCatalog = [
  { name: "RemoteOK", url: "https://remoteok.com/", tier: "tier1", category: "General" },
  { name: "We Work Remotely", url: "https://weworkremotely.com/", tier: "tier1", category: "General" },
  { name: "FlexJobs", url: "https://www.flexjobs.com/", tier: "tier1", category: "General" },
  { name: "Indeed", url: "https://www.indeed.com/", tier: "tier1", category: "General" },
  { name: "LinkedIn Jobs", url: "https://www.linkedin.com/jobs/", tier: "tier1", category: "General" },
  { name: "Remote.co", url: "https://remote.co/", tier: "tier1", category: "General" },
  { name: "Remotive", url: "https://remotive.com/", tier: "tier2", category: "General" },
  { name: "Jobicy", url: "https://jobicy.com/jobs", tier: "tier2", category: "General" },
  { name: "Arbeitnow", url: "https://www.arbeitnow.com/", tier: "tier2", category: "Regional" },
  { name: "JustRemote", url: "https://justremote.co/", tier: "tier2", category: "General" },
  { name: "Jobspresso", url: "https://jobspresso.co/", tier: "tier2", category: "General" },
  { name: "Working Nomads", url: "https://www.workingnomads.com/jobs", tier: "tier2", category: "General" },
  { name: "NoDesk", url: "https://nodesk.co/", tier: "tier2", category: "General" },
  { name: "Pangian", url: "https://pangian.com/", tier: "tier2", category: "General" },
  { name: "Virtual Vocations", url: "https://www.virtualvocations.com/", tier: "tier2", category: "General" },
  { name: "Skip The Drive", url: "https://www.skipthedrive.com/", tier: "tier2", category: "General" },
  { name: "Arc", url: "https://arc.dev/", tier: "tier3", category: "Tech" },
  { name: "Gun.io", url: "https://gun.io/", tier: "tier3", category: "Tech" },
  { name: "Stack Overflow Jobs", url: "https://stackoverflow.com/jobs", tier: "tier3", category: "Tech" },
  { name: "Behance", url: "https://www.behance.net/joblist", tier: "tier3", category: "Creative" },
  { name: "Dribbble", url: "https://dribbble.com/jobs", tier: "tier3", category: "Creative" },
  { name: "Creativepool", url: "https://creativepool.com/jobs", tier: "tier3", category: "Creative" },
  { name: "ProBlogger", url: "https://problogger.com/jobs", tier: "tier3", category: "Writing" },
  { name: "Built In", url: "https://builtin.com/jobs/remote", tier: "tier3", category: "Tech" },
  { name: "Crossover", url: "https://www.crossover.com/jobs", tier: "tier3", category: "Tech" },
  { name: "Wellfound", url: "https://wellfound.com/jobs", tier: "tier3", category: "Startup" },
  { name: "Remote100K", url: "https://remote100k.com/", tier: "tier4", category: "General" },
  { name: "Jobgether", url: "https://jobgether.com/", tier: "tier4", category: "General" },
  { name: "Contra", url: "https://contra.com/jobs", tier: "tier4", category: "Contract" },
  { name: "Snaphunt", url: "https://snaphunt.com/job-listing", tier: "tier4", category: "General" },
  { name: "Remote.com", url: "https://remote.com/jobs", tier: "tier4", category: "General" },
  { name: "HiringCafe", url: "https://hiring.cafe/", tier: "tier4", category: "General" },
  { name: "DailyRemote", url: "https://dailyremote.com/", tier: "tier4", category: "General" },
  { name: "Outsourcely", url: "https://www.outsourcely.com/remote-jobs", tier: "tier4", category: "Contract" },
  { name: "JobRack", url: "https://jobrack.eu/", tier: "tier4", category: "General" },
  { name: "The Muse", url: "https://www.themuse.com/jobs", tier: "tier4", category: "General" },
  { name: "Workster", url: "https://workster.com/", tier: "tier4", category: "General" },
  { name: "Workew", url: "https://workew.com/", tier: "tier4", category: "General" },
  { name: "Remoters", url: "https://remoters.net/jobs", tier: "tier4", category: "General" },
  { name: "Still Hiring Today", url: "https://stillhiring.today/", tier: "tier4", category: "General" },
  { name: "PowerToFly", url: "https://powertofly.com/jobs", tier: "tier4", category: "Diversity" },
  { name: "Dynamite Jobs", url: "https://dynamitejobs.com/", tier: "tier4", category: "General" },
  { name: "Citizen Remote", url: "https://citizenremote.com/", tier: "tier4", category: "General" },
  { name: "EU Remote Jobs", url: "https://euremotejobs.com/", tier: "tier4", category: "Regional" },
  { name: "Inclusively Remote", url: "https://inclusively.com/jobs", tier: "tier4", category: "Diversity" },
  { name: "Remote Nomad Jobs", url: "https://remotenomadjobs.com/", tier: "tier4", category: "General" },
  { name: "Open To Work Remote", url: "https://opentoworkremote.com/", tier: "tier4", category: "General" },
  { name: "Remote Healthcare Jobs", url: "https://remotehealthcarejobs.com/", tier: "tier4", category: "Healthcare" },
  { name: "SEO Jobs", url: "https://seojobs.com/", tier: "tier4", category: "Marketing" },
  { name: "Dice", url: "https://www.dice.com/jobs", tier: "tier4", category: "Tech" },
  { name: "OwlApply", url: "https://owlapply.com/", tier: "tier4", category: "General" },
  { name: "Hubstaff Talent", url: "https://talent.hubstaff.com/", tier: "tier4", category: "Contract" },
  { name: "Upwork", url: "https://www.upwork.com/", tier: "tier4", category: "Contract" },
  { name: "Fiverr", url: "https://www.fiverr.com/", tier: "tier4", category: "Contract" },
  { name: "Freelancer.com", url: "https://www.freelancer.com/", tier: "tier4", category: "Contract" },
  { name: "Toptal", url: "https://www.toptal.com/", tier: "tier4", category: "Contract" },
  { name: "Guru", url: "https://www.guru.com/", tier: "tier4", category: "Contract" },
  { name: "PeoplePerHour", url: "https://www.peopleperhour.com/", tier: "tier4", category: "Contract" },
  { name: "Glassdoor", url: "https://www.glassdoor.com/Job/", tier: "tier4", category: "General" },
  { name: "Monster", url: "https://www.monster.com/jobs/", tier: "tier4", category: "General" },
  { name: "CareerBuilder", url: "https://www.careerbuilder.com/jobs", tier: "tier4", category: "General" },
  { name: "ZipRecruiter", url: "https://www.ziprecruiter.com/Jobs", tier: "tier4", category: "General" },
] satisfies readonly ScraperPlatformSeed[];

const automatedFeedPolicies: Record<string, PlatformDiscoveryPolicy> = {
  RemoteOK: {
    mode: "automated",
    sourceType: "aggregator",
    reason: "Public job API adapter.",
  },
  Remotive: {
    mode: "automated",
    sourceType: "aggregator",
    reason: "Public job API adapter.",
  },
  Jobicy: {
    mode: "automated",
    sourceType: "aggregator",
    reason: "Documented public remote-jobs API; provider terms limit polling to no more than hourly.",
    minimumPollIntervalMs: 60 * 60 * 1000,
  },
  Arbeitnow: {
    mode: "automated",
    sourceType: "aggregator",
    reason: "Documented no-key API; remote records are filtered explicitly and provider backlinks are preserved.",
    minimumPollIntervalMs: 60 * 60 * 1000,
  },
  "We Work Remotely": {
    mode: "automated",
    sourceType: "job_board",
    reason: "Public RSS category feeds adapter.",
  },
  NoDesk: {
    mode: "automated",
    sourceType: "aggregator",
    reason: "Public RSS feed adapter.",
  },
  ProBlogger: {
    mode: "automated",
    sourceType: "job_board",
    reason: "Public RSS feed adapter.",
  },
};

export function getPlatformMinimumPollIntervalMs(platformName: string) {
  return getPlatformDiscoveryPolicy(platformName).minimumPollIntervalMs ?? 0;
}

const explicitPolicies: Record<string, PlatformDiscoveryPolicy> = {
  "Stack Overflow Jobs": {
    mode: "unavailable",
    sourceType: "job_board",
    reason: "This legacy job board is discontinued and cannot be scanned.",
  },
  Wellfound: {
    mode: "manual",
    sourceType: "job_board",
    reason: "Account-mediated discovery requires an approved integration before collection.",
    aliases: ["AngelList", "AngelList Talent"],
  },
  "LinkedIn Jobs": {
    mode: "manual",
    sourceType: "aggregator",
    reason: "Account-mediated discovery requires an approved integration before collection.",
  },
  OwlApply: {
    mode: "manual",
    sourceType: "aggregator",
    reason: "Cataloged from the referenced source list; an approved ingestion contract is required before collection.",
  },
  "Hubstaff Talent": {
    mode: "manual",
    sourceType: "marketplace",
    reason: "Marketplace discovery and outreach require account-scoped authorization.",
  },
  Upwork: {
    mode: "manual",
    sourceType: "marketplace",
    reason: "Marketplace discovery and outreach require account-scoped authorization.",
  },
  Fiverr: {
    mode: "manual",
    sourceType: "marketplace",
    reason: "Marketplace discovery and outreach require account-scoped authorization.",
  },
  "Freelancer.com": {
    mode: "manual",
    sourceType: "marketplace",
    reason: "Marketplace discovery and outreach require account-scoped authorization.",
  },
  Toptal: {
    mode: "manual",
    sourceType: "marketplace",
    reason: "Marketplace discovery and outreach require account-scoped authorization.",
  },
  Guru: {
    mode: "manual",
    sourceType: "marketplace",
    reason: "Marketplace discovery and outreach require account-scoped authorization.",
  },
  PeoplePerHour: {
    mode: "manual",
    sourceType: "marketplace",
    reason: "Marketplace discovery and outreach require account-scoped authorization.",
  },
  Glassdoor: {
    mode: "manual",
    sourceType: "aggregator",
    reason: "Account-mediated discovery requires an approved integration before collection.",
  },
  Monster: {
    mode: "manual",
    sourceType: "aggregator",
    reason: "Account-mediated discovery requires an approved integration before collection.",
  },
  CareerBuilder: {
    mode: "manual",
    sourceType: "aggregator",
    reason: "Account-mediated discovery requires an approved integration before collection.",
  },
  ZipRecruiter: {
    mode: "manual",
    sourceType: "aggregator",
    reason: "Account-mediated discovery requires an approved integration before collection.",
  },
};

const defaultPolicy: PlatformDiscoveryPolicy = {
  mode: "manual",
  sourceType: "job_board",
  reason: "No public API or RSS ingestion contract is configured for this source.",
};

/**
 * Catalog inclusion means the platform is tracked. It does not grant
 * permission to scrape it. Only explicitly public API/RSS sources can run in
 * the unattended scheduler; account-mediated and marketplace sources remain
 * visible for future approved integrations.
 */
export function getPlatformDiscoveryPolicy(platformName: string): PlatformDiscoveryPolicy {
  return automatedFeedPolicies[platformName] ?? explicitPolicies[platformName] ?? defaultPolicy;
}

export function isAutomatedDiscoveryPlatform(platformName: string) {
  return getPlatformDiscoveryPolicy(platformName).mode === "automated";
}

export function isCatalogedPlatform(platformName: string) {
  return scraperPlatformCatalog.some((platform) => platform.name === platformName);
}

export const referencedRemoteJobPlatforms = [
  "OwlApply", "FlexJobs", "We Work Remotely", "Remote.co", "Virtual Vocations", "JustRemote",
  "RemoteOK", "Working Nomads", "Jobspresso", "Skip The Drive", "Remotive", "Pangian", "Arc",
  "Wellfound", "Hubstaff Talent", "Dribbble", "Upwork", "Fiverr", "Freelancer.com", "Toptal",
  "Guru", "PeoplePerHour", "LinkedIn Jobs", "Indeed", "Glassdoor", "Monster", "CareerBuilder",
  "ZipRecruiter", "AngelList", "Stack Overflow Jobs", "PowerToFly",
] as const;

export function getMissingReferencedRemoteJobPlatforms() {
  const coveredNames = new Set(scraperPlatformCatalog.flatMap((platform) => [
    platform.name,
    ...(getPlatformDiscoveryPolicy(platform.name).aliases ?? []),
  ]));
  return referencedRemoteJobPlatforms.filter((name) => !coveredNames.has(name));
}

export function getMissingScraperPlatformCatalog(configuredNames: Iterable<string>) {
  const configured = new Set(configuredNames);
  return scraperPlatformCatalog.filter((platform) => !configured.has(platform.name));
}
