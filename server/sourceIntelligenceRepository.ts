import { asc, eq, gt, inArray, sql } from "drizzle-orm";
import { jobDuplicates, jobs, type Job } from "../drizzle/schema";
import { getAllJobPlatforms, getDb } from "./db";
import { sampleJobDuplicateLinks, sampleJobs } from "./sampleData";
import {
  buildSourceDirectory,
  compareSourceRecords,
  type DirectoryInput,
  type SourceCounts,
} from "./sourceIntelligence";

export async function getSourceDirectory(input: DirectoryInput) {
  const db = await getDb();
  const platforms = await getAllJobPlatforms();
  let counts: SourceCounts[];
  if (db) {
    counts = await db
      .select({
        platformId: jobs.platformId,
        listingCount: sql<number>`count(*)`,
        duplicateCount: sql<number>`count(${jobDuplicates.duplicateJobId})`,
      })
      .from(jobs)
      .leftJoin(jobDuplicates, eq(jobs.id, jobDuplicates.duplicateJobId))
      .groupBy(jobs.platformId);
  } else {
    const duplicateIds = new Set(
      sampleJobDuplicateLinks.map(link => link.duplicateJobId)
    );
    const totals = new Map<number, SourceCounts>();
    for (const job of sampleJobs) {
      const count = totals.get(job.platformId) ?? {
        platformId: job.platformId,
        listingCount: 0,
        duplicateCount: 0,
      };
      count.listingCount++;
      if (duplicateIds.has(job.id)) count.duplicateCount++;
      totals.set(job.platformId, count);
    }
    counts = Array.from(totals.values());
  }
  return {
    ...buildSourceDirectory(platforms, counts, input),
    dataMode: db ? ("database" as const) : ("sample" as const),
  };
}

// The review is pair-based and cursor-paginated; never load the full vacancy corpus.
export async function getSourceComparisonPage(input: {
  cursor?: number;
  limit: number;
}) {
  const db = await getDb();
  const candidates = db
    ? await db
        .select({
          primaryJobId: jobDuplicates.primaryJobId,
          duplicateJobId: jobDuplicates.duplicateJobId,
          similarityScore: jobDuplicates.similarityScore,
        })
        .from(jobDuplicates)
        .where(
          input.cursor
            ? gt(jobDuplicates.duplicateJobId, input.cursor)
            : undefined
        )
        .orderBy(asc(jobDuplicates.duplicateJobId))
        .limit(input.limit + 1)
    : sampleJobDuplicateLinks
        .filter(link => !input.cursor || link.duplicateJobId > input.cursor)
        .sort((a, b) => a.duplicateJobId - b.duplicateJobId)
        .slice(0, input.limit + 1);
  const page = candidates.slice(0, input.limit);
  const ids = Array.from(
    new Set(page.flatMap(link => [link.primaryJobId, link.duplicateJobId]))
  );
  const records =
    ids.length === 0
      ? []
      : db
        ? await db
            .select({
              id: jobs.id,
              platformId: jobs.platformId,
              title: jobs.title,
              company: jobs.company,
              location: jobs.location,
              jobType: jobs.jobType,
              salaryCurrency: jobs.salaryCurrency,
              salaryMin: jobs.salaryMin,
              salaryMax: jobs.salaryMax,
              sourceUrl: jobs.sourceUrl,
              applicationUrl: jobs.applicationUrl,
              updatedAt: jobs.updatedAt,
            })
            .from(jobs)
            .where(inArray(jobs.id, ids))
        : sampleJobs.filter(job => ids.includes(job.id));
  const byId = new Map(records.map(job => [job.id, job]));
  const platforms = new Map(
    (await getAllJobPlatforms()).map(platform => [platform.id, platform.name])
  );
  const summarize = (
    job: Pick<
      Job,
      | "id"
      | "platformId"
      | "title"
      | "company"
      | "location"
      | "jobType"
      | "salaryCurrency"
      | "salaryMin"
      | "salaryMax"
      | "sourceUrl"
      | "applicationUrl"
      | "updatedAt"
    >
  ) => ({
    id: job.id,
    platformId: job.platformId,
    platform: platforms.get(job.platformId) ?? String(job.platformId),
    title: job.title,
    company: job.company,
    location: job.location,
    jobType: job.jobType,
    salaryCurrency: job.salaryCurrency,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    url: job.sourceUrl || job.applicationUrl,
    updatedAt: job.updatedAt,
  });
  let unavailablePairs = 0;
  const items = page.flatMap(link => {
    const primary = byId.get(link.primaryJobId),
      duplicate = byId.get(link.duplicateJobId);
    if (!primary || !duplicate) {
      unavailablePairs++;
      return [];
    }
    return [
      {
        primary: summarize(primary),
        duplicate: summarize(duplicate),
        ...compareSourceRecords(primary, duplicate),
      },
    ];
  });
  return {
    items,
    unavailablePairs,
    dataMode: db ? ("database" as const) : ("sample" as const),
    nextCursor:
      candidates.length > input.limit ? page.at(-1)!.duplicateJobId : null,
  };
}
