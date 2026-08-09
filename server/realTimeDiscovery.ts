/**
 * Real-Time Job Discovery Service
 * Provides polling-based notifications for new jobs
 */

import { getDb } from "./db";
import { jobDuplicates, jobs } from "../drizzle/schema";
import { asc, desc, gt, and, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { sampleJobDuplicateLinks, sampleJobs } from "./sampleData";
import { matchesJobAlert } from "../shared/jobAlertMatching";
import { normalizeExperienceLevel, type NormalizedExperienceLevel } from "./jobNormalization";
import { logOperationalFailure } from "./operationalFailureLog";

const canonicalJobCondition = sql`NOT EXISTS (
  SELECT 1 FROM ${jobDuplicates}
  WHERE ${jobDuplicates.duplicateJobId} = ${jobs.id}
)`;
const sampleDuplicateJobIds = new Set(sampleJobDuplicateLinks.map((link) => link.duplicateJobId));

// ============================================================================
// TYPES
// ============================================================================

export interface JobDiscoveryEvent {
  type: "new_job" | "job_updated" | "job_removed" | "batch_complete";
  timestamp: Date;
  data: {
    jobId?: number;
    jobs?: JobSummary[];
    platformId?: number;
    count?: number;
  };
}

export interface JobSummary {
  id: number;
  title: string;
  company: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  jobType: "full-time" | "part-time" | "contract" | "temporary" | null;
  platformId: number;
  postedDate: Date | null;
  requirements?: string | null;
  matchScore?: number;
}

type DiscoveryExperienceLevel = Exclude<NormalizedExperienceLevel, "unknown">;

const DISCOVERY_EXPERIENCE_LEVELS = new Set<DiscoveryExperienceLevel>([
  "entry",
  "junior",
  "mid",
  "senior",
  "lead",
  "executive",
]);

function hasRequestedExperienceLevel(job: JobSummary, values?: string[]) {
  if (!values?.length) return true;
  const levels = values
    .map((value) => value.toLowerCase().trim())
    .filter((value): value is DiscoveryExperienceLevel =>
      DISCOVERY_EXPERIENCE_LEVELS.has(value as DiscoveryExperienceLevel)
    );
  if (levels.length === 0) return true;

  const experienceLevel = normalizeExperienceLevel(`${job.title} ${job.requirements || ""}`);
  return experienceLevel !== "unknown" && levels.includes(experienceLevel);
}

export function selectCanonicalDiscoveryJobs(
  jobs: Array<JobSummary & { createdAt?: Date; isDuplicate?: number }>
): JobSummary[] {
  return jobs
    .filter((job) => !Boolean(job.isDuplicate))
    .map(({ isDuplicate: _isDuplicate, createdAt: _createdAt, ...job }) => job);
}

export interface DiscoverySubscription {
  userId: number;
  filters: {
    keywords?: string[];
    locations?: string[];
    minSalary?: number;
    jobTypes?: string[];
    platformIds?: number[];
    experienceLevels?: string[];
  };
  callback: (event: JobDiscoveryEvent) => void;
}

export function filterDiscoveryJobs(
  jobList: JobSummary[],
  filters: DiscoverySubscription["filters"]
): JobSummary[] {
  return jobList.filter((job) => {
    if (filters.keywords?.length) {
      const searchableText = `${job.title} ${job.company}`.toLowerCase();
      if (!filters.keywords.some((keyword) => searchableText.includes(keyword.toLowerCase()))) return false;
    }

    if (filters.locations?.length) {
      const location = (job.location || "").toLowerCase();
      if (!filters.locations.some((item) => location.includes(item.toLowerCase()))) return false;
    }

    if (filters.platformIds?.length && !filters.platformIds.includes(job.platformId)) return false;

    if (filters.jobTypes?.length && !filters.jobTypes.includes(job.jobType || "")) return false;

    if (!hasRequestedExperienceLevel(job, filters.experienceLevels)) return false;

    if (filters.minSalary && filters.minSalary > 0) {
      const salaryCeiling = job.salaryMax ?? job.salaryMin;
      if (typeof salaryCeiling !== "number" || salaryCeiling < filters.minSalary) return false;
    }

    return true;
  });
}

// ============================================================================
// IN-MEMORY SUBSCRIPTION MANAGER
// ============================================================================

class SubscriptionManager {
  private subscriptions: Map<number, DiscoverySubscription> = new Map();
  private lastCheckedTimestamp: Date = new Date();
  private lastCheckedId = 0;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  /**
   * Subscribe a user to job discovery events
   */
  subscribe(subscription: DiscoverySubscription): void {
    this.subscriptions.set(subscription.userId, subscription);
    console.log(`[Discovery] User ${subscription.userId} subscribed to job updates`);
    
    if (!this.isPolling) {
      this.startPolling();
    }
  }

  /**
   * Unsubscribe a user from job discovery events
   */
  unsubscribe(userId: number): void {
    this.subscriptions.delete(userId);
    console.log(`[Discovery] User ${userId} unsubscribed from job updates`);
    
    if (this.subscriptions.size === 0) {
      this.stopPolling();
    }
  }

  /**
   * Get all active subscriptions
   */
  getSubscriptions(): DiscoverySubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Start polling for new jobs
   */
  private startPolling(): void {
    if (this.pollingInterval) return;
    
    this.isPolling = true;
    this.pollingInterval = setInterval(() => {
      this.checkForNewJobs();
    }, 30000);
    
    console.log("[Discovery] Started polling for new jobs");
  }

  /**
   * Stop polling for new jobs
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isPolling = false;
    console.log("[Discovery] Stopped polling for new jobs");
  }

  /**
   * Check for new jobs since last check
   */
  private async checkForNewJobs(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      const newJobs = await db
        .select({
          id: jobs.id,
          title: jobs.title,
          company: jobs.company,
          location: jobs.location,
          salaryMin: jobs.salaryMin,
          salaryMax: jobs.salaryMax,
          jobType: jobs.jobType,
          platformId: jobs.platformId,
          postedDate: jobs.postedDate,
          requirements: jobs.requirements,
          createdAt: jobs.createdAt,
          isDuplicate: sql<number>`EXISTS (
            SELECT 1 FROM ${jobDuplicates}
            WHERE ${jobDuplicates.duplicateJobId} = ${jobs.id}
          )`,
        })
        .from(jobs)
        .where(
          and(
            or(
              gt(jobs.createdAt, this.lastCheckedTimestamp),
              and(
                eq(jobs.createdAt, this.lastCheckedTimestamp),
                gt(jobs.id, this.lastCheckedId)
              )
            ),
            eq(jobs.isActive, 1)
          )
        )
        .orderBy(asc(jobs.createdAt), asc(jobs.id))
        .limit(100);

      if (newJobs.length > 0) {
        const newestJob = newJobs[newJobs.length - 1];
        this.lastCheckedTimestamp = newestJob.createdAt;
        this.lastCheckedId = newestJob.id;
        const canonicalJobs = selectCanonicalDiscoveryJobs(newJobs);
        if (canonicalJobs.length > 0) {
          this.notifySubscribers(canonicalJobs as JobSummary[]);
        }
      }
    } catch {
      logOperationalFailure("Discovery", "Job polling");
    }
  }

  /**
   * Notify all subscribers of new jobs
   */
  private notifySubscribers(newJobs: JobSummary[]): void {
    for (const subscription of Array.from(this.subscriptions.values())) {
      const filteredJobs = this.filterJobsForUser(newJobs, subscription.filters);
      
      if (filteredJobs.length > 0) {
        const event: JobDiscoveryEvent = {
          type: "new_job",
          timestamp: new Date(),
          data: {
            jobs: filteredJobs,
            count: filteredJobs.length,
          },
        };
        
        try {
          subscription.callback(event);
        } catch {
          logOperationalFailure("Discovery", "Subscriber notification");
        }
      }
    }
  }

  /**
   * Filter jobs based on user preferences
   */
  private filterJobsForUser(jobList: JobSummary[], filters: DiscoverySubscription["filters"]): JobSummary[] {
    return filterDiscoveryJobs(jobList, filters);
  }

  /**
   * Manually trigger a check for new jobs
   */
  async triggerCheck(): Promise<JobSummary[]> {
    const db = await getDb();
    if (!db) return [];

    const recentJobs = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        location: jobs.location,
        salaryMin: jobs.salaryMin,
        salaryMax: jobs.salaryMax,
        jobType: jobs.jobType,
        platformId: jobs.platformId,
        postedDate: jobs.postedDate,
        requirements: jobs.requirements,
      })
      .from(jobs)
      .where(and(eq(jobs.isActive, 1), canonicalJobCondition))
      .orderBy(desc(jobs.createdAt))
      .limit(50);

    return recentJobs as JobSummary[];
  }
}

