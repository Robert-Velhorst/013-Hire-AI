/**
 * Job discovery query service.
 * Provider ingestion and durable alert matching are owned by the scraper scheduler.
 */

import { getDb } from "./db";
import { jobDuplicates, jobs } from "../drizzle/schema";
import { desc, gt, and, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { sampleJobDuplicateLinks, sampleJobs } from "./sampleData";
import { normalizeExperienceLevel, type NormalizedExperienceLevel } from "./jobNormalization";

const canonicalJobCondition = sql`NOT EXISTS (
  SELECT 1 FROM ${jobDuplicates}
  WHERE ${jobDuplicates.duplicateJobId} = ${jobs.id}
)`;
const sampleDuplicateJobIds = new Set(sampleJobDuplicateLinks.map((link) => link.duplicateJobId));

// ============================================================================
// TYPES
// ============================================================================

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
