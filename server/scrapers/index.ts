/**
 * Scraper Registry
 * Central registry for all job platform scrapers
 */

import { BaseScraper } from "./baseScraper";
import { RemoteOKScraper } from "./remoteokScraper";
import { WeWorkRemotelyScraper } from "./weworkremotelyScraper";
import { RemotiveScraper } from "./remotiveScraper";
import { FlexJobsScraper } from "./flexjobsScraper";
import { IndeedScraper } from "./indeedScraper";
import { LinkedInScraper } from "./linkedinScraper";
import { RemoteCoScraper } from "./remotecoScraper";
import { JustRemoteScraper } from "./justremoteScraper";
import { JobspressoScraper } from "./jobspressoScraper";
import { WorkingNomadsScraper } from "./workingnomadsScraper";
import { GenericScraper } from "./genericScraper";
import { JobicyScraper } from "./jobicyScraper";
import { ArbeitnowScraper } from "./arbeitnowScraper";

// Export all scrapers
export {
  BaseScraper,
  RemoteOKScraper,
  WeWorkRemotelyScraper,
  RemotiveScraper,
  FlexJobsScraper,
  IndeedScraper,
  LinkedInScraper,
  RemoteCoScraper,
  JustRemoteScraper,
  JobspressoScraper,
  WorkingNomadsScraper,
  GenericScraper,
  JobicyScraper,
  ArbeitnowScraper,
};

// Platform to scraper mapping
export type ScraperFactory = (platformId: number) => BaseScraper;
export type ScraperAdapterKind = "dedicated" | "generic_rss" | "generic_html";

export interface ScraperAdapterMetadata {
  kind: ScraperAdapterKind;
  label: string;
  detail: string;
}

const dedicatedAdapterPlatforms = new Set([
  "RemoteOK",
  "We Work Remotely",
  "FlexJobs",
  "Indeed",
  "LinkedIn Jobs",
  "Remote.co",
  "Remotive",
  "JustRemote",
  "Jobspresso",
  "Working Nomads",
  "Jobicy",
  "Arbeitnow",
]);

const genericRssAdapterPlatforms = new Set(["NoDesk", "ProBlogger"]);

const scraperAdapterMetadata: Record<ScraperAdapterKind, ScraperAdapterMetadata> = {
  dedicated: {
    kind: "dedicated",
    label: "Source-specific adapter",
    detail: "Uses a source-specific parser. Current source health still determines availability.",
  },
  generic_rss: {
    kind: "generic_rss",
    label: "Generic RSS adapter",
    detail: "Uses generic RSS extraction. Review source health and output before relying on coverage.",
  },
  generic_html: {
    kind: "generic_html",
    label: "Generic HTML adapter",
    detail: "Uses generic HTML extraction. Review source health and output before relying on coverage.",
  },
};

/**
 * Registry of all available scrapers
 * Maps platform names to their scraper factory functions
 */