// Singleton instance
let subscriptionManagerInstance: SubscriptionManager | null = null;

export function getSubscriptionManager(): SubscriptionManager {
  if (!subscriptionManagerInstance) {
    subscriptionManagerInstance = new SubscriptionManager();
  }
  return subscriptionManagerInstance;
}

// ============================================================================
// JOB DISCOVERY API
// ============================================================================

/**
 * Get recent jobs with optional filtering
 */
export async function getRecentJobs(options: {
  limit?: number;
  offset?: number;
  keywords?: string[];
  locations?: string[];
  platformIds?: number[];
  minSalary?: number;
  jobTypes?: string[];
  experienceLevels?: string[];
  postedAfter?: Date;
}): Promise<{ jobs: JobSummary[]; total: number }> {
  const db = await getDb();
  if (!db) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    let filteredJobs = sampleJobs.filter((job) => job.isActive === 1 && !sampleDuplicateJobIds.has(job.id));

    if (options.keywords?.length) {
      filteredJobs = filteredJobs.filter((job) => {
        const searchable = `${job.title} ${job.company} ${job.description || ""} ${job.skills || ""}`.toLowerCase();
        return options.keywords!.some((keyword) => searchable.includes(keyword.toLowerCase()));
      });
    }
    if (options.locations?.length) {
      filteredJobs = filteredJobs.filter((job) => {
        const location = (job.location || "").toLowerCase();
        return options.locations!.some((item) => location.includes(item.toLowerCase()));
      });
    }
    if (options.platformIds?.length) {
      filteredJobs = filteredJobs.filter((job) => options.platformIds!.includes(job.platformId));
    }
    if (options.minSalary) {
      filteredJobs = filteredJobs.filter((job) => {
        const salaryCeiling = job.salaryMax ?? job.salaryMin;
        return typeof salaryCeiling === "number" && salaryCeiling >= options.minSalary!;
      });
    }
    if (options.jobTypes?.length) {
      filteredJobs = filteredJobs.filter((job) => job.jobType && options.jobTypes!.includes(job.jobType));
    }
    if (options.experienceLevels?.length) {
      filteredJobs = filteredJobs.filter((job) => hasRequestedExperienceLevel(job, options.experienceLevels));
    }

    const mappedJobs = filteredJobs
      .sort((a, b) => (b.postedDate?.getTime() || 0) - (a.postedDate?.getTime() || 0))
      .map((job) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        jobType: job.jobType,
        platformId: job.platformId,
        postedDate: job.postedDate,
        requirements: job.requirements,
      }));

    return { jobs: mappedJobs.slice(offset, offset + limit), total: filteredJobs.length };
  }

  const limit = options.limit || 20;
  const offset = options.offset || 0;

  const conditions = [eq(jobs.isActive, 1), canonicalJobCondition];

  if (options.postedAfter) {
    conditions.push(gt(jobs.postedDate, options.postedAfter));
  }
  if (options.keywords?.length) {
    const keywordConditions = options.keywords.map((keyword) => {
      const pattern = `%${keyword}%`;
      return or(
        like(jobs.title, pattern),
        like(jobs.company, pattern),
        like(jobs.description, pattern),
        like(jobs.skills, pattern)
      );
    });
    conditions.push(or(...keywordConditions)!);
  }
  if (options.locations?.length) {
    conditions.push(or(...options.locations.map((location) =>
      like(jobs.location, `%${location}%`)
    ))!);
  }
  if (options.platformIds?.length) {
    conditions.push(inArray(jobs.platformId, options.platformIds));
  }
  if (options.minSalary) {
    conditions.push(gte(sql`COALESCE(${jobs.salaryMax}, ${jobs.salaryMin})`, options.minSalary));
  }
  if (options.jobTypes?.length) {
    conditions.push(inArray(jobs.jobType, options.jobTypes as Array<"full-time" | "part-time" | "contract" | "temporary">));
  }
  if (options.experienceLevels?.length) {
    const levels = options.experienceLevels
      .map((value) => value.toLowerCase().trim())
      .filter((value): value is DiscoveryExperienceLevel =>
        DISCOVERY_EXPERIENCE_LEVELS.has(value as DiscoveryExperienceLevel)
      );
    const experienceTerms: Record<DiscoveryExperienceLevel, string[]> = {
      entry: ["%intern%", "%graduate%", "%entry%", "%new grad%", "%0-1%", "%no experience%"],
      junior: ["%junior%", "%jr%", "%1-2%", "%1-3%"],
      mid: ["%mid%", "%intermediate%", "%3-5%", "%2-4%"],
      senior: ["%senior%", "%sr%", "%5+%", "%5-7%", "%experienced%"],
      lead: ["%lead%", "%principal%", "%staff%", "%architect%", "%7+%", "%8+%"],
      executive: ["%executive%", "%director%", "%vice president%", "%vp%", "%chief%", "%c-level%"],
    };
    const experienceCondition = or(...levels.flatMap((level) =>
      experienceTerms[level].flatMap((term) => [like(jobs.title, term), like(jobs.requirements, term)])
    ));
    if (experienceCondition) conditions.push(experienceCondition);
  }

  const jobListQuery = db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      jobType: jobs.jobType,
      platformId: jobs.platformId,
      postedDate: jobs.postedDate,
      requirements: jobs.requirements,
    })
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.postedDate))
    .limit(limit)
    .offset(offset);

  const countQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(...conditions));

  const [jobList, countResult] = await Promise.all([jobListQuery, countQuery]);

  const total = countResult[0]?.count || 0;

  return { jobs: jobList as JobSummary[], total };
}

/**
 * Get job discovery statistics
 */
export async function getDiscoveryStats(): Promise<{
  totalJobs: number;
  jobsToday: number;
  jobsThisWeek: number;
  topPlatforms: Array<{ platformId: number; count: number }>;
  topLocations: Array<{ location: string; count: number }>;
}> {
  const db = await getDb();
  if (!db) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const activeJobs = sampleJobs.filter((job) => job.isActive === 1 && !sampleDuplicateJobIds.has(job.id));
    return {
      totalJobs: activeJobs.length,
      jobsToday: activeJobs.filter((job) => job.createdAt > todayStart).length,
      jobsThisWeek: activeJobs.filter((job) => job.createdAt > weekStart).length,
      topPlatforms: Object.entries(
        activeJobs.reduce<Record<string, number>>((counts, job) => {
          counts[job.platformId] = (counts[job.platformId] || 0) + 1;
          return counts;
        }, {})
      ).map(([platformId, count]) => ({ platformId: Number(platformId), count })),
      topLocations: Object.entries(
        activeJobs.reduce<Record<string, number>>((counts, job) => {
          if (job.location) counts[job.location] = (counts[job.location] || 0) + 1;
          return counts;
        }, {})
      ).map(([location, count]) => ({ location, count })),
    };
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const totalQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.isActive, 1), canonicalJobCondition));

  const todayQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.isActive, 1), gt(jobs.createdAt, todayStart), canonicalJobCondition));

  const weekQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.isActive, 1), gt(jobs.createdAt, weekStart), canonicalJobCondition));

  const platformsQuery = db
    .select({
      platformId: jobs.platformId,
      count: sql<number>`count(*)`,
    })
    .from(jobs)
    .where(and(eq(jobs.isActive, 1), canonicalJobCondition))
    .groupBy(jobs.platformId)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const locationsQuery = db
    .select({
      location: jobs.location,
      count: sql<number>`count(*)`,
    })
    .from(jobs)
    .where(and(eq(jobs.isActive, 1), sql`${jobs.location} IS NOT NULL`, canonicalJobCondition))
    .groupBy(jobs.location)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const [totalResult, todayResult, weekResult, platformsResult, locationsResult] = await Promise.all([
    totalQuery,
    todayQuery,
    weekQuery,
    platformsQuery,
    locationsQuery,
  ]);

  return {
    totalJobs: totalResult[0]?.count || 0,
    jobsToday: todayResult[0]?.count || 0,
    jobsThisWeek: weekResult[0]?.count || 0,
    topPlatforms: platformsResult.map((p) => ({
      platformId: p.platformId,
      count: Number(p.count),
    })),
    topLocations: locationsResult
      .filter((l) => l.location)
      .map((l) => ({
        location: l.location!,
        count: Number(l.count),
      })),
  };
}