export const scraperRegistry: Record<string, ScraperFactory> = {
  // Tier 1 - Major Platforms
  "RemoteOK": (id) => new RemoteOKScraper(id),
  "We Work Remotely": (id) => new WeWorkRemotelyScraper(id),
  "FlexJobs": (id) => new FlexJobsScraper(id),
  "Indeed": (id) => new IndeedScraper(id),
  "LinkedIn Jobs": (id) => new LinkedInScraper(id),
  "Remote.co": (id) => new RemoteCoScraper(id),

  // Tier 2 - Popular Remote Job Boards
  "Remotive": (id) => new RemotiveScraper(id),
  "Jobicy": (id) => new JobicyScraper(id),
  "Arbeitnow": (id) => new ArbeitnowScraper(id),
  "JustRemote": (id) => new JustRemoteScraper(id),
  "Jobspresso": (id) => new JobspressoScraper(id),
  "Working Nomads": (id) => new WorkingNomadsScraper(id),
  
  // Tier 2 continued - Using Generic Scraper with RSS
  "NoDesk": (id) => new GenericScraper({
    platformName: "NoDesk",
    platformId: id,
    baseUrl: "https://nodesk.co",
    rateLimit: 2000,
    maxRetries: 3,
    type: "rss",
    feedUrl: "https://nodesk.co/remote-jobs/feed/",
  }),
  "Pangian": (id) => new GenericScraper({
    platformName: "Pangian",
    platformId: id,
    baseUrl: "https://pangian.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Virtual Vocations": (id) => new GenericScraper({
    platformName: "Virtual Vocations",
    platformId: id,
    baseUrl: "https://www.virtualvocations.com",
    rateLimit: 3000,
    maxRetries: 3,
    type: "html",
  }),
  "Skip The Drive": (id) => new GenericScraper({
    platformName: "Skip The Drive",
    platformId: id,
    baseUrl: "https://www.skipthedrive.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),

  // Tier 3 - Industry Specific
  "Arc": (id) => new GenericScraper({
    platformName: "Arc",
    platformId: id,
    baseUrl: "https://arc.dev",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Gun.io": (id) => new GenericScraper({
    platformName: "Gun.io",
    platformId: id,
    baseUrl: "https://gun.io",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Stack Overflow Jobs": (id) => new GenericScraper({
    platformName: "Stack Overflow Jobs",
    platformId: id,
    baseUrl: "https://stackoverflow.com/jobs",
    rateLimit: 3000,
    maxRetries: 3,
    type: "html",
  }),
  "Behance": (id) => new GenericScraper({
    platformName: "Behance",
    platformId: id,
    baseUrl: "https://www.behance.net/joblist",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Dribbble": (id) => new GenericScraper({
    platformName: "Dribbble",
    platformId: id,
    baseUrl: "https://dribbble.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Creativepool": (id) => new GenericScraper({
    platformName: "Creativepool",
    platformId: id,
    baseUrl: "https://creativepool.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "ProBlogger": (id) => new GenericScraper({
    platformName: "ProBlogger",
    platformId: id,
    baseUrl: "https://problogger.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "rss",
    feedUrl: "https://problogger.com/jobs/feed/",
  }),
  "Built In": (id) => new GenericScraper({
    platformName: "Built In",
    platformId: id,
    baseUrl: "https://builtin.com/jobs/remote",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Crossover": (id) => new GenericScraper({
    platformName: "Crossover",
    platformId: id,
    baseUrl: "https://www.crossover.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Wellfound": (id) => new GenericScraper({
    platformName: "Wellfound",
    platformId: id,
    baseUrl: "https://wellfound.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),

  // Tier 4 - Niche Platforms
  "Remote100K": (id) => new GenericScraper({
    platformName: "Remote100K",
    platformId: id,
    baseUrl: "https://remote100k.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Jobgether": (id) => new GenericScraper({
    platformName: "Jobgether",
    platformId: id,
    baseUrl: "https://jobgether.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Contra": (id) => new GenericScraper({
    platformName: "Contra",
    platformId: id,
    baseUrl: "https://contra.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Snaphunt": (id) => new GenericScraper({
    platformName: "Snaphunt",
    platformId: id,
    baseUrl: "https://snaphunt.com/job-listing",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Remote.com": (id) => new GenericScraper({
    platformName: "Remote.com",
    platformId: id,
    baseUrl: "https://remote.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "HiringCafe": (id) => new GenericScraper({
    platformName: "HiringCafe",
    platformId: id,
    baseUrl: "https://hiring.cafe",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "DailyRemote": (id) => new GenericScraper({
    platformName: "DailyRemote",
    platformId: id,
    baseUrl: "https://dailyremote.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Outsourcely": (id) => new GenericScraper({
    platformName: "Outsourcely",
    platformId: id,
    baseUrl: "https://www.outsourcely.com/remote-jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "JobRack": (id) => new GenericScraper({
    platformName: "JobRack",
    platformId: id,
    baseUrl: "https://jobrack.eu",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "The Muse": (id) => new GenericScraper({
    platformName: "The Muse",
    platformId: id,
    baseUrl: "https://www.themuse.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Workster": (id) => new GenericScraper({
    platformName: "Workster",
    platformId: id,
    baseUrl: "https://workster.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Workew": (id) => new GenericScraper({
    platformName: "Workew",
    platformId: id,
    baseUrl: "https://workew.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Remoters": (id) => new GenericScraper({
    platformName: "Remoters",
    platformId: id,
    baseUrl: "https://remoters.net/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Still Hiring Today": (id) => new GenericScraper({
    platformName: "Still Hiring Today",
    platformId: id,
    baseUrl: "https://stillhiring.today",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "PowerToFly": (id) => new GenericScraper({
    platformName: "PowerToFly",
    platformId: id,
    baseUrl: "https://powertofly.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Dynamite Jobs": (id) => new GenericScraper({
    platformName: "Dynamite Jobs",
    platformId: id,
    baseUrl: "https://dynamitejobs.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Citizen Remote": (id) => new GenericScraper({
    platformName: "Citizen Remote",
    platformId: id,
    baseUrl: "https://citizenremote.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "EU Remote Jobs": (id) => new GenericScraper({
    platformName: "EU Remote Jobs",
    platformId: id,
    baseUrl: "https://euremotejobs.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Inclusively Remote": (id) => new GenericScraper({
    platformName: "Inclusively Remote",
    platformId: id,
    baseUrl: "https://inclusively.com/jobs",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Remote Nomad Jobs": (id) => new GenericScraper({
    platformName: "Remote Nomad Jobs",
    platformId: id,
    baseUrl: "https://remotenomadjobs.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Open To Work Remote": (id) => new GenericScraper({
    platformName: "Open To Work Remote",
    platformId: id,
    baseUrl: "https://opentoworkremote.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Remote Healthcare Jobs": (id) => new GenericScraper({
    platformName: "Remote Healthcare Jobs",
    platformId: id,
    baseUrl: "https://remotehealthcarejobs.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "SEO Jobs": (id) => new GenericScraper({
    platformName: "SEO Jobs",
    platformId: id,
    baseUrl: "https://seojobs.com",
    rateLimit: 2000,
    maxRetries: 3,
    type: "html",
  }),
  "Dice": (id) => new GenericScraper({
    platformName: "Dice",
    platformId: id,
    baseUrl: "https://www.dice.com/jobs",
    rateLimit: 3000,
    maxRetries: 3,
    type: "html",
  }),
};

/**
 * Get a scraper instance for a platform
 */
export function getScraperForPlatform(platformName: string, platformId: number): BaseScraper | null {
  const factory = scraperRegistry[platformName];
  return factory ? factory(platformId) : null;
}

/**
 * Get list of all supported platforms
 */
export function getSupportedPlatforms(): string[] {
  return Object.keys(scraperRegistry);
}

/**
 * Describe the parser implementation for a registered source. This is not a
 * production-coverage guarantee; source health and scan outcomes remain the
 * evidence for current availability.
 */
export function getScraperAdapterMetadata(platformName: string): ScraperAdapterMetadata {
  const kind: ScraperAdapterKind = dedicatedAdapterPlatforms.has(platformName)
    ? "dedicated"
    : genericRssAdapterPlatforms.has(platformName)
      ? "generic_rss"
      : "generic_html";

  return { ...scraperAdapterMetadata[kind] };
}

/**
 * Check if a platform has a scraper
 */
export function hasScraper(platformName: string): boolean {
  return platformName in scraperRegistry;
}