/**
 * Search jobs with full-text search
 */
export async function searchJobs(query: string, options?: {
  limit?: number;
  offset?: number;
}): Promise<{ jobs: JobSummary[]; total: number }> {
  const db = await getDb();
  if (!db) {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;
    const searchTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scoredJobs = sampleJobs
      .filter((job) => !sampleDuplicateJobIds.has(job.id))
      .map((job) => {
        const searchable = `${job.title} ${job.company} ${job.description || ""} ${job.skills || ""}`.toLowerCase();
        const score = searchTerms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
        return { job, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return {
      jobs: scoredJobs.slice(offset, offset + limit).map(({ job, score }) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        jobType: job.jobType,
        platformId: job.platformId,
        postedDate: job.postedDate,
        matchScore: score,
      })),
      total: scoredJobs.length,
    };
  }

  const limit = options?.limit || 20;
  const offset = options?.offset || 0;
  const searchTerms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 20);

  if (searchTerms.length === 0) {
    return getRecentJobs({ limit, offset });
  }

  const matchConditions = searchTerms.flatMap((term) => {
    const pattern = `%${term}%`;
    return [like(jobs.title, pattern), like(jobs.company, pattern), like(jobs.description, pattern)];
  });
  const relevanceParts = searchTerms.flatMap((term) => {
    const pattern = `%${term}%`;
    return [
      sql<number>`CASE WHEN ${jobs.title} LIKE ${pattern} THEN 10 ELSE 0 END`,
      sql<number>`CASE WHEN ${jobs.company} LIKE ${pattern} THEN 5 ELSE 0 END`,
      sql<number>`CASE WHEN ${jobs.description} LIKE ${pattern} THEN 1 ELSE 0 END`,
    ];
  });
  const relevanceScore = sql<number>`(${sql.join(relevanceParts, sql.raw(" + "))})`;
  const conditions = and(eq(jobs.isActive, 1), canonicalJobCondition, or(...matchConditions));

  const jobListQuery = db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      jobType: jobs.jobType,
      platformId: jobs.platformId,
      postedDate: jobs.postedDate,
      matchScore: relevanceScore,
    })
    .from(jobs)
    .where(conditions)
    .orderBy(desc(relevanceScore), desc(jobs.postedDate), desc(jobs.id))
    .limit(limit)
    .offset(offset);
  const countQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(conditions);

  const [jobList, countResult] = await Promise.all([jobListQuery, countQuery]);

  return {
    jobs: jobList.map((job) => ({
      ...job,
      matchScore: Number(job.matchScore),
    })),
    total: Number(countResult[0]?.count || 0),
  };
}

// ============================================================================
// JOB ALERTS
// ============================================================================

export interface JobAlert {
  id: number;
  userId: number;
  name: string;
  keywords: string[];
  locations: string[];
  platformIds: number[];
  minSalary: number | null;
  jobTypes: string[];
  frequency: "instant" | "daily" | "weekly";
  isActive: boolean;
  lastTriggered: Date | null;
  createdAt: Date;
}

/**
 * Check if a job matches an alert
 */
export function jobMatchesAlert(job: JobSummary, alert: JobAlert): boolean {
  return matchesJobAlert(job, {
    keywords: alert.keywords,
    locations: alert.locations,
    platformIds: alert.platformIds,
    minSalary: alert.minSalary,
    jobTypes: alert.jobTypes,
  });
}

/**
 * Process job alerts for new jobs
 */
export async function processJobAlerts(
  newJobs: JobSummary[],
  alerts: JobAlert[]
): Promise<Map<number, JobSummary[]>> {
  const userMatches = new Map<number, JobSummary[]>();

  for (const alert of alerts) {
    if (!alert.isActive) continue;

    const matchingJobs = newJobs.filter((job) => jobMatchesAlert(job, alert));

    if (matchingJobs.length > 0) {
      const existing = userMatches.get(alert.userId) || [];
      userMatches.set(alert.userId, [...existing, ...matchingJobs]);
    }
  }

  return userMatches;
}
