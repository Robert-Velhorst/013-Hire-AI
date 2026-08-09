import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  jobPlatforms,
  jobs,
  jobDuplicates,
  userProfiles,
  socialMediaProfiles,
  userConnectorAccounts,
  connectorAuthorizations,
  applications,
  applicationDecisions,
  applicationMaterials,
  applicationAttempts,
  employerResponses,
  inboxResponseCandidates,
  applicationNotifications,
  auditEvents,
  adminReviewItems,
  applicationApprovals,
  applicationCampaigns,
  interviewPreparation,
  jobMatches,
  decisionMakers,
  workExperiences,
  educationEntries,
  userSkills,
  userProjects,
  autonomousRunStates,
  successFees,
  feePayments,
  type Job,
  type UserProfile,
  type SocialMediaProfile,
  type UserConnectorAccount,
  type ConnectorAuthorization,
  type Application,
  type ApplicationDecision,
  type ApplicationMaterial,
  type ApplicationAttempt,
  type EmployerResponse,
  type InboxResponseCandidate,
  type ApplicationNotification,
  type AuditEvent,
  type AdminReviewItem,
  type ApplicationApproval,
  type ApplicationCampaign,
  type InterviewPreparation,
  type User,
  type JobMatch,
  type DecisionMaker,
  type WorkExperience,
  type EducationEntry,
  type UserSkill,
  type UserProject,
  type SuccessFee,
  type FeePayment,
} from "../drizzle/schema";
import type { InferInsertModel } from "drizzle-orm";
import { ENV } from "./_core/env";
import { sampleJobDuplicateLinks, sampleJobs, samplePlatforms } from "./sampleData";
import {
  canTransitionApplicationStatus,
  type ApplicationStatus,
} from "./applicationLifecycle";
import {
  defaultJobSearchFilters,
  filterJobListings,
  type JobSearchFilterState,
} from "@shared/jobSearchFilters";
import { isOfferEligibleApplicationStatus } from "@shared/offerEligibility";
import { getListingObservationCutoff, isJobListingCurrent } from "@shared/jobListingFreshness";
import { PROFILE_EVIDENCE_LIMITS, profileEvidenceLimitMessage } from "@shared/profileEvidenceLimits";
import { APPLICATION_LEDGER_WINDOW_LIMITS, takeApplicationLedgerWindow } from "@shared/applicationLedgerWindow";
import {
  getMissingScraperPlatformCatalog,
  getPlatformDiscoveryPolicy,
  isAutomatedDiscoveryPlatform,
  scraperPlatformCatalog,
} from "./scrapers/platformCatalog";
import { getCanonicalJobGroupIds, resolveCanonicalJobId } from "./jobDeduplication";
import {
  getAutonomousSourceEligibility,
  type AutonomousJobSourceEligibility,
} from "./autonomousSourceEligibility";
import { logOperationalFailure } from "./operationalFailureLog";

type InsertJob = InferInsertModel<typeof jobs>;
type InsertUserProfile = InferInsertModel<typeof userProfiles>;
type InsertSocialMediaProfile = InferInsertModel<typeof socialMediaProfiles>;
type InsertUserConnectorAccount = InferInsertModel<typeof userConnectorAccounts>;
type InsertConnectorAuthorization = InferInsertModel<typeof connectorAuthorizations>;
type InsertApplication = InferInsertModel<typeof applications>;
type InsertApplicationDecision = InferInsertModel<typeof applicationDecisions>;
type InsertApplicationMaterial = InferInsertModel<typeof applicationMaterials>;
type InsertApplicationAttempt = InferInsertModel<typeof applicationAttempts>;
type InsertEmployerResponse = InferInsertModel<typeof employerResponses>;
type InsertInboxResponseCandidate = InferInsertModel<typeof inboxResponseCandidates>;
type InsertApplicationNotification = InferInsertModel<typeof applicationNotifications>;
type InsertAuditEvent = InferInsertModel<typeof auditEvents>;
type InsertAdminReviewItem = InferInsertModel<typeof adminReviewItems>;
type InsertApplicationApproval = InferInsertModel<typeof applicationApprovals>;
type InsertApplicationCampaign = InferInsertModel<typeof applicationCampaigns>;
type InsertInterviewPreparation = InferInsertModel<typeof interviewPreparation>;
type InsertJobMatch = InferInsertModel<typeof jobMatches>;
type InsertDecisionMaker = InferInsertModel<typeof decisionMakers>;
type InsertWorkExperience = InferInsertModel<typeof workExperiences>;
type InsertEducationEntry = InferInsertModel<typeof educationEntries>;
type InsertUserSkill = InferInsertModel<typeof userSkills>;
type InsertUserProject = InferInsertModel<typeof userProjects>;
type InsertSuccessFee = InferInsertModel<typeof successFees>;

let _db: ReturnType<typeof drizzle> | null = null;
const memoryUsers: (InsertUser & {
  id: number;
  role: "user" | "admin";
  accountStatus: "active" | "suspended" | "pending";
  stripeCustomerId: string | null;
  tosAcceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
})[] = [];
const memoryProfiles = new Map<number, UserProfile>();
const memorySocialMediaProfiles: (InsertSocialMediaProfile & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryConnectorAccounts: (InsertUserConnectorAccount & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryConnectorAuthorizations: (InsertConnectorAuthorization & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryApplications: (InsertApplication & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryApplicationDecisions: (InsertApplicationDecision & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryApplicationMaterials: (InsertApplicationMaterial & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryApplicationAttempts: (InsertApplicationAttempt & { id: number; createdAt: Date })[] = [];
const memoryEmployerResponses: (InsertEmployerResponse & { id: number; createdAt: Date })[] = [];
const memoryInboxResponseCandidates: (InsertInboxResponseCandidate & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryApplicationNotifications: (InsertApplicationNotification & { id: number; createdAt: Date })[] = [];
const memoryAuditEvents: (InsertAuditEvent & { id: number; createdAt: Date })[] = [];
const memoryAdminReviewItems: AdminReviewItem[] = [];
const memoryApplicationApprovals: (InsertApplicationApproval & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryApplicationCampaigns: (InsertApplicationCampaign & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryInterviewPreparations: (InsertInterviewPreparation & { id: number; createdAt: Date })[] = [];
const memoryJobMatches: (InsertJobMatch & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memorySuccessFees: (InsertSuccessFee & { id: number; createdAt: Date; updatedAt: Date })[] = [];
const memoryAutonomousRuns = new Map<number, {
  leaseToken: string | null;
  leaseExpiresAt: number;
  lastCompletedAt: number;
  lastStartedAt: number | null;
  lastStatus: "running" | "completed" | "failed" | "skipped" | null;
  lastError: string | null;
  lastOutcomeDetail: string | null;
  lastRunSummary: string | null;
}>();

export interface AutonomousRunSummaryRecord {
  queuedApplicationRecords: number;
  queuedReviewRecords: number;
  queuedManualRecords: number;
  queuedFollowUps: number;
  skippedDuplicateFollowUps: number;
  skippedSafetyBlockedFollowUps: number;
  skippedResumeEvidenceActions: number;
  skippedProfileReadinessActions: number;
  skippedEvidenceGatedActions: number;
  skippedStaleJobActions: number;
  skippedEmptySourceActions: number;
  userDecisionLockedJobs?: number;
  inboxProvidersScanned?: number;
  inboxReauthorizationRequired?: number;
  inboxCandidatesDiscovered?: number;
  inboxMonitoringFailures?: number;
  failedActions: number;
}

export interface AutonomousRunStateSnapshot {
  lastStartedAt: Date | null;
  lastCompletedAt: Date | null;
  lastStatus: "running" | "completed" | "failed" | "skipped" | null;
  lastError: string | null;
  lastOutcomeDetail: string | null;
  lastRunSummary: AutonomousRunSummaryRecord | null;
}

function parseAutonomousRunSummary(value: string | null | undefined): AutonomousRunSummaryRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const keys: Array<keyof AutonomousRunSummaryRecord> = [
      "queuedApplicationRecords",
      "queuedReviewRecords",
      "queuedManualRecords",
      "queuedFollowUps",
      "skippedDuplicateFollowUps",
      "skippedSafetyBlockedFollowUps",
      "skippedResumeEvidenceActions",
      "skippedEvidenceGatedActions",
      "failedActions",
    ];
    if (!keys.every((key) => typeof parsed[key] === "number" && Number.isFinite(parsed[key]))) {
      return null;
    }
    const summary = {} as AutonomousRunSummaryRecord;
    for (const key of keys) {
      summary[key] = Math.max(0, Math.round(parsed[key] as number));
    }
    summary.skippedProfileReadinessActions = typeof parsed.skippedProfileReadinessActions === "number"
      && Number.isFinite(parsed.skippedProfileReadinessActions)
      ? Math.max(0, Math.round(parsed.skippedProfileReadinessActions))
      : 0;
    summary.skippedStaleJobActions = typeof parsed.skippedStaleJobActions === "number"
      && Number.isFinite(parsed.skippedStaleJobActions)
      ? Math.max(0, Math.round(parsed.skippedStaleJobActions))
      : 0;
    summary.skippedEmptySourceActions = typeof parsed.skippedEmptySourceActions === "number"
      && Number.isFinite(parsed.skippedEmptySourceActions)
      ? Math.max(0, Math.round(parsed.skippedEmptySourceActions))
      : 0;
    summary.userDecisionLockedJobs = typeof parsed.userDecisionLockedJobs === "number"
      && Number.isFinite(parsed.userDecisionLockedJobs)
      ? Math.max(0, Math.round(parsed.userDecisionLockedJobs))
      : 0;
    summary.inboxProvidersScanned = typeof parsed.inboxProvidersScanned === "number"
      && Number.isFinite(parsed.inboxProvidersScanned)
      ? Math.max(0, Math.round(parsed.inboxProvidersScanned))
      : 0;
    summary.inboxReauthorizationRequired = typeof parsed.inboxReauthorizationRequired === "number"
      && Number.isFinite(parsed.inboxReauthorizationRequired)
      ? Math.max(0, Math.round(parsed.inboxReauthorizationRequired))
      : 0;
    summary.inboxCandidatesDiscovered = typeof parsed.inboxCandidatesDiscovered === "number"
      && Number.isFinite(parsed.inboxCandidatesDiscovered)
      ? Math.max(0, Math.round(parsed.inboxCandidatesDiscovered))
      : 0;
    summary.inboxMonitoringFailures = typeof parsed.inboxMonitoringFailures === "number"
      && Number.isFinite(parsed.inboxMonitoringFailures)
      ? Math.max(0, Math.round(parsed.inboxMonitoringFailures))
      : 0;
    return summary;
  } catch {
    return null;
  }
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch {
      logOperationalFailure("Database", "Connection initialization");
      _db = null;
    }
  }
  return _db;
}

export async function probeDatabaseConnection(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.execute(sql`SELECT 1`);
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    const existing = memoryUsers.find((item) => item.openId === user.openId);
    const signedInAt = user.lastSignedIn ?? new Date();
    if (existing) {
      existing.name = user.name ?? existing.name ?? null;
      existing.email = user.email ?? existing.email ?? null;
      existing.loginMethod = user.loginMethod ?? existing.loginMethod ?? null;
      existing.role = user.role ?? existing.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
      existing.locale = user.locale ?? existing.locale ?? "en";
      existing.stripeCustomerId = user.stripeCustomerId ?? existing.stripeCustomerId ?? null;
      existing.accountStatus = user.accountStatus ?? existing.accountStatus ?? "active";
      existing.tosAcceptedAt = user.tosAcceptedAt ?? existing.tosAcceptedAt ?? null;
      existing.lastSignedIn = signedInAt;
      existing.updatedAt = new Date();
      return;
    }

    memoryUsers.push({
      ...user,
      id: memoryUsers.length + 1,
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      role: user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user"),
      locale: user.locale ?? "en",
      stripeCustomerId: user.stripeCustomerId ?? null,
      accountStatus: user.accountStatus ?? "active",
      tosAcceptedAt: user.tosAcceptedAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: signedInAt,
    });
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (user.locale !== undefined) {
      values.locale = user.locale;
      updateSet.locale = user.locale;
    }
    if (user.stripeCustomerId !== undefined) {
      values.stripeCustomerId = user.stripeCustomerId;
      updateSet.stripeCustomerId = user.stripeCustomerId;
    }
    if (user.accountStatus !== undefined) {
      values.accountStatus = user.accountStatus;
      updateSet.accountStatus = user.accountStatus;
    }
    if (user.tosAcceptedAt !== undefined) {
      values.tosAcceptedAt = user.tosAcceptedAt;
      updateSet.tosAcceptedAt = user.tosAcceptedAt;
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    logOperationalFailure("Database", "User upsert");
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    return memoryUsers.find((user) => user.openId === openId) as User | undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return memoryUsers.find((user) => user.id === userId) as User | undefined;
  return (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
}

export async function getUserByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const db = await getDb();
  if (!db) {
    return memoryUsers.find((user) => user.email?.trim().toLowerCase() === normalizedEmail) as User | undefined;
  }
  return (await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1))[0];
}

export async function updateUserLocale(userId: number, locale: string) {
  const db = await getDb();
  if (!db) {
    const user = memoryUsers.find((item) => item.id === userId);
    if (!user) throw new Error("User not found");
    user.locale = locale;
    user.updatedAt = new Date();
    return;
  }
  await db.update(users).set({ locale }).where(eq(users.id, userId));
}

// Job Platforms
export async function getAllJobPlatforms() {
  const db = await getDb();
  if (!db) return samplePlatforms;
  return await db.select().from(jobPlatforms);
}

export async function getActiveJobPlatforms() {
  const db = await getDb();
  if (!db) return samplePlatforms.filter((platform) => platform.isActive === 1);
  return await db.select().from(jobPlatforms).where(eq(jobPlatforms.isActive, 1));
}

export async function updatePlatformLastScraped(platformId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(jobPlatforms).set({ lastScraped: new Date() }).where(eq(jobPlatforms.id, platformId));
}

export type ScrapeOutcome = {
  jobCount: number;
  errors: string[];
};

/** Atomically reserve a provider request window across workers and restarts. */
export async function claimPlatformScrapeAttempt(platformId: number, eligibleBefore: Date) {
  const db = await getDb();
  if (!db) return true;
  const result = await db.update(jobPlatforms)
    .set({ lastScrapeAttemptedAt: new Date() })
    .where(and(
      eq(jobPlatforms.id, platformId),
      or(
        isNull(jobPlatforms.lastScrapeAttemptedAt),
        lte(jobPlatforms.lastScrapeAttemptedAt, eligibleBefore)
      )
    ));
  const packet = Array.isArray(result) ? result[0] : result;
  return Number((packet as { affectedRows?: number } | undefined)?.affectedRows ?? 0) === 1;
}

function boundedScrapeError(errors: string[]) {
  return errors
    .map((error) => error.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ")
    .slice(0, 2000) || null;
}

/**
 * Preserve the most recent source attempt independently from the last clean
 * scrape. Discovery can then report a degraded source without treating an old
 * clean timestamp as evidence that the latest run succeeded.
 */
export async function recordPlatformScrapeOutcome(platformId: number, outcome: ScrapeOutcome) {
  const db = await getDb();
  if (!db) return;

  const attemptedAt = new Date();
  const jobCount = Math.max(0, Math.floor(outcome.jobCount));
  const error = boundedScrapeError(outcome.errors);
  const status = outcome.errors.length === 0
    ? "success"
    : jobCount > 0
      ? "partial"
      : "failed";
  const values = {
    lastScrapeAttemptedAt: attemptedAt,
    lastScrapeStatus: status,
    lastScrapeJobCount: jobCount,
    lastScrapeError: error,
  } as const;

  if (status === "success") {
    await db.update(jobPlatforms)
      .set({ ...values, lastScraped: attemptedAt })
      .where(eq(jobPlatforms.id, platformId));
    return;
  }

  await db.update(jobPlatforms).set(values).where(eq(jobPlatforms.id, platformId));
}

// Jobs
export async function createJob(job: InsertJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(jobs).values(job);
}

const canonicalJobCondition = sql`NOT EXISTS (
  SELECT 1 FROM ${jobDuplicates}
  WHERE ${jobDuplicates.duplicateJobId} = ${jobs.id}
)`;

function currentListingCondition(now: Date) {
  const observationCutoff = getListingObservationCutoff(now);
  return or(
    and(isNotNull(jobs.expiryDate), gt(jobs.expiryDate, now)),
    and(isNull(jobs.expiryDate), gt(jobs.updatedAt, observationCutoff))
  )!;
}

/**
 * Give every supported scraper a durable source record without changing any
 * existing platform configuration or initiating an external scrape.
 */
export async function ensureScraperPlatformCatalog() {
  const db = await getDb();
  if (!db) {
    return { created: 0, total: samplePlatforms.length };
  }

  const configured = await db.select({ name: jobPlatforms.name }).from(jobPlatforms);
  const missing = getMissingScraperPlatformCatalog(configured.map((platform) => platform.name));
  if (missing.length > 0) {
    await db.insert(jobPlatforms).values(missing).onDuplicateKeyUpdate({
      set: { name: sql`VALUES(${jobPlatforms.name})` },
    });
  }

  return { created: missing.length, total: configured.length + missing.length, supported: scraperPlatformCatalog.length };
}

const sampleDuplicateJobIds = new Set(sampleJobDuplicateLinks.map((link) => link.duplicateJobId));

/**
 * User-facing discovery health deliberately reports only persisted source and
 * listing state. It never implies that an external scrape was run just because
 * a platform adapter is registered in the application.
 */
export async function getJobDiscoveryStatus() {
  const now = new Date();
  const freshAfter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await ensureScraperPlatformCatalog();
  const db = await getDb();
  if (!db) {
    const trackedPlatforms = samplePlatforms.filter((platform) => platform.isActive === 1);
    const activePlatforms = trackedPlatforms.filter((platform) => isAutomatedDiscoveryPlatform(platform.name));
    const canonicalJobs = sampleJobs.filter((job) =>
      isJobListingCurrent(job, now) && !sampleDuplicateJobIds.has(job.id)
    );
    const successfulScrapes = activePlatforms
      .map((platform) => platform.lastScraped)
      .filter((lastScraped): lastScraped is Date => lastScraped instanceof Date);
    const freshScrapes = successfulScrapes.filter((lastScraped) => lastScraped >= freshAfter);

    return {
      activeSources: activePlatforms.length,
      trackedSources: trackedPlatforms.length,
      manualIntegrationSources: trackedPlatforms.filter((platform) =>
        getPlatformDiscoveryPolicy(platform.name).mode === "manual"
      ).length,
      unavailableSources: trackedPlatforms.filter((platform) =>
        getPlatformDiscoveryPolicy(platform.name).mode === "unavailable"
      ).length,
      sourcesWithSuccessfulScrape: successfulScrapes.length,
      sourcesWithFreshScrape: freshScrapes.length,
      sourcesAwaitingFirstScrape: activePlatforms.length - successfulScrapes.length,
      sourcesWithStaleScrape: successfulScrapes.length - freshScrapes.length,
      sourcesWithFailedLatestScrape: 0,
      sourcesWithPartialLatestScrape: 0,
      sourcesWithEmptyLatestScrape: 0,
      sourcesWithFreshFailedLatestScrape: 0,
      sourcesWithFreshPartialLatestScrape: 0,
      sourcesWithFreshEmptyLatestScrape: 0,
      latestSuccessfulScrapeAt: successfulScrapes.length > 0
        ? new Date(Math.max(...successfulScrapes.map((lastScraped) => lastScraped.getTime())))
        : null,
      canonicalJobs: canonicalJobs.length,
    };
  }

  const [trackedPlatforms, jobCountRows] = await Promise.all([
    db
      .select({
        name: jobPlatforms.name,
        lastScraped: jobPlatforms.lastScraped,
        lastScrapeAttemptedAt: jobPlatforms.lastScrapeAttemptedAt,
        lastScrapeStatus: jobPlatforms.lastScrapeStatus,
        lastScrapeJobCount: jobPlatforms.lastScrapeJobCount,
      })
      .from(jobPlatforms)
      .where(eq(jobPlatforms.isActive, 1)),
    db
      .select({ total: sql<number>`count(*)` })
      .from(jobs)
      .where(and(
        eq(jobs.isActive, 1),
        currentListingCondition(now),
        canonicalJobCondition,
      )),
  ]);
  const activePlatforms = trackedPlatforms.filter((platform) => isAutomatedDiscoveryPlatform(platform.name));
  const successfulScrapes = activePlatforms
    .map((platform) => platform.lastScraped)
    .filter((lastScraped): lastScraped is Date => lastScraped instanceof Date);
  const freshScrapes = successfulScrapes.filter((lastScraped) => lastScraped >= freshAfter);
  const failedLatestScrapes = activePlatforms.filter((platform) => platform.lastScrapeStatus === "failed");
  const partialLatestScrapes = activePlatforms.filter((platform) => platform.lastScrapeStatus === "partial");
  const emptyLatestScrapes = activePlatforms.filter((platform) =>
    platform.lastScrapeStatus === "success" && platform.lastScrapeJobCount === 0
  );
  const hasFreshLatestAttempt = (platform: typeof activePlatforms[number]) => {
    const attemptedAt = platform.lastScrapeAttemptedAt ?? platform.lastScraped;
    return attemptedAt instanceof Date && attemptedAt >= freshAfter;
  };
  const freshFailedLatestScrapes = failedLatestScrapes.filter(hasFreshLatestAttempt);
  const freshPartialLatestScrapes = partialLatestScrapes.filter(hasFreshLatestAttempt);
  const freshEmptyLatestScrapes = emptyLatestScrapes.filter(hasFreshLatestAttempt);

  return {
    activeSources: activePlatforms.length,
    trackedSources: trackedPlatforms.length,
    manualIntegrationSources: trackedPlatforms.filter((platform) =>
      getPlatformDiscoveryPolicy(platform.name).mode === "manual"
    ).length,
    unavailableSources: trackedPlatforms.filter((platform) =>
      getPlatformDiscoveryPolicy(platform.name).mode === "unavailable"
    ).length,
    sourcesWithSuccessfulScrape: successfulScrapes.length,
    sourcesWithFreshScrape: freshScrapes.length,
    sourcesAwaitingFirstScrape: activePlatforms.length - successfulScrapes.length,
    sourcesWithStaleScrape: successfulScrapes.length - freshScrapes.length,
    sourcesWithFailedLatestScrape: failedLatestScrapes.length,
    sourcesWithPartialLatestScrape: partialLatestScrapes.length,
    sourcesWithEmptyLatestScrape: emptyLatestScrapes.length,
    sourcesWithFreshFailedLatestScrape: freshFailedLatestScrapes.length,
    sourcesWithFreshPartialLatestScrape: freshPartialLatestScrapes.length,
    sourcesWithFreshEmptyLatestScrape: freshEmptyLatestScrapes.length,
    latestSuccessfulScrapeAt: successfulScrapes.length > 0
      ? new Date(Math.max(...successfulScrapes.map((lastScraped) => lastScraped.getTime())))
      : null,
    canonicalJobs: Number(jobCountRows[0]?.total ?? 0),
  };
}

function resolveJobSearchFilters(filters: Partial<JobSearchFilterState> = {}): JobSearchFilterState {
  return {
    ...defaultJobSearchFilters,
    ...filters,
    salaryRange: filters.salaryRange ?? defaultJobSearchFilters.salaryRange,
  };
}

function addJobSearchFilterConditions(conditions: SQL[], filters: JobSearchFilterState, now: Date) {
  const queryTerms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const term of queryTerms) {
    const value = searchTerm(term);
    const condition = or(
      like(jobs.title, value),
      like(jobs.company, value),
      like(jobs.description, value),
      like(jobs.requirements, value),
      like(jobs.responsibilities, value),
      like(jobs.benefits, value),
      like(jobs.skills, value)
    );
    if (condition) conditions.push(condition);
  }

  if (filters.jobType !== "all") conditions.push(eq(jobs.jobType, filters.jobType as "full-time" | "part-time" | "contract" | "temporary"));
  if (filters.platformId !== "all" && Number.isInteger(Number(filters.platformId)) && Number(filters.platformId) > 0) {
    conditions.push(eq(jobs.platformId, Number(filters.platformId)));
  }
  const selectedLocations = filters.location
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (selectedLocations.length > 0) {
    const locationCondition = or(...selectedLocations.map((value) => like(jobs.location, searchTerm(value))));
    if (locationCondition) conditions.push(locationCondition);
  }
  if (filters.remoteOnly) {
    const remoteCondition = or(
      like(jobs.location, "%remote%"),
      like(jobs.location, "%worldwide%"),
      like(jobs.location, "%anywhere%"),
      like(jobs.location, "%distributed%"),
      like(jobs.location, "%work from home%"),
      like(jobs.location, "%wfh%"),
      like(jobs.title, "%remote%"),
      like(jobs.title, "%worldwide%"),
      like(jobs.title, "%anywhere%"),
      like(jobs.title, "%distributed%"),
      like(jobs.title, "%work from home%"),
      like(jobs.title, "%wfh%"),
      like(jobs.description, "%remote%"),
      like(jobs.description, "%worldwide%"),
      like(jobs.description, "%anywhere%"),
      like(jobs.description, "%distributed%"),
      like(jobs.description, "%work from home%"),
      like(jobs.description, "%wfh%"),
      like(jobs.requirements, "%remote%"),
      like(jobs.requirements, "%worldwide%"),
      like(jobs.requirements, "%anywhere%"),
      like(jobs.requirements, "%distributed%"),
      like(jobs.requirements, "%work from home%"),
      like(jobs.requirements, "%wfh%"),
      like(jobs.responsibilities, "%remote%"),
      like(jobs.responsibilities, "%worldwide%"),
      like(jobs.responsibilities, "%anywhere%"),
      like(jobs.responsibilities, "%distributed%"),
      like(jobs.responsibilities, "%work from home%"),
      like(jobs.responsibilities, "%wfh%")
    );
    if (remoteCondition) conditions.push(remoteCondition);
    const remoteOnlyExclusions = [jobs.location, jobs.title, jobs.description, jobs.requirements, jobs.responsibilities]
      .flatMap((column) => [
        sql`LOWER(COALESCE(${column}, '')) NOT LIKE '%hybrid%'`,
        sql`LOWER(COALESCE(${column}, '')) NOT LIKE '%onsite%'`,
        sql`LOWER(COALESCE(${column}, '')) NOT LIKE '%on-site%'`,
        sql`LOWER(COALESCE(${column}, '')) NOT LIKE '%in office%'`,
        sql`LOWER(COALESCE(${column}, '')) NOT LIKE '%in-office%'`,
      ]);
    conditions.push(...remoteOnlyExclusions);
  }
  if (filters.visaSponsorshipOnly) conditions.push(eq(jobs.visaSponsorshipAvailable, 1));
  if (filters.openHiringSupportOnly) conditions.push(eq(jobs.openHiringSupport, 1));
  if (filters.diversityFriendlyOnly) conditions.push(eq(jobs.diversityFriendly, 1));
  if (filters.postedWithin !== "all") {
    const postedAfter = new Date(now.getTime() - Number(filters.postedWithin) * 86400000);
    conditions.push(or(
      gte(jobs.postedDate, postedAfter),
      and(isNull(jobs.postedDate), gte(jobs.createdAt, postedAfter))
    )!);
  }

  if (filters.applicationProcess !== "all") {
    if (filters.applicationProcess === "other") {
      const otherProcess = or(
        isNull(jobs.applicationProcess),
        notInArray(jobs.applicationProcess, ["greenhouse", "lever", "workday", "email"])
      );
      if (otherProcess) conditions.push(otherProcess);
    } else {
      conditions.push(eq(jobs.applicationProcess, filters.applicationProcess));
    }
  }

  if (filters.experienceLevel !== "all") {
    const experienceTerms = {
      entry: ["%intern%", "%graduate%", "%entry%", "%new grad%"],
      junior: ["%junior%", "%jr.%", "%1+ year%", "%2+ year%"],
      mid: ["%mid%", "%intermediate%", "%3+ year%", "%4+ year%"],
      senior: ["%senior%", "%sr.%", "%5+ year%", "%6+ year%"],
      lead: ["%lead%", "%principal%", "%staff%", "%architect%", "%7+ year%", "%8+ year%"],
      executive: ["%executive%", "%director%", "%vice president%", "%chief%", "%c-suite%"],
    } as const;
    const terms = experienceTerms[filters.experienceLevel];
    const experienceCondition = or(...terms.flatMap((term) => [like(jobs.title, term), like(jobs.requirements, term)]));
    if (experienceCondition) conditions.push(experienceCondition);
  }

  const selectedSalaryCurrency = filters.salaryCurrency === "all"
    ? null
    : filters.salaryCurrency.toUpperCase();
  const salaryCurrencyMatches = selectedSalaryCurrency
    ? selectedSalaryCurrency === "USD"
      ? or(eq(jobs.salaryCurrency, selectedSalaryCurrency), isNull(jobs.salaryCurrency))
      : eq(jobs.salaryCurrency, selectedSalaryCurrency)
    : null;
  const salaryOverlap = and(
    or(isNull(jobs.salaryMin), lte(jobs.salaryMin, filters.salaryRange[1])),
    or(isNull(jobs.salaryMax), gte(jobs.salaryMax, filters.salaryRange[0]))
  );
  const hasActiveSalaryRange = filters.salaryCurrency !== "all" ||
    filters.salaryRange[0] !== defaultJobSearchFilters.salaryRange[0] ||
    filters.salaryRange[1] !== defaultJobSearchFilters.salaryRange[1];
  if (filters.salaryDisclosedOnly) {
    const hasSalary = or(isNotNull(jobs.salaryMin), isNotNull(jobs.salaryMax));
    if (hasSalary) conditions.push(hasSalary);
  }
  if (salaryCurrencyMatches) conditions.push(salaryCurrencyMatches);
  if (hasActiveSalaryRange && salaryOverlap) {
    if (filters.salaryDisclosedOnly) {
      conditions.push(salaryOverlap);
    } else {
    const salaryCondition = or(and(isNull(jobs.salaryMin), isNull(jobs.salaryMax)), salaryOverlap);
    if (salaryCondition) conditions.push(salaryCondition);
    }
  }
}

export async function getActiveJobs(limit = 100, offset = 0, filters: Partial<JobSearchFilterState> = {}) {
  const boundedLimit = Math.min(Math.max(limit, 1), 250);
  const boundedOffset = Math.max(offset, 0);
  const now = new Date();
  const resolvedFilters = resolveJobSearchFilters(filters);
  const db = await getDb();
  if (!db) {
    return filterJobListings(sampleJobs
      .filter((job) =>
        isJobListingCurrent(job, now) && !sampleDuplicateJobIds.has(job.id)
      ), resolvedFilters, now)
      .sort((a, b) => (b.postedDate?.getTime() || 0) - (a.postedDate?.getTime() || 0))
      .slice(boundedOffset, boundedOffset + boundedLimit);
  }
  const conditions: SQL[] = [
    eq(jobs.isActive, 1),
    currentListingCondition(now),
    canonicalJobCondition,
  ];
  addJobSearchFilterConditions(conditions, resolvedFilters, now);
  const listingRows = await db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.postedDate), desc(jobs.createdAt))
    .limit(boundedLimit)
    .offset(boundedOffset);
  // Listing safety is evaluated from the same raw fields as the autonomous
  // pipeline, preventing explicit payment and forwarding signals from leaking
  // into normal discovery while retaining ambiguous listings for review.
  return filterJobListings(listingRows, resolvedFilters, now);
}

export type ActiveJobPageCursor = {
  postedDate: Date | null;
  createdAt: Date;
  id: number;
};

export async function getActiveJobPage(
  input: {
    limit?: number;
    cursor?: ActiveJobPageCursor;
    filters?: Partial<JobSearchFilterState>;
  } = {}
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const now = new Date();
  const resolvedFilters = resolveJobSearchFilters(input.filters ?? {});
  const db = await getDb();

  if (!db) {
    const ordered = filterJobListings(sampleJobs
      .filter((job) => isJobListingCurrent(job, now) && !sampleDuplicateJobIds.has(job.id)), resolvedFilters, now)
      .sort((a, b) => {
        const postedDifference = (b.postedDate?.getTime() ?? Number.NEGATIVE_INFINITY) -
          (a.postedDate?.getTime() ?? Number.NEGATIVE_INFINITY);
        if (postedDifference !== 0) return postedDifference;
        const createdDifference = b.createdAt.getTime() - a.createdAt.getTime();
        return createdDifference !== 0 ? createdDifference : b.id - a.id;
      });
    const afterCursor = input.cursor
      ? ordered.filter((job) => {
          const postedTime = job.postedDate?.getTime() ?? Number.NEGATIVE_INFINITY;
          const cursorPostedTime = input.cursor!.postedDate?.getTime() ?? Number.NEGATIVE_INFINITY;
          return postedTime < cursorPostedTime ||
            (postedTime === cursorPostedTime && (
              job.createdAt < input.cursor!.createdAt ||
              (job.createdAt.getTime() === input.cursor!.createdAt.getTime() && job.id < input.cursor!.id)
            ));
        })
      : ordered;
    const pageRows = afterCursor.slice(0, limit + 1);
    const items = pageRows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: pageRows.length > limit && last
        ? { postedDate: last.postedDate, createdAt: last.createdAt, id: last.id }
        : null,
    };
  }

  const conditions: SQL[] = [
    eq(jobs.isActive, 1),
    currentListingCondition(now),
    canonicalJobCondition,
  ];
  addJobSearchFilterConditions(conditions, resolvedFilters, now);
  if (input.cursor) {
    const position = input.cursor.postedDate
      ? or(
          lt(jobs.postedDate, input.cursor.postedDate),
          isNull(jobs.postedDate),
          and(
            eq(jobs.postedDate, input.cursor.postedDate),
            or(
              lt(jobs.createdAt, input.cursor.createdAt),
              and(eq(jobs.createdAt, input.cursor.createdAt), lt(jobs.id, input.cursor.id))
            )
          )
        )
      : and(
          isNull(jobs.postedDate),
          or(
            lt(jobs.createdAt, input.cursor.createdAt),
            and(eq(jobs.createdAt, input.cursor.createdAt), lt(jobs.id, input.cursor.id))
          )
        );
    if (position) conditions.push(position);
  }

  const pageRows = await db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.postedDate), desc(jobs.createdAt), desc(jobs.id))
    .limit(limit + 1);
  const items = filterJobListings(pageRows.slice(0, limit), resolvedFilters, now);
  const lastScanned = pageRows[Math.min(limit, pageRows.length) - 1];
  return {
    items,
    nextCursor: pageRows.length > limit && lastScanned
      ? { postedDate: lastScanned.postedDate, createdAt: lastScanned.createdAt, id: lastScanned.id }
      : null,
  };
}

export async function getJobById(jobId: number) {
  const db = await getDb();
  if (!db) return sampleJobs.find((job) => job.id === jobId);
  const result = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

const searchTerm = (value: string) => `%${value.trim().replace(/[%_]/g, "\\$&")}%`;

export async function searchJobs(filters: {
  title?: string;
  company?: string;
  location?: string;
  skills?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const title = filters.title?.toLowerCase();
    const company = filters.company?.toLowerCase();
    const location = filters.location?.toLowerCase();
    const skills = filters.skills?.toLowerCase();

    const boundedLimit = Math.min(Math.max(filters.limit || 50, 1), 100);
    const boundedOffset = Math.max(filters.offset || 0, 0);

    return sampleJobs
      .filter((job) => isJobListingCurrent(job, now))
      .filter((job) => !sampleDuplicateJobIds.has(job.id))
      .filter((job) => !title || job.title.toLowerCase().includes(title))
      .filter((job) => !company || job.company.toLowerCase().includes(company))
      .filter((job) => !location || (job.location || "").toLowerCase().includes(location))
      .filter((job) => !skills || `${job.skills || ""} ${job.description || ""} ${job.requirements || ""}`.toLowerCase().includes(skills))
      .slice(boundedOffset, boundedOffset + boundedLimit);
  }

  const conditions: SQL[] = [
    eq(jobs.isActive, 1),
    currentListingCondition(now),
    canonicalJobCondition,
  ];

  if (filters.title?.trim()) {
    conditions.push(like(jobs.title, searchTerm(filters.title)));
  }
  if (filters.company?.trim()) {
    conditions.push(like(jobs.company, searchTerm(filters.company)));
  }
  if (filters.location?.trim()) {
    conditions.push(like(jobs.location, searchTerm(filters.location)));
  }
  if (filters.skills?.trim()) {
    const term = searchTerm(filters.skills);
    const skillCondition = or(
      like(jobs.skills, term),
      like(jobs.description, term),
      like(jobs.requirements, term)
    );
    if (skillCondition) conditions.push(skillCondition);
  }

  return await db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .limit(Math.min(Math.max(filters.limit || 50, 1), 100))
    .offset(Math.max(filters.offset || 0, 0));
}

export async function getJobAggregationSources(jobId: number) {
  const db = await getDb();
  if (!db) {
    const job = sampleJobs.find((item) => item.id === jobId);
    if (!job) return null;
    const primaryJobId = resolveCanonicalJobId(jobId, sampleJobDuplicateLinks);
    const sourceIds = getCanonicalJobGroupIds(jobId, sampleJobDuplicateLinks);
    return {
      primaryJobId,
      sources: sourceIds
        .map((sourceId) => sampleJobs.find((item) => item.id === sourceId))
        .filter((source): source is typeof job => Boolean(source)),
    };
  }

  const job = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job[0]) return null;

  const directLinks = await db
    .select({
      primaryJobId: jobDuplicates.primaryJobId,
      duplicateJobId: jobDuplicates.duplicateJobId,
    })
    .from(jobDuplicates)
    .where(or(
      eq(jobDuplicates.primaryJobId, jobId),
      eq(jobDuplicates.duplicateJobId, jobId)
    ));
  const primaryJobId = resolveCanonicalJobId(jobId, directLinks);
  const links = primaryJobId === jobId
    ? directLinks
    : await db
      .select({
        primaryJobId: jobDuplicates.primaryJobId,
        duplicateJobId: jobDuplicates.duplicateJobId,
      })
      .from(jobDuplicates)
      .where(eq(jobDuplicates.primaryJobId, primaryJobId));
  const sourceIds = getCanonicalJobGroupIds(primaryJobId, links);
  const sources = await db
    .select()
    .from(jobs)
    .where(inArray(jobs.id, sourceIds));

  return {
    primaryJobId,
    sources: sources.sort((left, right) =>
      Number(right.id === primaryJobId) - Number(left.id === primaryJobId) || left.id - right.id
    ),
  };
}

/**
 * Source scans are only a hard stop when every platform carrying the
 * canonical job completed a clean scan with zero listings.
 */
export async function getAutonomousJobSourceEligibility(
  jobId: number
): Promise<AutonomousJobSourceEligibility> {
  const aggregation = await getJobAggregationSources(jobId);
  if (!aggregation) {
    return {
      eligible: true,
      sourcePlatformIds: [],
      emptySourcePlatformIds: [],
      staleEmptySourcePlatformIds: [],
      reason: null,
    };
  }

  const platformIds = Array.from(new Set(
    aggregation.sources
      .map((source) => source.platformId)
      .filter((platformId): platformId is number => typeof platformId === "number" && Number.isInteger(platformId) && platformId > 0)
  ));
  if (platformIds.length === 0) {
    return getAutonomousSourceEligibility(aggregation.sources, []);
  }
  const db = await getDb();
  const platforms = !db
    ? samplePlatforms.filter((platform) => platformIds.includes(platform.id))
    : await db
      .select({
        id: jobPlatforms.id,
        lastScraped: jobPlatforms.lastScraped,
        lastScrapeAttemptedAt: jobPlatforms.lastScrapeAttemptedAt,
        lastScrapeStatus: jobPlatforms.lastScrapeStatus,
        lastScrapeJobCount: jobPlatforms.lastScrapeJobCount,
      })
      .from(jobPlatforms)
      .where(inArray(jobPlatforms.id, platformIds));

  return getAutonomousSourceEligibility(aggregation.sources, platforms);
}

// User Profiles
export async function getUserProfile(userId: number) {
  const db = await getDb();
  if (!db) return memoryProfiles.get(userId);
  const result = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getProfilesWithAutonomousPreferences(afterUserId = 0, requestedLimit = 100) {
  const limit = Math.max(1, Math.min(250, Math.trunc(requestedLimit) || 100));
  const db = await getDb();
  if (!db) {
    return Array.from(memoryProfiles.values())
      .filter((profile) => {
        try {
          return JSON.parse(profile.preferences || "{}").autonomousEnabled === true;
        } catch {
          return false;
        }
      })
      .map((profile) => ({
        userId: profile.userId,
        preferences: profile.preferences,
      }))
      .filter((profile) => profile.userId > afterUserId)
      .sort((left, right) => left.userId - right.userId)
      .slice(0, limit);
  }

  return await db
    .select({
      userId: userProfiles.userId,
      preferences: userProfiles.preferences,
    })
    .from(userProfiles)
    .innerJoin(users, eq(userProfiles.userId, users.id))
    .where(and(
      gt(userProfiles.userId, afterUserId),
      eq(userProfiles.autonomousEnabled, 1),
      eq(users.accountStatus, "active"),
      sql`${users.tosAcceptedAt} IS NOT NULL`
    ))
    .orderBy(asc(userProfiles.userId))
    .limit(limit);
}

export async function getAutonomousUserEligibility(userId: number): Promise<{
  eligible: boolean;
  reason?: string;
}> {
  const db = await getDb();
  const user = !db
    ? memoryUsers.find((item) => item.id === userId)
    : (await db
      .select({
        accountStatus: users.accountStatus,
        tosAcceptedAt: users.tosAcceptedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1))[0];
  if (!user) return { eligible: false, reason: "User account was not found." };
  if (user.accountStatus !== "active") {
    return { eligible: false, reason: "Autonomous actions are disabled while the account is not active." };
  }
  if (!user.tosAcceptedAt) {
    return { eligible: false, reason: "Terms of Service acceptance is required before autonomous actions can run." };
  }
  return { eligible: true };
}

export async function acquireAutonomousRunLease(
  userId: number,
  leaseToken: string,
  minimumIntervalMs: number
) {
  const db = await getDb();
  const now = new Date();
  const intervalCutoff = new Date(now.getTime() - minimumIntervalMs);
  const leaseExpiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  if (!db) {
    const state = memoryAutonomousRuns.get(userId);
    const leaseAvailable = !state || state.leaseExpiresAt <= now.getTime();
    const intervalElapsed = !state || minimumIntervalMs === 0 || state.lastCompletedAt <= intervalCutoff.getTime();
    if (!leaseAvailable || !intervalElapsed) return false;

    memoryAutonomousRuns.set(userId, {
      leaseToken,
      leaseExpiresAt: leaseExpiresAt.getTime(),
      lastCompletedAt: state?.lastCompletedAt || 0,
      lastStartedAt: now.getTime(),
      lastStatus: "running",
      lastError: null,
      lastOutcomeDetail: null,
      lastRunSummary: state?.lastRunSummary || null,
    });
    return true;
  }

  const canAcquire = sql`(
    (${autonomousRunStates.leaseExpiresAt} IS NULL OR ${autonomousRunStates.leaseExpiresAt} <= ${now})
    AND (${minimumIntervalMs} = 0 OR ${autonomousRunStates.lastCompletedAt} IS NULL OR ${autonomousRunStates.lastCompletedAt} <= ${intervalCutoff})
  )`;
  await db
    .insert(autonomousRunStates)
    .values({
      userId,
      leaseToken,
      leaseExpiresAt,
      lastStartedAt: now,
      lastStatus: "running",
      lastError: null,
    })
    .onDuplicateKeyUpdate({
      set: {
        leaseToken: sql`IF(${canAcquire}, ${leaseToken}, ${autonomousRunStates.leaseToken})`,
        leaseExpiresAt: sql`IF(${canAcquire}, ${leaseExpiresAt}, ${autonomousRunStates.leaseExpiresAt})`,
        lastStartedAt: sql`IF(${canAcquire}, ${now}, ${autonomousRunStates.lastStartedAt})`,
        lastStatus: sql`IF(${canAcquire}, 'running', ${autonomousRunStates.lastStatus})`,
        lastError: sql`IF(${canAcquire}, NULL, ${autonomousRunStates.lastError})`,
        lastOutcomeDetail: sql`IF(${canAcquire}, NULL, ${autonomousRunStates.lastOutcomeDetail})`,
      },
    });

  const state = await db
    .select({ leaseToken: autonomousRunStates.leaseToken })
    .from(autonomousRunStates)
    .where(eq(autonomousRunStates.userId, userId))
    .limit(1);
  return state[0]?.leaseToken === leaseToken;
}

export async function completeAutonomousRunLease(
  userId: number,
  leaseToken: string,
  error?: string,
  lastRunSummary?: AutonomousRunSummaryRecord
) {
  const db = await getDb();
  if (!db) {
    const state = memoryAutonomousRuns.get(userId);
    if (state?.leaseToken !== leaseToken) return false;
    memoryAutonomousRuns.set(userId, {
      leaseToken: null,
      leaseExpiresAt: 0,
      lastCompletedAt: error ? state.lastCompletedAt : Date.now(),
      lastStartedAt: state.lastStartedAt,
      lastStatus: error ? "failed" : "completed",
      lastError: error?.slice(0, 2000) || null,
      lastOutcomeDetail: null,
      lastRunSummary: lastRunSummary ? JSON.stringify(lastRunSummary) : state.lastRunSummary,
    });
    return true;
  }

  const result = await db
    .update(autonomousRunStates)
    .set({
      leaseToken: null,
      leaseExpiresAt: null,
      lastCompletedAt: error ? sql`${autonomousRunStates.lastCompletedAt}` : new Date(),
      lastStatus: error ? "failed" : "completed",
      lastError: error?.slice(0, 2000) || null,
      lastOutcomeDetail: null,
      lastRunSummary: lastRunSummary
        ? JSON.stringify(lastRunSummary)
        : sql`${autonomousRunStates.lastRunSummary}`,
    })
    .where(and(
      eq(autonomousRunStates.userId, userId),
      eq(autonomousRunStates.leaseToken, leaseToken)
    ));
  return Number(result[0].affectedRows) > 0;
}

/** Release a claimed run that was disabled or paused before any autonomous work began. */
export async function skipAutonomousRunLease(
  userId: number,
  leaseToken: string,
  detail: string
) {
  const db = await getDb();
  const outcomeDetail = detail.slice(0, 2000);
  if (!db) {
    const state = memoryAutonomousRuns.get(userId);
    if (state?.leaseToken !== leaseToken) return false;
    memoryAutonomousRuns.set(userId, {
      leaseToken: null,
      leaseExpiresAt: 0,
      lastCompletedAt: state.lastCompletedAt,
      lastStartedAt: state.lastStartedAt,
      lastStatus: "skipped",
      lastError: null,
      lastOutcomeDetail: outcomeDetail,
      lastRunSummary: state.lastRunSummary,
    });
    return true;
  }

  const result = await db
    .update(autonomousRunStates)
    .set({
      leaseToken: null,
      leaseExpiresAt: null,
      lastStatus: "skipped",
      lastError: null,
      lastOutcomeDetail: outcomeDetail,
    })
    .where(and(
      eq(autonomousRunStates.userId, userId),
      eq(autonomousRunStates.leaseToken, leaseToken)
    ));
  return Number(result[0].affectedRows) > 0;
}

/** Resolve a reposted listing to the canonical job used by every user ledger. */
export async function getCanonicalJobId(jobId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    if (!sampleJobs.some((job) => job.id === jobId)) return null;
    return resolveCanonicalJobId(jobId, sampleJobDuplicateLinks);
  }

  let currentJobId = jobId;
  const visitedJobIds = new Set<number>();
  while (true) {
    if (visitedJobIds.has(currentJobId)) {
      throw new Error("Job duplicate links contain a cycle.");
    }
    visitedJobIds.add(currentJobId);

    const job = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, currentJobId))
      .limit(1);
    if (!job[0]) return null;

    const relations = await db
      .select({ primaryJobId: jobDuplicates.primaryJobId })
      .from(jobDuplicates)
      .where(eq(jobDuplicates.duplicateJobId, currentJobId))
      .limit(2);
    const primaryJobIds = Array.from(new Set(relations.map((relation) => relation.primaryJobId)));
    if (primaryJobIds.length === 0) return currentJobId;
    if (primaryJobIds.length > 1) {
      throw new Error("Job duplicate links assign more than one canonical listing.");
    }

    currentJobId = primaryJobIds[0];
  }
}

export async function getAutonomousRunState(userId: number): Promise<AutonomousRunStateSnapshot | null> {
  const db = await getDb();
  if (!db) {
    const state = memoryAutonomousRuns.get(userId);
    if (!state) return null;
    return {
      lastStartedAt: state.lastStartedAt ? new Date(state.lastStartedAt) : null,
      lastCompletedAt: state.lastCompletedAt ? new Date(state.lastCompletedAt) : null,
      lastStatus: state.lastStatus,
      lastError: state.lastError,
      lastOutcomeDetail: state.lastOutcomeDetail,
      lastRunSummary: parseAutonomousRunSummary(state.lastRunSummary),
    };
  }

  const result = await db
    .select({
      lastStartedAt: autonomousRunStates.lastStartedAt,
      lastCompletedAt: autonomousRunStates.lastCompletedAt,
      lastStatus: autonomousRunStates.lastStatus,
      lastError: autonomousRunStates.lastError,
      lastOutcomeDetail: autonomousRunStates.lastOutcomeDetail,
      lastRunSummary: autonomousRunStates.lastRunSummary,
    })
    .from(autonomousRunStates)
    .where(eq(autonomousRunStates.userId, userId))
    .limit(1);
  const state = result[0];
  if (!state) return null;
  return {
    lastStartedAt: state.lastStartedAt,
    lastCompletedAt: state.lastCompletedAt,
    lastStatus: state.lastStatus,
    lastError: state.lastError,
    lastOutcomeDetail: state.lastOutcomeDetail,
    lastRunSummary: parseAutonomousRunSummary(state.lastRunSummary),
  };
}

export async function renewAutonomousRunLease(userId: number, leaseToken: string) {
  const db = await getDb();
  const leaseExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  if (!db) {
    const state = memoryAutonomousRuns.get(userId);
    if (state?.leaseToken !== leaseToken) return false;
    state.leaseExpiresAt = leaseExpiresAt.getTime();
    return true;
  }

  const result = await db
    .update(autonomousRunStates)
    .set({ leaseExpiresAt })
    .where(and(
      eq(autonomousRunStates.userId, userId),
      eq(autonomousRunStates.leaseToken, leaseToken),
      eq(autonomousRunStates.lastStatus, "running")
    ));
  return Number(result[0].affectedRows) > 0;
}

function autonomousPreferenceEnabled(preferences: string | null | undefined) {
  try {
    return JSON.parse(preferences || "{}").autonomousEnabled === true ? 1 : 0;
  } catch {
    return 0;
  }
}

export async function upsertUserProfile(profile: InsertUserProfile) {
  const db = await getDb();
  if (!db) {
    const existing = memoryProfiles.get(profile.userId);
    memoryProfiles.set(profile.userId, {
      id: existing?.id || memoryProfiles.size + 1,
      userId: profile.userId,
      skills: profile.skills ?? existing?.skills ?? null,
      experience: profile.experience ?? existing?.experience ?? null,
      education: profile.education ?? existing?.education ?? null,
      preferences: profile.preferences ?? existing?.preferences ?? null,
      autonomousEnabled: profile.preferences !== undefined
        ? autonomousPreferenceEnabled(profile.preferences)
        : existing?.autonomousEnabled ?? 0,
      desiredJobTypes: profile.desiredJobTypes !== undefined ? profile.desiredJobTypes : existing?.desiredJobTypes ?? null,
      desiredLocations: profile.desiredLocations !== undefined ? profile.desiredLocations : existing?.desiredLocations ?? null,
      salaryExpectationMin: profile.salaryExpectationMin !== undefined ? profile.salaryExpectationMin : existing?.salaryExpectationMin ?? null,
      salaryExpectationMax: profile.salaryExpectationMax !== undefined ? profile.salaryExpectationMax : existing?.salaryExpectationMax ?? null,
      salaryExpectationCurrency: profile.salaryExpectationCurrency ?? existing?.salaryExpectationCurrency ?? "USD",
      resumeUrl: profile.resumeUrl !== undefined ? profile.resumeUrl : existing?.resumeUrl ?? null,
      resumeFileKey: profile.resumeFileKey !== undefined ? profile.resumeFileKey : existing?.resumeFileKey ?? null,
      linkedinUrl: profile.linkedinUrl !== undefined ? profile.linkedinUrl : existing?.linkedinUrl ?? null,
      githubUrl: profile.githubUrl !== undefined ? profile.githubUrl : existing?.githubUrl ?? null,
      portfolioUrl: profile.portfolioUrl !== undefined ? profile.portfolioUrl : existing?.portfolioUrl ?? null,
      diversityGroup: profile.diversityGroup ?? existing?.diversityGroup ?? null,
      needsVisaSponsorship: profile.needsVisaSponsorship ?? existing?.needsVisaSponsorship ?? 0,
      createdAt: existing?.createdAt || new Date(),
      updatedAt: new Date(),
    });
    return;
  }

  const normalizedProfile = profile.preferences === undefined
    ? profile
    : { ...profile, autonomousEnabled: autonomousPreferenceEnabled(profile.preferences) };
  const { id: _id, userId: _userId, ...updates } = normalizedProfile;
  await db
    .insert(userProfiles)
    .values(normalizedProfile)
    .onDuplicateKeyUpdate({
      set: Object.keys(updates).length > 0 ? updates : { userId: profile.userId },
    });
}

export async function patchUserProfilePreferences(
  userId: number,
  patch: Record<string, boolean | number | string>
) {
  const db = await getDb();
  if (!db) {
    const existing = memoryProfiles.get(userId);
    let current: Record<string, unknown> = {};
    try {
      const parsed = existing?.preferences ? JSON.parse(existing.preferences) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
    } catch {
      current = {};
    }
    const preferences = JSON.stringify({ ...current, ...patch });
    await upsertUserProfile({ userId, preferences });
    return preferences;
  }

  return db.transaction(async (tx) => {
    // Lock the stable owner row so concurrent tabs merge against the latest profile state.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const rows = await tx
      .select({ id: userProfiles.id, preferences: userProfiles.preferences })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    let current: Record<string, unknown> = {};
    try {
      const parsed = rows[0]?.preferences ? JSON.parse(rows[0].preferences) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
    } catch {
      current = {};
    }
    const preferences = JSON.stringify({ ...current, ...patch });
    const autonomousEnabled = autonomousPreferenceEnabled(preferences);
    if (rows[0]) {
      await tx.update(userProfiles).set({ preferences, autonomousEnabled }).where(eq(userProfiles.id, rows[0].id));
    } else {
      await tx.insert(userProfiles).values({ userId, preferences, autonomousEnabled });
    }
    return preferences;
  });
}

export const PUBLIC_SOCIAL_PLATFORMS = ["facebook", "twitter"] as const;
export type PublicSocialPlatform = typeof PUBLIC_SOCIAL_PLATFORMS[number];

function latestPublicSocialProfiles<T extends { platform: string }>(profiles: T[]) {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    if (seen.has(profile.platform)) return false;
    seen.add(profile.platform);
    return true;
  });
}

/**
 * Public social links are user-provided references only. They remain separate
 * from connector grants so no credentials or unconsented profile data enters
 * the operating ledger.
 */
export async function listPublicSocialProfiles(userId: number): Promise<SocialMediaProfile[]> {
  const db = await getDb();
  if (!db) {
    const profiles = memorySocialMediaProfiles
      .filter((profile) =>
        profile.userId === userId &&
        profile.isActive === 1 &&
        (profile.platform === "facebook" || profile.platform === "twitter")
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return latestPublicSocialProfiles(profiles) as SocialMediaProfile[];
  }

  const profiles = await db
    .select()
    .from(socialMediaProfiles)
    .where(and(
      eq(socialMediaProfiles.userId, userId),
      eq(socialMediaProfiles.isActive, 1),
      inArray(socialMediaProfiles.platform, PUBLIC_SOCIAL_PLATFORMS)
    ))
    .orderBy(desc(socialMediaProfiles.updatedAt));
  return latestPublicSocialProfiles(profiles);
}

export async function setPublicSocialProfile(input: {
  userId: number;
  platform: PublicSocialPlatform;
  profileUrl: string | null;
}): Promise<SocialMediaProfile | null> {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const matches = memorySocialMediaProfiles.filter((profile) =>
      profile.userId === input.userId && profile.platform === input.platform
    );
    if (input.profileUrl === null) {
      matches.forEach((profile) => {
        profile.isActive = 0;
        profile.updatedAt = now;
      });
      return null;
    }

    const existing = matches.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    if (existing) {
      matches.forEach((profile) => {
        profile.profileUrl = input.profileUrl!;
        profile.isActive = 1;
        profile.updatedAt = now;
      });
      return existing as SocialMediaProfile;
    }

    const created = {
      id: memorySocialMediaProfiles.length + 1,
      userId: input.userId,
      platform: input.platform,
      profileUrl: input.profileUrl,
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    } satisfies InsertSocialMediaProfile & { id: number; createdAt: Date; updatedAt: Date };
    memorySocialMediaProfiles.push(created);
    return created as SocialMediaProfile;
  }

  const write = await db
    .insert(socialMediaProfiles)
    .values({
      userId: input.userId,
      platform: input.platform,
      profileUrl: input.profileUrl,
      isActive: input.profileUrl === null ? 0 : 1,
    })
    .onDuplicateKeyUpdate({
      set: {
        id: sql`LAST_INSERT_ID(${socialMediaProfiles.id})`,
        profileUrl: input.profileUrl,
        isActive: input.profileUrl === null ? 0 : 1,
        updatedAt: now,
      },
    });

  if (input.profileUrl === null) return null;

  const id = Number(write[0].insertId);
  const profiles = await db
    .select()
    .from(socialMediaProfiles)
    .where(eq(socialMediaProfiles.id, id))
    .limit(1);
  return profiles[0] ?? null;
}

export async function listUserConnectorAccounts(userId: number): Promise<UserConnectorAccount[]> {
  const db = await getDb();
  if (!db) {
    return memoryConnectorAccounts
      .filter((account) => account.userId === userId)
      .map((account) => ({
        ...account,
        consentScopes: account.consentScopes ?? null,
        externalAccountLabel: account.externalAccountLabel ?? null,
        connectionRequestedAt: account.connectionRequestedAt ?? null,
        lastVerifiedAt: account.lastVerifiedAt ?? null,
        disconnectedAt: account.disconnectedAt ?? null,
      })) as UserConnectorAccount[];
  }

  return await db
    .select()
    .from(userConnectorAccounts)
    .where(eq(userConnectorAccounts.userId, userId));
}

export async function getUserConnectorAccount(
  userId: number,
  provider: UserConnectorAccount["provider"]
): Promise<UserConnectorAccount | undefined> {
  const db = await getDb();
  if (!db) {
    const account = memoryConnectorAccounts.find((item) =>
      item.userId === userId && item.provider === provider
    );
    return account ? {
      ...account,
      consentScopes: account.consentScopes ?? null,
      externalAccountLabel: account.externalAccountLabel ?? null,
      connectionRequestedAt: account.connectionRequestedAt ?? null,
      lastVerifiedAt: account.lastVerifiedAt ?? null,
      disconnectedAt: account.disconnectedAt ?? null,
    } as UserConnectorAccount : undefined;
  }

  const rows = await db
    .select()
    .from(userConnectorAccounts)
    .where(and(
      eq(userConnectorAccounts.userId, userId),
      eq(userConnectorAccounts.provider, provider)
    ))
    .limit(1);
  return rows[0];
}

export async function upsertUserConnectorAccount(account: InsertUserConnectorAccount) {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const existing = memoryConnectorAccounts.find((item) =>
      item.userId === account.userId && item.provider === account.provider
    );
    if (existing) {
      existing.status = account.status ?? existing.status;
      existing.consentScopes = account.consentScopes ?? existing.consentScopes ?? null;
      existing.externalAccountLabel = account.externalAccountLabel ?? existing.externalAccountLabel ?? null;
      existing.connectionRequestedAt = account.connectionRequestedAt ?? existing.connectionRequestedAt ?? null;
      existing.lastVerifiedAt = account.lastVerifiedAt ?? existing.lastVerifiedAt ?? null;
      existing.disconnectedAt = account.disconnectedAt ?? existing.disconnectedAt ?? null;
      existing.updatedAt = now;
      return existing;
    }

    const created = {
      id: memoryConnectorAccounts.length + 1,
      userId: account.userId,
      provider: account.provider,
      status: account.status ?? "not_connected",
      consentScopes: account.consentScopes ?? null,
      externalAccountLabel: account.externalAccountLabel ?? null,
      connectionRequestedAt: account.connectionRequestedAt ?? null,
      lastVerifiedAt: account.lastVerifiedAt ?? null,
      disconnectedAt: account.disconnectedAt ?? null,
      createdAt: now,
      updatedAt: now,
    } satisfies InsertUserConnectorAccount & { id: number; createdAt: Date; updatedAt: Date };
    memoryConnectorAccounts.push(created);
    return created;
  }

  await db
    .insert(userConnectorAccounts)
    .values(account)
    .onDuplicateKeyUpdate({
      set: {
        status: account.status ?? "not_connected",
        consentScopes: account.consentScopes ?? null,
        externalAccountLabel: account.externalAccountLabel ?? null,
        connectionRequestedAt: account.connectionRequestedAt ?? null,
        lastVerifiedAt: account.lastVerifiedAt ?? null,
        disconnectedAt: account.disconnectedAt ?? null,
        updatedAt: new Date(),
      },
    });

  const accounts = await db
    .select()
    .from(userConnectorAccounts)
    .where(and(
      eq(userConnectorAccounts.userId, account.userId),
      eq(userConnectorAccounts.provider, account.provider)
    ))
    .limit(1);
  return accounts[0];
}

export async function requestUserConnectorConnection(input: {
  userId: number;
  provider: InsertUserConnectorAccount["provider"];
  consentScopes: string[];
}) {
  return await upsertUserConnectorAccount({
    userId: input.userId,
    provider: input.provider,
    status: "connection_requested",
    consentScopes: JSON.stringify(input.consentScopes),
    externalAccountLabel: null,
    connectionRequestedAt: new Date(),
    lastVerifiedAt: null,
    disconnectedAt: null,
  });
}

export async function disconnectUserConnectorAccount(userId: number, provider: InsertUserConnectorAccount["provider"]) {
  return await upsertUserConnectorAccount({
    userId,
    provider,
    status: "disabled",
    disconnectedAt: new Date(),
  });
}

/** Server-only access to encrypted grants. Never return this from a tRPC procedure. */
export async function getConnectorAuthorization(
  userId: number,
  provider: InsertConnectorAuthorization["provider"]
): Promise<ConnectorAuthorization | null> {
  const db = await getDb();
  if (!db) {
    const authorization = memoryConnectorAuthorizations.find((item) =>
      item.userId === userId && item.provider === provider
    );
    return authorization ? authorization as ConnectorAuthorization : null;
  }
  const records = await db
    .select()
    .from(connectorAuthorizations)
    .where(and(
      eq(connectorAuthorizations.userId, userId),
      eq(connectorAuthorizations.provider, provider)
    ))
    .limit(1);
  return records[0] ?? null;
}

export async function upsertConnectorAuthorization(authorization: InsertConnectorAuthorization) {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const existing = memoryConnectorAuthorizations.find((item) =>
      item.userId === authorization.userId && item.provider === authorization.provider
    );
    if (existing) {
      existing.encryptedAccessToken = authorization.encryptedAccessToken;
      existing.encryptedRefreshToken = authorization.encryptedRefreshToken ?? existing.encryptedRefreshToken ?? null;
      existing.accessTokenExpiresAt = authorization.accessTokenExpiresAt ?? null;
      existing.tokenType = authorization.tokenType ?? null;
      existing.grantedScopes = authorization.grantedScopes ?? null;
      existing.updatedAt = now;
      return existing as ConnectorAuthorization;
    }

    const created = {
      id: memoryConnectorAuthorizations.length + 1,
      userId: authorization.userId,
      provider: authorization.provider,
      encryptedAccessToken: authorization.encryptedAccessToken,
      encryptedRefreshToken: authorization.encryptedRefreshToken ?? null,
      accessTokenExpiresAt: authorization.accessTokenExpiresAt ?? null,
      tokenType: authorization.tokenType ?? null,
      grantedScopes: authorization.grantedScopes ?? null,
      createdAt: now,
      updatedAt: now,
    } satisfies InsertConnectorAuthorization & { id: number; createdAt: Date; updatedAt: Date };
    memoryConnectorAuthorizations.push(created);
    return created as ConnectorAuthorization;
  }

  await db
    .insert(connectorAuthorizations)
    .values(authorization)
    .onDuplicateKeyUpdate({
      set: {
        encryptedAccessToken: authorization.encryptedAccessToken,
        encryptedRefreshToken: authorization.encryptedRefreshToken ?? sql`COALESCE(${connectorAuthorizations.encryptedRefreshToken}, NULL)`,
        accessTokenExpiresAt: authorization.accessTokenExpiresAt ?? null,
        tokenType: authorization.tokenType ?? null,
        grantedScopes: authorization.grantedScopes ?? null,
        updatedAt: now,
      },
    });

  const records = await db
    .select()
    .from(connectorAuthorizations)
    .where(and(
      eq(connectorAuthorizations.userId, authorization.userId),
      eq(connectorAuthorizations.provider, authorization.provider)
    ))
    .limit(1);
  return records[0];
}

export async function deleteConnectorAuthorization(
  userId: number,
  provider: InsertConnectorAuthorization["provider"] | "portfolio"
) {
  if (provider === "portfolio") return;
  const db = await getDb();
  if (!db) {
    const index = memoryConnectorAuthorizations.findIndex((item) =>
      item.userId === userId && item.provider === provider
    );
    if (index >= 0) memoryConnectorAuthorizations.splice(index, 1);
    return;
  }
  await db.delete(connectorAuthorizations).where(and(
    eq(connectorAuthorizations.userId, userId),
    eq(connectorAuthorizations.provider, provider)
  ));
}

// Applications
export async function createApplication(application: InsertApplication) {
  const canonicalJobId = await getCanonicalJobId(application.jobId);
  // Router entry points validate new user-facing job IDs. The storage helper
  // also serves historical-record reconciliation, where an old job row may no
  // longer be present in the in-memory fixture set.
  application = { ...application, jobId: canonicalJobId ?? application.jobId };
  const db = await getDb();
  if (!db) {
    const existing = memoryApplications.find((item) =>
      item.userId === application.userId && item.jobId === application.jobId
    );
    if (existing) {
      const currentStatus = existing.status || "pending";
      if (application.status === "applied" && currentStatus === "pending") {
        existing.status = "applied";
        existing.appliedDate = application.appliedDate || new Date();
        existing.lastActivity = new Date();
        existing.notes = application.notes ?? existing.notes;
        existing.coverLetter = application.coverLetter ?? existing.coverLetter;
        existing.customResume = application.customResume ?? existing.customResume;
        existing.isAutoApplied = application.isAutoApplied ?? existing.isAutoApplied;
        existing.updatedAt = new Date();
      } else if (application.status === "pending" && currentStatus === "withdrawn" && !existing.appliedDate) {
        existing.status = "pending";
        existing.lastActivity = new Date();
        existing.notes = application.notes ?? existing.notes;
        existing.coverLetter = application.coverLetter ?? existing.coverLetter;
        existing.customResume = application.customResume ?? existing.customResume;
        existing.isAutoApplied = application.isAutoApplied ?? existing.isAutoApplied;
        existing.updatedAt = new Date();
      } else if (application.status === "pending" && currentStatus === "pending") {
        existing.notes = application.notes ?? existing.notes;
        existing.coverLetter = application.coverLetter ?? existing.coverLetter;
        existing.customResume = application.customResume ?? existing.customResume;
        existing.isAutoApplied = application.isAutoApplied ?? existing.isAutoApplied;
        existing.updatedAt = new Date();
      }
      return { insertId: existing.id, existing: true };
    }

    const record = {
      ...application,
      id: memoryApplications.length + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryApplications.push(record);
    return { insertId: record.id };
  }

  const result = await db
    .insert(applications)
    .values(application)
    .onDuplicateKeyUpdate({
      set: {
        id: sql`LAST_INSERT_ID(${applications.id})`,
        appliedDate: sql`IF(${applications.status} = 'pending' AND VALUES(${applications.status}) = 'applied', COALESCE(VALUES(${applications.appliedDate}), NOW()), ${applications.appliedDate})`,
        lastActivity: sql`IF((${applications.status} = 'pending' AND VALUES(${applications.status}) = 'applied') OR (${applications.status} = 'withdrawn' AND ${applications.appliedDate} IS NULL AND VALUES(${applications.status}) = 'pending'), NOW(), ${applications.lastActivity})`,
        notes: sql`IF((${applications.status} = 'pending' AND VALUES(${applications.status}) IN ('pending', 'applied')) OR (${applications.status} = 'withdrawn' AND ${applications.appliedDate} IS NULL AND VALUES(${applications.status}) = 'pending'), COALESCE(VALUES(${applications.notes}), ${applications.notes}), ${applications.notes})`,
        coverLetter: sql`IF((${applications.status} = 'pending' AND VALUES(${applications.status}) IN ('pending', 'applied')) OR (${applications.status} = 'withdrawn' AND ${applications.appliedDate} IS NULL AND VALUES(${applications.status}) = 'pending'), COALESCE(VALUES(${applications.coverLetter}), ${applications.coverLetter}), ${applications.coverLetter})`,
        customResume: sql`IF((${applications.status} = 'pending' AND VALUES(${applications.status}) IN ('pending', 'applied')) OR (${applications.status} = 'withdrawn' AND ${applications.appliedDate} IS NULL AND VALUES(${applications.status}) = 'pending'), COALESCE(VALUES(${applications.customResume}), ${applications.customResume}), ${applications.customResume})`,
        isAutoApplied: sql`IF((${applications.status} = 'pending' AND VALUES(${applications.status}) IN ('pending', 'applied')) OR (${applications.status} = 'withdrawn' AND ${applications.appliedDate} IS NULL AND VALUES(${applications.status}) = 'pending'), COALESCE(VALUES(${applications.isAutoApplied}), ${applications.isAutoApplied}), ${applications.isAutoApplied})`,
        status: sql`IF(${applications.status} = 'pending' AND VALUES(${applications.status}) = 'applied', 'applied', IF(${applications.status} = 'withdrawn' AND ${applications.appliedDate} IS NULL AND VALUES(${applications.status}) = 'pending', 'pending', ${applications.status}))`,
      },
    });
  const writeResult = result[0];
  return {
    insertId: Number(writeResult.insertId),
    existing: Number(writeResult.affectedRows) !== 1,
  };
}

const userApplicationSelection = {
  id: applications.id,
  userId: applications.userId,
  jobId: applications.jobId,
  status: applications.status,
  appliedDate: applications.appliedDate,
  lastActivity: applications.lastActivity,
  coverLetter: applications.coverLetter,
  customResume: applications.customResume,
  notes: applications.notes,
  isAutoApplied: applications.isAutoApplied,
  createdAt: applications.createdAt,
  updatedAt: applications.updatedAt,
  job: {
    id: jobs.id,
    title: jobs.title,
    company: jobs.company,
    location: jobs.location,
    salaryMin: jobs.salaryMin,
    salaryMax: jobs.salaryMax,
    salaryCurrency: jobs.salaryCurrency,
    jobType: jobs.jobType,
    platformId: jobs.platformId,
    platformName: jobPlatforms.name,
    applicationUrl: jobs.applicationUrl,
    sourceUrl: jobs.sourceUrl,
  },
};

function projectMemoryApplication(application: (typeof memoryApplications)[number]) {
  const job = sampleJobs.find((item) => item.id === application.jobId);
  return {
    ...application,
    job: job ? {
      ...job,
      platformName: samplePlatforms.find((platform) => platform.id === job.platformId)?.name ?? null,
    } : undefined,
  };
}

export async function getUserApplicationById(userId: number, applicationId: number) {
  const db = await getDb();
  if (!db) {
    const application = memoryApplications.find((item) =>
      item.id === applicationId && item.userId === userId
    );
    return application ? projectMemoryApplication(application) : null;
  }

  const rows = await db
    .select(userApplicationSelection)
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(jobPlatforms, eq(jobs.platformId, jobPlatforms.id))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPendingUserApplicationForJob(userId: number, jobId: number) {
  const db = await getDb();
  if (!db) {
    const application = memoryApplications.find((item) =>
      item.userId === userId && item.jobId === jobId && item.status === "pending"
    );
    return application ? projectMemoryApplication(application) : null;
  }

  const rows = await db
    .select(userApplicationSelection)
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(jobPlatforms, eq(jobs.platformId, jobPlatforms.id))
    .where(and(
      eq(applications.userId, userId),
      eq(applications.jobId, jobId),
      eq(applications.status, "pending")
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserApplications(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryApplications
      .filter((application) => application.userId === userId)
      .map(projectMemoryApplication);
  }
  return await db
    .select(userApplicationSelection)
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(jobPlatforms, eq(jobs.platformId, jobPlatforms.id))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.createdAt), desc(applications.id));
}

export async function getUserApplicationStatusPage(
  userId: number,
  status: Application["status"],
  requestedAfterId = 0,
  requestedLimit = 250
) {
  const afterId = Math.max(0, Math.trunc(requestedAfterId));
  const limit = Math.min(500, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    const rows = memoryApplications
      .filter((application) =>
        application.userId === userId &&
        application.status === status &&
        application.id > afterId
      )
      .sort((left, right) => left.id - right.id)
      .slice(0, limit)
      .map(projectMemoryApplication);
    return {
      items: rows,
      limit,
      hasMore: rows.length === limit,
      nextAfterId: rows.at(-1)?.id ?? null,
    };
  }
  const rows = await db
    .select(userApplicationSelection)
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(jobPlatforms, eq(jobs.platformId, jobPlatforms.id))
    .where(and(
      eq(applications.userId, userId),
      eq(applications.status, status),
      gt(applications.id, afterId)
    ))
    .orderBy(asc(applications.id))
    .limit(limit);
  return {
    items: rows,
    limit,
    hasMore: rows.length === limit,
    nextAfterId: rows.at(-1)?.id ?? null,
  };
}

export async function getUserInboxMatchApplications(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryApplications
      .filter((application) => application.userId === userId)
      .map((application) => {
        const job = sampleJobs.find((item) => item.id === application.jobId);
        return {
          id: application.id,
          status: application.status,
          job: job ? { company: job.company, title: job.title } : null,
        };
      });
  }
  return await db
    .select({
      id: applications.id,
      status: applications.status,
      job: {
        company: jobs.company,
        title: jobs.title,
      },
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(eq(applications.userId, userId));
}

export type HaiStatusCounts = {
  applications: {
    total: number;
    prepared: number;
    submitted: number;
    interviews: number;
    offers: number;
  };
  pendingApprovals: number;
  connectedProviders: number;
  connectorsNeedingAttention: number;
  activeSuccessFees: number;
};

export async function getUserHaiStatusCounts(userId: number): Promise<HaiStatusCounts> {
  const db = await getDb();
  if (!db) {
    const userApplications = memoryApplications.filter((item) => item.userId === userId);
    return {
      applications: {
        total: userApplications.length,
        prepared: userApplications.filter((item) => item.status === "pending").length,
        submitted: userApplications.filter((item) => item.status !== "pending").length,
        interviews: userApplications.filter((item) => item.status === "interview").length,
        offers: userApplications.filter((item) => item.status === "offer" || item.status === "accepted").length,
      },
      pendingApprovals: memoryApplicationApprovals.filter((item) =>
        item.userId === userId && item.status === "pending"
      ).length,
      connectedProviders: memoryConnectorAccounts.filter((item) =>
        item.userId === userId && item.status === "connected"
      ).length,
      connectorsNeedingAttention: memoryConnectorAccounts.filter((item) =>
        item.userId === userId && ["needs_reauth", "connection_requested"].includes(item.status ?? "")
      ).length,
      activeSuccessFees: memorySuccessFees.filter((item) =>
        item.userId === userId && item.status === "active"
      ).length,
    };
  }

  const [applicationRows, approvalRows, connectorRows, feeRows] = await Promise.all([
    db.select({
      total: sql<number>`COUNT(*)`,
      prepared: sql<number>`COALESCE(SUM(${applications.status} = 'pending'), 0)`,
      submitted: sql<number>`COALESCE(SUM(${applications.status} <> 'pending'), 0)`,
      interviews: sql<number>`COALESCE(SUM(${applications.status} = 'interview'), 0)`,
      offers: sql<number>`COALESCE(SUM(${applications.status} IN ('offer', 'accepted')), 0)`,
    }).from(applications).where(eq(applications.userId, userId)),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(applicationApprovals)
      .where(and(eq(applicationApprovals.userId, userId), eq(applicationApprovals.status, "pending"))),
    db.select({
      connected: sql<number>`COALESCE(SUM(${userConnectorAccounts.status} = 'connected'), 0)`,
      needsAttention: sql<number>`COALESCE(SUM(${userConnectorAccounts.status} IN ('needs_reauth', 'connection_requested')), 0)`,
    }).from(userConnectorAccounts).where(eq(userConnectorAccounts.userId, userId)),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(successFees)
      .where(and(eq(successFees.userId, userId), eq(successFees.status, "active"))),
  ]);
  const applicationCounts = applicationRows[0];
  return {
    applications: {
      total: Number(applicationCounts.total),
      prepared: Number(applicationCounts.prepared),
      submitted: Number(applicationCounts.submitted),
      interviews: Number(applicationCounts.interviews),
      offers: Number(applicationCounts.offers),
    },
    pendingApprovals: Number(approvalRows[0].count),
    connectedProviders: Number(connectorRows[0].connected),
    connectorsNeedingAttention: Number(connectorRows[0].needsAttention),
    activeSuccessFees: Number(feeRows[0].count),
  };
}

export type ApplicationPageCursor = {
  createdAt: Date;
  id: number;
};

export async function getUserApplicationPage(
  userId: number,
  input: { limit?: number; cursor?: ApplicationPageCursor } = {}
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const db = await getDb();
  if (!db) {
    const ordered = memoryApplications
      .filter((application) => application.userId === userId)
      .sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id
      );
    const afterCursor = input.cursor
      ? ordered.filter((application) =>
          application.createdAt < input.cursor!.createdAt ||
          (application.createdAt.getTime() === input.cursor!.createdAt.getTime() && application.id < input.cursor!.id)
        )
      : ordered;
    const pageRows = afterCursor.slice(0, limit + 1);
    const hasMore = pageRows.length > limit;
    const items = pageRows.slice(0, limit).map(projectMemoryApplication);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    };
  }

  const cursorCondition = input.cursor
    ? or(
        lt(applications.createdAt, input.cursor.createdAt),
        and(
          eq(applications.createdAt, input.cursor.createdAt),
          lt(applications.id, input.cursor.id)
        )
      )
    : undefined;
  const rows = await db
    .select(userApplicationSelection)
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(jobPlatforms, eq(jobs.platformId, jobPlatforms.id))
    .where(and(eq(applications.userId, userId), cursorCondition))
    .orderBy(desc(applications.createdAt), desc(applications.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last
      ? { createdAt: last.createdAt, id: last.id }
      : null,
  };
}

const operatingApplicationStatuses: ApplicationStatus[] = [
  "pending",
  "applied",
  "viewed",
  "interview",
  "offer",
  "accepted",
];

function applicationActivityTime(application: {
  lastActivity?: Date | null;
  appliedDate?: Date | null;
  createdAt?: Date;
}) {
  return (application.lastActivity ?? application.appliedDate ?? application.createdAt ?? new Date(0)).getTime();
}

export async function getUserOperatingApplicationWindow(userId: number, requestedLimit = 250) {
  const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), 500);
  const db = await getDb();
  if (!db) {
    const rows = memoryApplications
      .filter((application) =>
        application.userId === userId &&
        operatingApplicationStatuses.includes(application.status ?? "pending")
      )
      .sort((left, right) =>
        applicationActivityTime(left) - applicationActivityTime(right) || left.id - right.id
      );
    return {
      items: rows.slice(0, limit).map(projectMemoryApplication),
      hasMore: rows.length > limit,
      limit,
    };
  }

  const activityAt = sql<Date>`COALESCE(${applications.lastActivity}, ${applications.appliedDate}, ${applications.createdAt})`;
  const rows = await db
    .select(userApplicationSelection)
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(jobPlatforms, eq(jobs.platformId, jobPlatforms.id))
    .where(and(
      eq(applications.userId, userId),
      inArray(applications.status, operatingApplicationStatuses)
    ))
    .orderBy(asc(activityAt), asc(applications.id))
    .limit(limit + 1);

  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
    limit,
  };
}

export async function getUserApplicationsForJobs(userId: number, requestedJobIds: number[]) {
  const jobIds = Array.from(new Set(requestedJobIds.filter((jobId) => Number.isInteger(jobId) && jobId > 0))).slice(0, 250);
  if (jobIds.length === 0) return [];

  const db = await getDb();
  if (!db) {
    const requested = new Set(jobIds);
    return memoryApplications
      .filter((application) => application.userId === userId && requested.has(application.jobId))
      .map(projectMemoryApplication);
  }

  return await db
    .select(userApplicationSelection)
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(jobPlatforms, eq(jobs.platformId, jobPlatforms.id))
    .where(and(
      eq(applications.userId, userId),
      inArray(applications.jobId, jobIds)
    ));
}

export async function getUserApplicationsByIds(userId: number, requestedApplicationIds: number[]) {
  const applicationIds = Array.from(new Set(
    requestedApplicationIds.filter((applicationId) => Number.isInteger(applicationId) && applicationId > 0)
  )).slice(0, 500);
  if (applicationIds.length === 0) return [];

  const db = await getDb();
  if (!db) {
    const requested = new Set(applicationIds);
    return memoryApplications
      .filter((application) => application.userId === userId && requested.has(application.id))
      .map(projectMemoryApplication);
  }
  return await db
    .select(userApplicationSelection)
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(jobPlatforms, eq(jobs.platformId, jobPlatforms.id))
    .where(and(
      eq(applications.userId, userId),
      inArray(applications.id, applicationIds)
    ));
}

export async function getUserAcceptedApplications(
  userId: number,
  options: { limit?: number; includeApplicationId?: number } = {}
) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 100);
  const db = await getDb();
  const sortAccepted = <T extends { lastActivity?: Date | null; createdAt: Date; id: number }>(rows: T[]) =>
    rows.sort((left, right) =>
      (right.lastActivity ?? right.createdAt).getTime() - (left.lastActivity ?? left.createdAt).getTime() ||
      right.id - left.id
    );

  if (!db) {
    const accepted = sortAccepted(memoryApplications
      .filter((application) => application.userId === userId && application.status === "accepted"))
      .slice(0, limit);
    const included = options.includeApplicationId
      ? memoryApplications.find((application) =>
          application.id === options.includeApplicationId &&
          application.userId === userId &&
          application.status === "accepted"
        )
      : undefined;
    return Array.from(new Map(
      [...(included ? [included] : []), ...accepted].map((application) => [application.id, projectMemoryApplication(application)])
    ).values());
  }

  const activityAt = sql<Date>`COALESCE(${applications.lastActivity}, ${applications.createdAt})`;
  const [accepted, included] = await Promise.all([
    db
      .select(userApplicationSelection)
      .from(applications)
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(jobPlatforms, eq(jobs.platformId, jobPlatforms.id))
      .where(and(eq(applications.userId, userId), eq(applications.status, "accepted")))
      .orderBy(desc(activityAt), desc(applications.id))
      .limit(limit),
    options.includeApplicationId
      ? getUserApplicationById(userId, options.includeApplicationId)
      : Promise.resolve(null),
  ]);
  return Array.from(new Map([
    ...(included?.status === "accepted" ? [[included.id, included] as const] : []),
    ...accepted.map((application) => [application.id, application] as const),
  ]).values());
}

export async function countUserAutonomousPreparationsSince(userId: number, since: Date) {
  const isAutonomousPreparation = (application: { isAutoApplied?: number | null; notes?: string | null }) => {
    const notes = application.notes?.toLowerCase() ?? "";
    return application.isAutoApplied === 1 || notes.includes("autonomous") || notes.includes("manual apply queue");
  };
  const db = await getDb();
  if (!db) {
    return memoryApplications.filter((application) =>
      application.userId === userId &&
      application.createdAt >= since &&
      isAutonomousPreparation(application)
    ).length;
  }

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(applications)
    .where(and(
      eq(applications.userId, userId),
      gte(applications.createdAt, since),
      or(
        eq(applications.isAutoApplied, 1),
        like(applications.notes, "%autonomous%"),
        like(applications.notes, "%manual apply queue%")
      )
    ));
  return Number(row?.count ?? 0);
}

export async function getUserApplicationSummary(userId: number) {
  const db = await getDb();
  if (!db) {
    const rows = memoryApplications.filter((application) => application.userId === userId);
    const submitted = rows.filter((application) => application.status !== "pending").length;
    return {
      total: rows.length,
      prepared: rows.filter((application) => application.status === "pending").length,
      active: rows.filter((application) => ["pending", "applied", "viewed", "interview"].includes(application.status ?? "pending")).length,
      responseMonitoring: rows.filter((application) =>
        ["applied", "viewed", "interview"].includes(application.status ?? "pending")
      ).length,
      submitted,
      responded: rows.filter((application) => !["pending", "applied"].includes(application.status ?? "pending")).length,
      responseSignals: rows.filter((application) => ["viewed", "interview", "offer", "accepted", "rejected"].includes(application.status ?? "pending")).length,
      interviewing: rows.filter((application) => ["interview", "offer", "accepted"].includes(application.status ?? "pending")).length,
      interview: rows.filter((application) => application.status === "interview").length,
      offered: rows.filter((application) => ["offer", "accepted"].includes(application.status ?? "pending")).length,
      closed: rows.filter((application) => ["rejected", "withdrawn"].includes(application.status ?? "pending")).length,
    };
  }

  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      prepared: sql<number>`COALESCE(SUM(${applications.status} = 'pending'), 0)`,
      active: sql<number>`COALESCE(SUM(${applications.status} IN ('pending', 'applied', 'viewed', 'interview')), 0)`,
      responseMonitoring: sql<number>`COALESCE(SUM(${applications.status} IN ('applied', 'viewed', 'interview')), 0)`,
      submitted: sql<number>`COALESCE(SUM(${applications.status} <> 'pending'), 0)`,
      responded: sql<number>`COALESCE(SUM(${applications.status} NOT IN ('pending', 'applied')), 0)`,
      responseSignals: sql<number>`COALESCE(SUM(${applications.status} IN ('viewed', 'interview', 'offer', 'accepted', 'rejected')), 0)`,
      interviewing: sql<number>`COALESCE(SUM(${applications.status} IN ('interview', 'offer', 'accepted')), 0)`,
      interview: sql<number>`COALESCE(SUM(${applications.status} = 'interview'), 0)`,
      offered: sql<number>`COALESCE(SUM(${applications.status} IN ('offer', 'accepted')), 0)`,
      closed: sql<number>`COALESCE(SUM(${applications.status} IN ('rejected', 'withdrawn')), 0)`,
    })
    .from(applications)
    .where(eq(applications.userId, userId));

  return Object.fromEntries(
    Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)])
  ) as {
    total: number;
    prepared: number;
    active: number;
    responseMonitoring: number;
    submitted: number;
    responded: number;
    responseSignals: number;
    interviewing: number;
    interview: number;
    offered: number;
    closed: number;
  };
}

export async function updateApplicationStatus(
  applicationId: number,
  status: ApplicationStatus,
  userId?: number
) {
  const db = await getDb();
  if (!db) {
    const application = memoryApplications.find((item) =>
      item.id === applicationId && (userId === undefined || item.userId === userId)
    );
    if (!application) throw new Error("Application not found.");
    const currentStatus = application.status || "pending";
    if (!canTransitionApplicationStatus(currentStatus, status)) {
      throw new Error(`Application cannot move from ${currentStatus} to ${status}.`);
    }
    if (currentStatus === status) return;
    application.status = status;
    if (status === "applied" && !application.appliedDate) {
      application.appliedDate = new Date();
    }
    application.lastActivity = new Date();
    application.updatedAt = new Date();
    return;
  }

  const conditions = userId === undefined
    ? eq(applications.id, applicationId)
    : and(eq(applications.id, applicationId), eq(applications.userId, userId));
  const existing = await db
    .select({
      status: applications.status,
      appliedDate: applications.appliedDate,
    })
    .from(applications)
    .where(conditions)
    .limit(1);
  if (!existing[0]) throw new Error("Application not found.");
  if (!canTransitionApplicationStatus(existing[0].status, status)) {
    throw new Error(`Application cannot move from ${existing[0].status} to ${status}.`);
  }
  if (existing[0].status === status) return;

  const result = await db
    .update(applications)
    .set({
      status,
      lastActivity: new Date(),
      ...(status === "applied" && !existing[0].appliedDate ? { appliedDate: new Date() } : {}),
    })
    .where(and(
      conditions,
      eq(applications.status, existing[0].status)
    ));
  if (Number(result[0].affectedRows) === 0) {
    throw new Error("Application status changed concurrently. Refresh and try again.");
  }
}

export async function createApplicationDecision(decision: InsertApplicationDecision) {
  const canonicalJobId = await getCanonicalJobId(decision.jobId);
  if (canonicalJobId === null) throw new Error("Job not found.");
  decision = { ...decision, jobId: canonicalJobId };
  const db = await getDb();
  if (!db) {
    const existing = memoryApplicationDecisions.find((item) =>
      item.userId === decision.userId && item.jobId === decision.jobId
    );
    if (existing) {
      existing.decision = decision.decision;
      existing.decisionReason = decision.decisionReason ?? existing.decisionReason ?? null;
      existing.matchScore = decision.matchScore ?? existing.matchScore ?? null;
      existing.riskLevel = decision.riskLevel ?? existing.riskLevel ?? "medium";
      existing.reviewRequired = decision.reviewRequired ?? existing.reviewRequired ?? 1;
      existing.reviewReason = decision.reviewReason ?? existing.reviewReason ?? null;
      existing.decidedBy = decision.decidedBy ?? existing.decidedBy ?? "system";
      existing.updatedAt = new Date();
      return { insertId: existing.id, existing: true };
    }

    const record = {
      ...decision,
      id: memoryApplicationDecisions.length + 1,
      decisionReason: decision.decisionReason ?? null,
      matchScore: decision.matchScore ?? null,
      riskLevel: decision.riskLevel ?? "medium",
      reviewRequired: decision.reviewRequired ?? 1,
      reviewReason: decision.reviewReason ?? null,
      decidedBy: decision.decidedBy ?? "system",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryApplicationDecisions.push(record);
    return { insertId: record.id };
  }

  const result = await db
    .insert(applicationDecisions)
    .values(decision)
    .onDuplicateKeyUpdate({
      set: {
        id: sql`LAST_INSERT_ID(${applicationDecisions.id})`,
        decision: sql`VALUES(${applicationDecisions.decision})`,
        decisionReason: sql`VALUES(${applicationDecisions.decisionReason})`,
        matchScore: sql`VALUES(${applicationDecisions.matchScore})`,
        riskLevel: sql`VALUES(${applicationDecisions.riskLevel})`,
        reviewRequired: sql`VALUES(${applicationDecisions.reviewRequired})`,
        reviewReason: sql`VALUES(${applicationDecisions.reviewReason})`,
        decidedBy: sql`VALUES(${applicationDecisions.decidedBy})`,
        updatedAt: new Date(),
      },
    });

  const writeResult = result[0];
  return {
    insertId: Number(writeResult.insertId),
    existing: Number(writeResult.affectedRows) !== 1,
  };
}

const userApplicationDecisionSelection = {
  id: applicationDecisions.id,
  userId: applicationDecisions.userId,
  jobId: applicationDecisions.jobId,
  decision: applicationDecisions.decision,
  decisionReason: applicationDecisions.decisionReason,
  matchScore: applicationDecisions.matchScore,
  riskLevel: applicationDecisions.riskLevel,
  reviewRequired: applicationDecisions.reviewRequired,
  reviewReason: applicationDecisions.reviewReason,
  decidedBy: applicationDecisions.decidedBy,
  createdAt: applicationDecisions.createdAt,
  updatedAt: applicationDecisions.updatedAt,
  job: {
    id: jobs.id,
    title: jobs.title,
    company: jobs.company,
    location: jobs.location,
    applicationUrl: jobs.applicationUrl,
    sourceUrl: jobs.sourceUrl,
  },
};

function projectMemoryApplicationDecision(decision: (typeof memoryApplicationDecisions)[number]) {
  return {
    ...decision,
    job: sampleJobs.find((job) => job.id === decision.jobId),
  };
}

export async function getUserApplicationDecisionForJob(userId: number, jobId: number) {
  const db = await getDb();
  if (!db) {
    const decision = memoryApplicationDecisions.find((item) =>
      item.userId === userId && item.jobId === jobId
    );
    return decision ? projectMemoryApplicationDecision(decision) : null;
  }

  const rows = await db
    .select(userApplicationDecisionSelection)
    .from(applicationDecisions)
    .leftJoin(jobs, eq(applicationDecisions.jobId, jobs.id))
    .where(and(
      eq(applicationDecisions.userId, userId),
      eq(applicationDecisions.jobId, jobId)
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserApplicationDecisions(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryApplicationDecisions
      .filter((decision) => decision.userId === userId)
      .map(projectMemoryApplicationDecision)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  return await db
    .select(userApplicationDecisionSelection)
    .from(applicationDecisions)
    .leftJoin(jobs, eq(applicationDecisions.jobId, jobs.id))
    .where(eq(applicationDecisions.userId, userId))
    .orderBy(desc(applicationDecisions.updatedAt));
}

export async function getUserApplicationDecisionsForJobs(userId: number, requestedJobIds: number[]) {
  const jobIds = Array.from(new Set(requestedJobIds.filter((jobId) => Number.isInteger(jobId) && jobId > 0))).slice(0, 250);
  if (jobIds.length === 0) return [];
  const db = await getDb();
  if (!db) {
    const requested = new Set(jobIds);
    return memoryApplicationDecisions
      .filter((decision) => decision.userId === userId && requested.has(decision.jobId))
      .map(projectMemoryApplicationDecision);
  }
  return await db
    .select(userApplicationDecisionSelection)
    .from(applicationDecisions)
    .leftJoin(jobs, eq(applicationDecisions.jobId, jobs.id))
    .where(and(
      eq(applicationDecisions.userId, userId),
      inArray(applicationDecisions.jobId, jobIds)
    ));
}

export async function getUserReviewDecisionPage(userId: number, requestedLimit = 100) {
  const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), 100);
  const isReviewDecision = (decision: { reviewRequired?: number; decision: ApplicationDecision["decision"] }) =>
    (decision.reviewRequired ?? 1) === 1 || ["review", "manual_apply"].includes(decision.decision);
  const db = await getDb();
  if (!db) {
    const rows = memoryApplicationDecisions
      .filter((decision) => decision.userId === userId && isReviewDecision(decision))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    return {
      items: rows.slice(0, limit).map(projectMemoryApplicationDecision),
      total: rows.length,
      hasMore: rows.length > limit,
      limit,
    };
  }
  const reviewCondition = or(
    eq(applicationDecisions.reviewRequired, 1),
    inArray(applicationDecisions.decision, ["review", "manual_apply"])
  );
  const [rows, countRows] = await Promise.all([
    db
      .select(userApplicationDecisionSelection)
      .from(applicationDecisions)
      .leftJoin(jobs, eq(applicationDecisions.jobId, jobs.id))
      .where(and(eq(applicationDecisions.userId, userId), reviewCondition))
      .orderBy(desc(applicationDecisions.updatedAt))
      .limit(limit + 1),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(applicationDecisions)
      .where(and(eq(applicationDecisions.userId, userId), reviewCondition)),
  ]);
  return {
    items: rows.slice(0, limit),
    total: Number(countRows[0]?.count ?? 0),
    hasMore: rows.length > limit,
    limit,
  };
}

export async function createApplicationMaterial(material: InsertApplicationMaterial) {
  const db = await getDb();
  if (!db) {
    const existing = memoryApplicationMaterials.find((item) =>
      item.applicationId === material.applicationId
    );
    if (existing) {
      existing.resumeId = material.resumeId ?? existing.resumeId ?? null;
      existing.customResume = material.customResume ?? existing.customResume ?? null;
      existing.coverLetter = material.coverLetter ?? existing.coverLetter ?? null;
      existing.customAnswers = material.customAnswers ?? existing.customAnswers ?? null;
      existing.claimsMade = material.claimsMade ?? existing.claimsMade ?? null;
      existing.sourceProfileSnapshot = material.sourceProfileSnapshot ?? existing.sourceProfileSnapshot ?? null;
      existing.updatedAt = new Date();
      return { insertId: existing.id, existing: true };
    }

    const record = {
      ...material,
      id: memoryApplicationMaterials.length + 1,
      resumeId: material.resumeId ?? null,
      customResume: material.customResume ?? null,
      coverLetter: material.coverLetter ?? null,
      customAnswers: material.customAnswers ?? null,
      claimsMade: material.claimsMade ?? null,
      sourceProfileSnapshot: material.sourceProfileSnapshot ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryApplicationMaterials.push(record);
    return { insertId: record.id };
  }

  const result = await db
    .insert(applicationMaterials)
    .values(material)
    .onDuplicateKeyUpdate({
      set: {
        id: sql`LAST_INSERT_ID(${applicationMaterials.id})`,
        resumeId: sql`COALESCE(VALUES(${applicationMaterials.resumeId}), ${applicationMaterials.resumeId})`,
        customResume: sql`COALESCE(VALUES(${applicationMaterials.customResume}), ${applicationMaterials.customResume})`,
        coverLetter: sql`COALESCE(VALUES(${applicationMaterials.coverLetter}), ${applicationMaterials.coverLetter})`,
        customAnswers: sql`COALESCE(VALUES(${applicationMaterials.customAnswers}), ${applicationMaterials.customAnswers})`,
        claimsMade: sql`COALESCE(VALUES(${applicationMaterials.claimsMade}), ${applicationMaterials.claimsMade})`,
        sourceProfileSnapshot: sql`COALESCE(VALUES(${applicationMaterials.sourceProfileSnapshot}), ${applicationMaterials.sourceProfileSnapshot})`,
        updatedAt: new Date(),
      },
    });

  const writeResult = result[0];
  return {
    insertId: Number(writeResult.insertId),
    existing: Number(writeResult.affectedRows) !== 1,
  };
}

export async function createApplicationAttempt(attempt: InsertApplicationAttempt) {
  const db = await getDb();
  if (!db) {
    const record = {
      ...attempt,
      id: memoryApplicationAttempts.length + 1,
      platformId: attempt.platformId ?? null,
      attemptType: attempt.attemptType ?? "prepare",
      status: attempt.status ?? "prepared",
      startedAt: attempt.startedAt ?? new Date(),
      finishedAt: attempt.finishedAt ?? null,
      errorMessage: attempt.errorMessage ?? null,
      confirmationText: attempt.confirmationText ?? null,
      confirmationUrl: attempt.confirmationUrl ?? null,
      screenshotKey: attempt.screenshotKey ?? null,
      retryCount: attempt.retryCount ?? 0,
      createdAt: new Date(),
    };
    memoryApplicationAttempts.push(record);
    return { insertId: record.id };
  }

  const result = await db.insert(applicationAttempts).values({
    attemptType: "prepare",
    status: "prepared",
    retryCount: 0,
    ...attempt,
  });
  return { insertId: Number(result[0].insertId) };
}

async function readApplicationLedgerArtifacts(applicationId: number, userId: number, bounded: boolean): Promise<{
  material: ApplicationMaterial | null;
  interviewPreparation: InterviewPreparation | null;
  attempts: ApplicationAttempt[];
  employerResponses: EmployerResponse[];
  auditEvents: AuditEvent[];
  hasMore: {
    attempts: boolean;
    employerResponses: boolean;
    auditEvents: boolean;
  };
}> {
  const db = await getDb();
  if (!db) {
    const application = memoryApplications.find((item) =>
      item.id === applicationId && item.userId === userId
    );
    if (!application) throw new Error("Application not found.");
    const material = memoryApplicationMaterials.find((item) => item.applicationId === applicationId) || null;
    const preparation = memoryInterviewPreparations.find((item) =>
      item.userId === userId && item.jobId === application.jobId
    ) || null;
    const attempts = memoryApplicationAttempts
      .filter((item) => item.applicationId === applicationId && item.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
    const responses = memoryEmployerResponses
      .filter((item) => item.applicationId === applicationId && item.userId === userId)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime() || b.id - a.id);
    const events = memoryAuditEvents
      .filter((item) => item.userId === userId && item.entityType === "application" && item.entityId === applicationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
    const attemptsWindow = bounded
      ? takeApplicationLedgerWindow(attempts, APPLICATION_LEDGER_WINDOW_LIMITS.attempts)
      : { items: attempts, hasMore: false };
    const responsesWindow = bounded
      ? takeApplicationLedgerWindow(responses, APPLICATION_LEDGER_WINDOW_LIMITS.employerResponses)
      : { items: responses, hasMore: false };
    const eventsWindow = bounded
      ? takeApplicationLedgerWindow(events, APPLICATION_LEDGER_WINDOW_LIMITS.auditEvents)
      : { items: events, hasMore: false };
    return {
      material: material as ApplicationMaterial | null,
      interviewPreparation: preparation as InterviewPreparation | null,
      attempts: attemptsWindow.items as ApplicationAttempt[],
      employerResponses: responsesWindow.items as EmployerResponse[],
      auditEvents: eventsWindow.items as AuditEvent[],
      hasMore: {
        attempts: attemptsWindow.hasMore,
        employerResponses: responsesWindow.hasMore,
        auditEvents: eventsWindow.hasMore,
      },
    };
  }

  const application = await db
    .select({ id: applications.id, jobId: applications.jobId })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);
  if (!application[0]) throw new Error("Application not found.");

  const attemptsQuery = db
    .select()
    .from(applicationAttempts)
    .where(and(
      eq(applicationAttempts.applicationId, applicationId),
      eq(applicationAttempts.userId, userId)
    ))
    .orderBy(desc(applicationAttempts.createdAt), desc(applicationAttempts.id));
  const responsesQuery = db
    .select()
    .from(employerResponses)
    .where(and(
      eq(employerResponses.applicationId, applicationId),
      eq(employerResponses.userId, userId)
    ))
    .orderBy(desc(employerResponses.receivedAt), desc(employerResponses.id));
  const eventsQuery = db
    .select()
    .from(auditEvents)
    .where(and(
      eq(auditEvents.userId, userId),
      eq(auditEvents.entityType, "application"),
      eq(auditEvents.entityId, applicationId)
    ))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));

  const [materialRows, preparationRows, attempts, responses, events] = await Promise.all([
    db
      .select()
      .from(applicationMaterials)
      .where(eq(applicationMaterials.applicationId, applicationId))
      .limit(1),
    db
      .select()
      .from(interviewPreparation)
      .where(and(
        eq(interviewPreparation.userId, userId),
        eq(interviewPreparation.jobId, application[0].jobId)
      ))
      .orderBy(desc(interviewPreparation.createdAt))
      .limit(1),
    bounded ? attemptsQuery.limit(APPLICATION_LEDGER_WINDOW_LIMITS.attempts + 1) : attemptsQuery,
    bounded ? responsesQuery.limit(APPLICATION_LEDGER_WINDOW_LIMITS.employerResponses + 1) : responsesQuery,
    bounded ? eventsQuery.limit(APPLICATION_LEDGER_WINDOW_LIMITS.auditEvents + 1) : eventsQuery,
  ]);

  const attemptsWindow = bounded
    ? takeApplicationLedgerWindow(attempts, APPLICATION_LEDGER_WINDOW_LIMITS.attempts)
    : { items: attempts, hasMore: false };
  const responsesWindow = bounded
    ? takeApplicationLedgerWindow(responses, APPLICATION_LEDGER_WINDOW_LIMITS.employerResponses)
    : { items: responses, hasMore: false };
  const eventsWindow = bounded
    ? takeApplicationLedgerWindow(events, APPLICATION_LEDGER_WINDOW_LIMITS.auditEvents)
    : { items: events, hasMore: false };

  return {
    material: materialRows[0] || null,
    interviewPreparation: preparationRows[0] || null,
    attempts: attemptsWindow.items,
    employerResponses: responsesWindow.items,
    auditEvents: eventsWindow.items,
    hasMore: {
      attempts: attemptsWindow.hasMore,
      employerResponses: responsesWindow.hasMore,
      auditEvents: eventsWindow.hasMore,
    },
  };
}

export async function getApplicationLedgerArtifacts(applicationId: number, userId: number) {
  return await readApplicationLedgerArtifacts(applicationId, userId, false);
}

export async function getApplicationLedgerArtifactWindow(applicationId: number, userId: number) {
  return await readApplicationLedgerArtifacts(applicationId, userId, true);
}

export async function createEmployerResponse(response: InsertEmployerResponse) {
  const db = await getDb();
  if (!db) {
    const record = {
      ...response,
      id: memoryEmployerResponses.length + 1,
      noteId: response.noteId ?? null,
      createdAt: new Date(),
    };
    memoryEmployerResponses.push(record);
    return { insertId: record.id };
  }

  const result = await db.insert(employerResponses).values(response);
  return { insertId: Number(result[0].insertId) };
}

export async function findEmployerResponseBySourceReference(input: {
  userId: number;
  source: EmployerResponse["source"];
  sourceReference: string;
}) {
  const db = await getDb();
  if (!db) {
    return memoryEmployerResponses.find((response) =>
      response.userId === input.userId &&
      response.source === input.source &&
      response.sourceReference === input.sourceReference
    ) as EmployerResponse | undefined;
  }

  const result = await db
    .select()
    .from(employerResponses)
    .where(and(
      eq(employerResponses.userId, input.userId),
      eq(employerResponses.source, input.source),
      eq(employerResponses.sourceReference, input.sourceReference)
    ))
    .limit(1);
  return result[0];
}

export async function findEmployerResponseSourceReferences(input: {
  userId: number;
  source: EmployerResponse["source"];
  sourceReferences: string[];
}) {
  const sourceReferences = Array.from(new Set(
    input.sourceReferences.filter((sourceReference) => sourceReference.length > 0)
  ));
  if (sourceReferences.length === 0) return [];

  const db = await getDb();
  if (!db) {
    const requested = new Set(sourceReferences);
    return Array.from(new Set(memoryEmployerResponses
      .filter((response) =>
        response.userId === input.userId &&
        response.source === input.source &&
        typeof response.sourceReference === "string" &&
        requested.has(response.sourceReference)
      )
      .map((response) => response.sourceReference as string)));
  }

  const rows = await db
    .select({ sourceReference: employerResponses.sourceReference })
    .from(employerResponses)
    .where(and(
      eq(employerResponses.userId, input.userId),
      eq(employerResponses.source, input.source),
      inArray(employerResponses.sourceReference, sourceReferences)
    ));
  return rows.flatMap((row) => row.sourceReference ? [row.sourceReference] : []);
}

export async function upsertInboxResponseCandidate(candidate: InsertInboxResponseCandidate) {
  const db = await getDb();
  if (!db) {
    const existing = memoryInboxResponseCandidates.find((item) =>
      item.userId === candidate.userId &&
      item.provider === candidate.provider &&
      item.messageId === candidate.messageId
    );
    if (existing) {
      return { candidate: existing as InboxResponseCandidate, existing: true };
    }
    const record = {
      ...candidate,
      id: memoryInboxResponseCandidates.length + 1,
      sender: candidate.sender ?? null,
      status: candidate.status ?? "pending",
      reviewedAt: candidate.reviewedAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryInboxResponseCandidates.push(record);
    return { candidate: record as InboxResponseCandidate, existing: false };
  }

  const existing = await db
    .select()
    .from(inboxResponseCandidates)
    .where(and(
      eq(inboxResponseCandidates.userId, candidate.userId),
      eq(inboxResponseCandidates.provider, candidate.provider),
      eq(inboxResponseCandidates.messageId, candidate.messageId)
    ))
    .limit(1);
  if (existing[0]) return { candidate: existing[0], existing: true };

  try {
    const result = await db.insert(inboxResponseCandidates).values(candidate);
    const inserted = await db
      .select()
      .from(inboxResponseCandidates)
      .where(eq(inboxResponseCandidates.id, Number(result[0].insertId)))
      .limit(1);
    return { candidate: inserted[0], existing: false };
  } catch (error) {
    const concurrent = await db
      .select()
      .from(inboxResponseCandidates)
      .where(and(
        eq(inboxResponseCandidates.userId, candidate.userId),
        eq(inboxResponseCandidates.provider, candidate.provider),
        eq(inboxResponseCandidates.messageId, candidate.messageId)
      ))
      .limit(1);
    if (concurrent[0]) return { candidate: concurrent[0], existing: true };
    throw error;
  }
}

export async function listPendingInboxResponseCandidates(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryInboxResponseCandidates
      .filter((candidate) => candidate.userId === userId && candidate.status === "pending")
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()) as InboxResponseCandidate[];
  }
  return await db
    .select()
    .from(inboxResponseCandidates)
    .where(and(
      eq(inboxResponseCandidates.userId, userId),
      eq(inboxResponseCandidates.status, "pending")
    ))
    .orderBy(desc(inboxResponseCandidates.receivedAt));
}

export async function getPendingInboxResponseCandidatePage(userId: number, requestedLimit = 100) {
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100);
  const db = await getDb();
  if (!db) {
    const rows = memoryInboxResponseCandidates
      .filter((candidate) => candidate.userId === userId && candidate.status === "pending")
      .sort((left, right) =>
        right.receivedAt.getTime() - left.receivedAt.getTime() || right.id - left.id
      ) as InboxResponseCandidate[];
    const ownedApplications: Array<Awaited<ReturnType<typeof getUserApplicationsByIds>>[number]> = [];
    const applicationIds = Array.from(new Set(rows.map((candidate) => candidate.applicationId)));
    for (let offset = 0; offset < applicationIds.length; offset += 500) {
      ownedApplications.push(...await getUserApplicationsByIds(userId, applicationIds.slice(offset, offset + 500)));
    }
    const applicationsById = new Map(ownedApplications.map((application) => [application.id, application]));
    const ownedRows = rows.filter((candidate) => applicationsById.has(candidate.applicationId));
    const pageRows = ownedRows.slice(0, limit);
    return {
      items: pageRows.flatMap((candidate) => {
        const application = applicationsById.get(candidate.applicationId);
        if (!application) return [];
        return [{
          ...candidate,
          job: application.job?.id != null ? application.job as Job : null,
        }];
      }),
      total: ownedRows.length,
      limit,
      hasMore: ownedRows.length > limit,
    };
  }
  const condition = and(
    eq(inboxResponseCandidates.userId, userId),
    eq(inboxResponseCandidates.status, "pending"),
    eq(applications.userId, userId)
  );
  const [rows, totalRows] = await Promise.all([
    db
      .select({ candidate: inboxResponseCandidates, job: jobs })
      .from(inboxResponseCandidates)
      .innerJoin(applications, and(
        eq(inboxResponseCandidates.applicationId, applications.id),
        eq(inboxResponseCandidates.userId, applications.userId)
      ))
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .where(condition)
      .orderBy(desc(inboxResponseCandidates.receivedAt))
      .limit(limit),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(inboxResponseCandidates)
      .innerJoin(applications, and(
        eq(inboxResponseCandidates.applicationId, applications.id),
        eq(inboxResponseCandidates.userId, applications.userId)
      ))
      .where(condition),
  ]);
  const total = Number(totalRows[0]?.count ?? 0);
  const items = rows.map((row) => ({ ...row.candidate, job: row.job ?? null }));
  return { items, total, limit, hasMore: total > items.length };
}

export async function getInboxResponseCandidate(candidateId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryInboxResponseCandidates.find((candidate) =>
      candidate.id === candidateId && candidate.userId === userId
    ) as InboxResponseCandidate | undefined;
  }
  const candidate = await db
    .select()
    .from(inboxResponseCandidates)
    .where(and(
      eq(inboxResponseCandidates.id, candidateId),
      eq(inboxResponseCandidates.userId, userId)
    ))
    .limit(1);
  return candidate[0];
}

export async function resolveInboxResponseCandidate(input: {
  id: number;
  userId: number;
  status: "confirmed" | "dismissed";
}) {
  const db = await getDb();
  const reviewedAt = new Date();
  if (!db) {
    const candidate = memoryInboxResponseCandidates.find((item) =>
      item.id === input.id && item.userId === input.userId
    );
    if (!candidate) return null;
    if (candidate.status !== "pending") return candidate as InboxResponseCandidate;
    candidate.status = input.status;
    candidate.reviewedAt = reviewedAt;
    candidate.updatedAt = reviewedAt;
    return candidate as InboxResponseCandidate;
  }
  await db
    .update(inboxResponseCandidates)
    .set({ status: input.status, reviewedAt })
    .where(and(
      eq(inboxResponseCandidates.id, input.id),
      eq(inboxResponseCandidates.userId, input.userId),
      eq(inboxResponseCandidates.status, "pending")
    ));
  const candidate = await db
    .select()
    .from(inboxResponseCandidates)
    .where(and(
      eq(inboxResponseCandidates.id, input.id),
      eq(inboxResponseCandidates.userId, input.userId)
    ))
    .limit(1);
  return candidate[0] ?? null;
}

export async function resolveInboxResponseCandidateBySourceReference(input: {
  userId: number;
  provider: "gmail" | "outlook";
  messageId: string;
  status: "confirmed" | "dismissed";
}) {
  const db = await getDb();
  const reviewedAt = new Date();
  if (!db) {
    const candidate = memoryInboxResponseCandidates.find((item) =>
      item.userId === input.userId && item.provider === input.provider && item.messageId === input.messageId
    );
    if (!candidate) return null;
    if (candidate.status !== "pending") return candidate as InboxResponseCandidate;
    candidate.status = input.status;
    candidate.reviewedAt = reviewedAt;
    candidate.updatedAt = reviewedAt;
    return candidate as InboxResponseCandidate;
  }
  await db
    .update(inboxResponseCandidates)
    .set({ status: input.status, reviewedAt })
    .where(and(
      eq(inboxResponseCandidates.userId, input.userId),
      eq(inboxResponseCandidates.provider, input.provider),
      eq(inboxResponseCandidates.messageId, input.messageId),
      eq(inboxResponseCandidates.status, "pending")
    ));
  const candidate = await db
    .select()
    .from(inboxResponseCandidates)
    .where(and(
      eq(inboxResponseCandidates.userId, input.userId),
      eq(inboxResponseCandidates.provider, input.provider),
      eq(inboxResponseCandidates.messageId, input.messageId)
    ))
    .limit(1);
  return candidate[0] ?? null;
}

export async function getEmployerResponses(applicationId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const application = memoryApplications.find((item) =>
      item.id === applicationId && item.userId === userId
    );
    if (!application) throw new Error("Application not found.");
    return memoryEmployerResponses
      .filter((response) => response.applicationId === applicationId && response.userId === userId)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()) as EmployerResponse[];
  }

  const application = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);
  if (!application[0]) throw new Error("Application not found.");

  return await db
    .select()
    .from(employerResponses)
    .where(and(
      eq(employerResponses.applicationId, applicationId),
      eq(employerResponses.userId, userId)
    ))
    .orderBy(desc(employerResponses.receivedAt));
}

export async function getRecentEmployerResponses(
  applicationId: number,
  userId: number,
  requestedLimit = 25
) {
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    return (await getEmployerResponses(applicationId, userId)).slice(0, limit);
  }
  const application = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);
  if (!application[0]) throw new Error("Application not found.");
  return await db
    .select()
    .from(employerResponses)
    .where(and(
      eq(employerResponses.applicationId, applicationId),
      eq(employerResponses.userId, userId)
    ))
    .orderBy(desc(employerResponses.receivedAt), desc(employerResponses.id))
    .limit(limit);
}

export async function getEmployerResponseReplyTarget(
  applicationId: number,
  userId: number,
  responseId?: number
) {
  const replyableTypes: EmployerResponse["responseType"][] = ["employer_question", "other"];
  const db = await getDb();
  if (!db) {
    const responses = memoryEmployerResponses
      .filter((response) =>
        response.applicationId === applicationId &&
        response.userId === userId &&
        (responseId === undefined || response.id === responseId)
      )
      .sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime());
    return responseId === undefined
      ? responses.find((response) => replyableTypes.includes(response.responseType)) as EmployerResponse | undefined
      : responses[0] as EmployerResponse | undefined;
  }

  const conditions: SQL[] = [
    eq(employerResponses.applicationId, applicationId),
    eq(employerResponses.userId, userId),
  ];
  if (responseId === undefined) {
    conditions.push(inArray(employerResponses.responseType, replyableTypes));
  } else {
    conditions.push(eq(employerResponses.id, responseId));
  }

  const rows = await db
    .select()
    .from(employerResponses)
    .where(and(...conditions))
    .orderBy(desc(employerResponses.receivedAt))
    .limit(1);
  return rows[0];
}

export async function getUserEmployerResponsesForApplications(
  userId: number,
  applicationIds: number[]
) {
  const boundedApplicationIds = Array.from(new Set(
    applicationIds.filter((applicationId) => Number.isInteger(applicationId) && applicationId > 0)
  ));
  if (boundedApplicationIds.length === 0) return [] as EmployerResponse[];
  const requestedApplicationIds = new Set(boundedApplicationIds);

  const db = await getDb();
  if (!db) {
    const ownedApplicationIds = new Set(
      memoryApplications
        .filter((application) =>
          application.userId === userId && requestedApplicationIds.has(application.id)
        )
        .map((application) => application.id)
    );
    return memoryEmployerResponses
      .filter((response) =>
        response.userId === userId && ownedApplicationIds.has(response.applicationId)
      )
      .sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime()) as EmployerResponse[];
  }

  const rows = await db
    .select({ response: employerResponses })
    .from(employerResponses)
    .innerJoin(applications, and(
      eq(employerResponses.applicationId, applications.id),
      eq(employerResponses.userId, applications.userId)
    ))
    .where(and(
      eq(applications.userId, userId),
      inArray(applications.id, boundedApplicationIds)
    ))
    .orderBy(desc(employerResponses.receivedAt));
  return rows.map((row) => row.response);
}

export async function createInterviewNotification(input: {
  userId: number;
  applicationId: number;
  employerResponseId: number;
}) {
  const db = await getDb();
  if (!db) {
    const response = (await getEmployerResponses(input.applicationId, input.userId))
      .find((item) => item.id === input.employerResponseId);
    if (!response || response.responseType !== "interview_invite") {
      throw new Error("Interview notifications require a recorded interview invitation for the same application.");
    }

    const existing = memoryApplicationNotifications.find((notification) =>
      notification.employerResponseId === input.employerResponseId
    );
    if (existing) {
      return { notification: existing as ApplicationNotification, existing: true };
    }

    const notification = {
      id: memoryApplicationNotifications.length + 1,
      userId: input.userId,
      applicationId: input.applicationId,
      employerResponseId: input.employerResponseId,
      notificationType: "interview_invite" as const,
      readAt: null,
      createdAt: new Date(),
    };
    memoryApplicationNotifications.push(notification);
    return { notification: notification as ApplicationNotification, existing: false };
  }

  const eligibleResponse = await db
    .select({ id: employerResponses.id })
    .from(employerResponses)
    .where(and(
      eq(employerResponses.id, input.employerResponseId),
      eq(employerResponses.applicationId, input.applicationId),
      eq(employerResponses.userId, input.userId),
      eq(employerResponses.responseType, "interview_invite")
    ))
    .limit(1);
  if (!eligibleResponse[0]) {
    throw new Error("Interview notifications require a recorded interview invitation for the same application.");
  }

  const result = await db
    .insert(applicationNotifications)
    .values({
      userId: input.userId,
      applicationId: input.applicationId,
      employerResponseId: input.employerResponseId,
      notificationType: "interview_invite",
    })
    .onDuplicateKeyUpdate({
      set: { id: sql`LAST_INSERT_ID(${applicationNotifications.id})` },
    });
  const notifications = await db
    .select()
    .from(applicationNotifications)
    .where(eq(applicationNotifications.id, Number(result[0].insertId)))
    .limit(1);
  return {
    notification: notifications[0],
    existing: Number(result[0].affectedRows) !== 1,
  };
}

export async function listUnreadInterviewNotifications(userId: number, limit = 25) {
  const db = await getDb();
  const boundedLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  if (!db) {
    return memoryApplicationNotifications
      .filter((notification) => notification.userId === userId && !notification.readAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, boundedLimit) as ApplicationNotification[];
  }

  return await db
    .select()
    .from(applicationNotifications)
    .where(and(
      eq(applicationNotifications.userId, userId),
      isNull(applicationNotifications.readAt)
    ))
    .orderBy(desc(applicationNotifications.createdAt))
    .limit(boundedLimit);
}

export async function markInterviewNotificationRead(notificationId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const notification = memoryApplicationNotifications.find((item) =>
      item.id === notificationId && item.userId === userId
    );
    if (!notification) return null;
    if (notification.readAt) {
      return { notification: notification as ApplicationNotification, changed: false };
    }
    notification.readAt = new Date();
    return { notification: notification as ApplicationNotification, changed: true };
  }

  const notification = await db
    .select()
    .from(applicationNotifications)
    .where(and(
      eq(applicationNotifications.id, notificationId),
      eq(applicationNotifications.userId, userId)
    ))
    .limit(1);
  if (!notification[0]) return null;
  if (notification[0].readAt) {
    return { notification: notification[0], changed: false };
  }

  await db
    .update(applicationNotifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(applicationNotifications.id, notificationId),
      eq(applicationNotifications.userId, userId),
      isNull(applicationNotifications.readAt)
    ));
  const updated = await db
    .select()
    .from(applicationNotifications)
    .where(eq(applicationNotifications.id, notificationId))
    .limit(1);
  return { notification: updated[0], changed: true };
}

export async function markUnreadInterviewNotificationsReadForApplication(applicationId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const notificationIds = memoryApplicationNotifications
      .filter((notification) =>
        notification.applicationId === applicationId &&
        notification.userId === userId &&
        !notification.readAt
      )
      .map((notification) => {
        notification.readAt = new Date();
        return notification.id;
      });
    return { notificationIds };
  }

  const notifications = await db
    .select({ id: applicationNotifications.id })
    .from(applicationNotifications)
    .where(and(
      eq(applicationNotifications.applicationId, applicationId),
      eq(applicationNotifications.userId, userId),
      isNull(applicationNotifications.readAt)
    ));
  const notificationIds = notifications.map((notification) => notification.id);
  if (notificationIds.length > 0) {
    await db
      .update(applicationNotifications)
      .set({ readAt: new Date() })
      .where(and(
        inArray(applicationNotifications.id, notificationIds),
        isNull(applicationNotifications.readAt)
      ));
  }
  return { notificationIds };
}

function parseApprovalPayload(payload?: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

interface OfferAttributionReviewData {
  approvals?: ApplicationApproval[];
  applications?: Array<Awaited<ReturnType<typeof getUserApplications>>[number]>;
  employerResponses?: EmployerResponse[];
}

export async function getUserOfferAttributionReviews(
  userId: number,
  supplied: OfferAttributionReviewData = {}
) {
  const [approvalRows, applicationRows] = await Promise.all([
    supplied.approvals ?? listUserApplicationApprovals(userId, "pending"),
    supplied.applications ?? getUserApplications(userId),
  ]);
  const approvals = approvalRows.filter((approval) =>
    approval.userId === userId &&
    approval.status === "pending" &&
    approval.approvalType === "offer_attribution"
  );
  const userApplications = applicationRows.filter((application) => application.userId === userId);
  const applicationsById = new Map(
    userApplications.map((application) => [application.id, application] as const)
  );
  const applicationIds = Array.from(new Set(approvals.flatMap((approval) => {
    const applicationId = approval.applicationId ??
      (approval.entityType === "application" ? approval.entityId : null);
    return applicationId && applicationsById.has(applicationId) ? [applicationId] : [];
  })));
  const requestedApplicationIds = new Set(applicationIds);
  const responses = supplied.employerResponses
    ? supplied.employerResponses.filter((response) =>
        response.userId === userId && requestedApplicationIds.has(response.applicationId)
      )
    : await getUserEmployerResponsesForApplications(userId, applicationIds);
  const responsesByApplication = new Map<number, EmployerResponse[]>();
  for (const response of responses) {
    const existing = responsesByApplication.get(response.applicationId) ?? [];
    existing.push(response);
    responsesByApplication.set(response.applicationId, existing);
  }

  const reviews = approvals.map((approval) => {
    const applicationId = approval.applicationId ??
      (approval.entityType === "application" ? approval.entityId : null);
    const application = applicationId ? applicationsById.get(applicationId) ?? null : null;
    const payload = parseApprovalPayload(approval.payload);
    let response: EmployerResponse | null = null;
    if (applicationId && application) {
      const applicationResponses = responsesByApplication.get(applicationId) ?? [];
      const responseId = payload && typeof payload.responseId === "number" &&
        Number.isInteger(payload.responseId) && payload.responseId > 0
        ? payload.responseId
        : null;
      response = responseId
        ? applicationResponses.find((item) => item.id === responseId && item.responseType === "offer") ?? null
        : applicationResponses.find((item) => item.responseType === "offer") ?? null;
    }

    if (application && !isOfferEligibleApplicationStatus(application.status)) {
      return null;
    }

    return {
      approval,
      application,
      latestEmployerResponse: response,
      payload,
      recommendedAction: "report_hire" as const,
    };
  });

  return reviews.filter((review) => review !== null);
}

export async function getUserOfferAttributionReviewsForApplications(
  userId: number,
  requestedApplicationIds: number[]
) {
  const applicationIds = Array.from(new Set(
    requestedApplicationIds.filter((applicationId) => Number.isInteger(applicationId) && applicationId > 0)
  )).slice(0, 250);
  if (applicationIds.length === 0) return [];

  const requested = new Set(applicationIds);
  const [applicationRows, approvalRows] = await Promise.all([
    getUserApplicationsByIds(userId, applicationIds),
    (async () => {
      const db = await getDb();
      if (!db) {
        return memoryApplicationApprovals
          .filter((approval) =>
            approval.userId === userId &&
            approval.status === "pending" &&
            approval.approvalType === "offer_attribution" &&
            ((approval.applicationId != null && requested.has(approval.applicationId)) ||
              (approval.entityType === "application" && requested.has(approval.entityId)))
          )
          .sort((left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id
          )
          .slice(0, 500) as ApplicationApproval[];
      }
      return await db
        .select()
        .from(applicationApprovals)
        .where(and(
          eq(applicationApprovals.userId, userId),
          eq(applicationApprovals.status, "pending"),
          eq(applicationApprovals.approvalType, "offer_attribution"),
          or(
            inArray(applicationApprovals.applicationId, applicationIds),
            and(
              eq(applicationApprovals.entityType, "application"),
              inArray(applicationApprovals.entityId, applicationIds)
            )
          )
        ))
        .orderBy(desc(applicationApprovals.createdAt), desc(applicationApprovals.id))
        .limit(500);
    })(),
  ]);

  return await getUserOfferAttributionReviews(userId, {
    approvals: approvalRows,
    applications: applicationRows,
  });
}

export async function getUserOfferAttributionReviewPage(userId: number, requestedLimit = 5) {
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  type OfferReviewApplication = Pick<Application, "id" | "userId" | "jobId" | "status"> & {
    job?: Job;
  };
  let approvalRows: ApplicationApproval[];
  let applicationRows: OfferReviewApplication[];
  let total: number;

  if (!db) {
    const pendingApprovals = memoryApplicationApprovals
      .filter((approval) =>
        approval.userId === userId &&
        approval.status === "pending" &&
        approval.approvalType === "offer_attribution"
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id);
    const candidateApplicationIds = Array.from(new Set(pendingApprovals.flatMap((approval) => {
      const applicationId = approval.applicationId ??
        (approval.entityType === "application" ? approval.entityId : null);
      return applicationId ? [applicationId] : [];
    })));
    const ownedApplications: Array<Awaited<ReturnType<typeof getUserApplicationsByIds>>[number]> = [];
    for (let offset = 0; offset < candidateApplicationIds.length; offset += 500) {
      ownedApplications.push(...await getUserApplicationsByIds(
        userId,
        candidateApplicationIds.slice(offset, offset + 500)
      ));
    }
    const eligibleApplicationsById = new Map(ownedApplications
      .filter((application) => isOfferEligibleApplicationStatus(application.status))
      .map((application) => [application.id, application] as const));
    const eligibleApprovals = pendingApprovals.filter((approval) => {
      const applicationId = approval.applicationId ??
        (approval.entityType === "application" ? approval.entityId : null);
      return applicationId != null && eligibleApplicationsById.has(applicationId);
    });
    total = eligibleApprovals.length;
    approvalRows = eligibleApprovals.slice(0, limit) as ApplicationApproval[];
    applicationRows = approvalRows.flatMap((approval) => {
      const applicationId = approval.applicationId ??
        (approval.entityType === "application" ? approval.entityId : null);
      const application = applicationId ? eligibleApplicationsById.get(applicationId) : undefined;
      return application ? [{
        id: application.id,
        userId: application.userId,
        jobId: application.jobId,
        status: application.status || "pending",
        job: application.job?.id != null ? application.job as Job : undefined,
      }] : [];
    });
  } else {
    const condition = and(
      eq(applicationApprovals.userId, userId),
      eq(applicationApprovals.status, "pending"),
      eq(applicationApprovals.approvalType, "offer_attribution"),
      eq(applications.userId, userId),
      inArray(applications.status, ["offer", "accepted"])
    );
    const [rows, countRows] = await Promise.all([
      db
        .select({ approval: applicationApprovals, application: applications, job: jobs })
        .from(applicationApprovals)
        .innerJoin(applications, and(
          sql`${applications.id} = COALESCE(
            ${applicationApprovals.applicationId},
            CASE WHEN ${applicationApprovals.entityType} = 'application' THEN ${applicationApprovals.entityId} END
          )`,
          eq(applicationApprovals.userId, applications.userId)
        ))
        .leftJoin(jobs, eq(applications.jobId, jobs.id))
        .where(condition)
        .orderBy(desc(applicationApprovals.createdAt), desc(applicationApprovals.id))
        .limit(limit),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(applicationApprovals)
        .innerJoin(applications, and(
          sql`${applications.id} = COALESCE(
            ${applicationApprovals.applicationId},
            CASE WHEN ${applicationApprovals.entityType} = 'application' THEN ${applicationApprovals.entityId} END
          )`,
          eq(applicationApprovals.userId, applications.userId)
        ))
        .where(condition),
    ]);
    total = Number(countRows[0]?.count ?? 0);
    approvalRows = rows.map((row) => row.approval);
    applicationRows = rows.map((row) => ({
      id: row.application.id,
      userId: row.application.userId,
      jobId: row.application.jobId,
      status: row.application.status,
      job: row.job ?? undefined,
    }));
  }

  const applicationsById = new Map(applicationRows.map((application) => [application.id, application] as const));
  const applicationIds = Array.from(applicationsById.keys());
  const responses = await getUserEmployerResponsesForApplications(userId, applicationIds);
  const responsesByApplication = new Map<number, EmployerResponse[]>();
  for (const response of responses) {
    const existing = responsesByApplication.get(response.applicationId) ?? [];
    existing.push(response);
    responsesByApplication.set(response.applicationId, existing);
  }
  const items = approvalRows.flatMap((approval) => {
    const applicationId = approval.applicationId ??
      (approval.entityType === "application" ? approval.entityId : null);
    const application = applicationId ? applicationsById.get(applicationId) : undefined;
    if (!application) return [];
    const payload = parseApprovalPayload(approval.payload);
    const responseId = payload && typeof payload.responseId === "number" &&
      Number.isInteger(payload.responseId) && payload.responseId > 0
      ? payload.responseId
      : null;
    const applicationResponses = responsesByApplication.get(application.id) ?? [];
    const latestEmployerResponse = responseId
      ? applicationResponses.find((response) => response.id === responseId && response.responseType === "offer") ?? null
      : applicationResponses.find((response) => response.responseType === "offer") ?? null;
    return [{
      approval,
      application,
      latestEmployerResponse,
      payload,
      recommendedAction: "report_hire" as const,
    }];
  });
  return { items, total, limit, hasMore: total > items.length };
}

export async function createSuccessFee(fee: InsertSuccessFee) {
  const db = await getDb();
  if (!db) {
    const record = {
      ...fee,
      id: memorySuccessFees.length + 1,
      applicationId: fee.applicationId ?? null,
      currency: fee.currency ?? "USD",
      feePercent: fee.feePercent ?? 5,
      stripeSubscriptionId: fee.stripeSubscriptionId ?? null,
      stripePriceId: fee.stripePriceId ?? null,
      stripeCheckoutSessionId: fee.stripeCheckoutSessionId ?? null,
      status: fee.status ?? "pending_verification",
      endDate: fee.endDate ?? null,
      nextVerificationDue: fee.nextVerificationDue ?? null,
      verificationGraceExpiry: fee.verificationGraceExpiry ?? null,
      offerLetterUrl: fee.offerLetterUrl ?? null,
      offerLetterKey: fee.offerLetterKey ?? null,
      termsAcceptedAt: fee.termsAcceptedAt ?? null,
      notes: fee.notes ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memorySuccessFees.push(record);
    return { insertId: record.id };
  }

  const result = await db.insert(successFees).values(fee);
  return { insertId: Number(result[0].insertId) };
}

export async function getUserSuccessFees(userId: number) {
  const db = await getDb();
  if (!db) {
    return memorySuccessFees
      .filter((fee) => fee.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) as SuccessFee[];
  }

  return await db
    .select()
    .from(successFees)
    .where(eq(successFees.userId, userId))
    .orderBy(desc(successFees.createdAt));
}

export interface SuccessFeePageCursor {
  createdAt: Date;
  id: number;
}

export async function getUserSuccessFeePage(
  userId: number,
  options: { limit?: number; cursor?: SuccessFeePageCursor } = {}
) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
  const db = await getDb();
  if (!db) {
    const ordered = memorySuccessFees
      .filter((fee) => fee.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
    const filtered = options.cursor
      ? ordered.filter((fee) =>
          fee.createdAt < options.cursor!.createdAt ||
          (fee.createdAt.getTime() === options.cursor!.createdAt.getTime() && fee.id < options.cursor!.id)
        )
      : ordered;
    const rows = filtered.slice(0, limit + 1) as SuccessFee[];
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  const cursorCondition = options.cursor
    ? or(
        lt(successFees.createdAt, options.cursor.createdAt),
        and(eq(successFees.createdAt, options.cursor.createdAt), lt(successFees.id, options.cursor.id))
      )
    : undefined;
  const rows = await db
    .select()
    .from(successFees)
    .where(and(eq(successFees.userId, userId), cursorCondition))
    .orderBy(desc(successFees.createdAt), desc(successFees.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export interface FeePaymentPageCursor {
  createdAt: Date;
  id: number;
}

export async function getUserFeePaymentPage(
  userId: number,
  options: { limit?: number; cursor?: FeePaymentPageCursor } = {}
) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
  const db = await getDb();
  if (!db) return { items: [] as FeePayment[], nextCursor: null };

  const cursorCondition = options.cursor
    ? or(
        lt(feePayments.createdAt, options.cursor.createdAt),
        and(eq(feePayments.createdAt, options.cursor.createdAt), lt(feePayments.id, options.cursor.id))
      )
    : undefined;
  const rows = await db
    .select()
    .from(feePayments)
    .where(and(eq(feePayments.userId, userId), cursorCondition))
    .orderBy(desc(feePayments.createdAt), desc(feePayments.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export async function getUserPaidTotalsByCurrency(userId: number) {
  const db = await getDb();
  if (!db) return [] as Array<{ currency: string; totalCents: number; paymentCount: number }>;

  const normalizedCurrency = sql<string>`upper(${feePayments.currency})`;
  const rows = await db
    .select({
      currency: normalizedCurrency,
      totalCents: sql<number>`coalesce(sum(${feePayments.amount}), 0)`,
      paymentCount: sql<number>`count(*)`,
    })
    .from(feePayments)
    .where(and(eq(feePayments.userId, userId), eq(feePayments.status, "paid")))
    .groupBy(normalizedCurrency)
    .orderBy(asc(normalizedCurrency));
  return rows.map((row) => ({
    currency: row.currency,
    totalCents: Number(row.totalCents),
    paymentCount: Number(row.paymentCount),
  }));
}

export async function getUserActiveMonthlyFeeTotalsByCurrency(userId: number) {
  const db = await getDb();
  if (!db) {
    const totals = new Map<string, { totalCents: number; arrangementCount: number }>();
    for (const fee of memorySuccessFees) {
      if (fee.userId !== userId || !["active", "pending_verification"].includes(fee.status ?? "")) continue;
      const currency = (fee.currency ?? "USD").toUpperCase();
      const current = totals.get(currency) ?? { totalCents: 0, arrangementCount: 0 };
      current.totalCents += fee.monthlyFeeAmount;
      current.arrangementCount += 1;
      totals.set(currency, current);
    }
    return Array.from(totals, ([currency, total]) => ({ currency, ...total }))
      .sort((left, right) => left.currency.localeCompare(right.currency));
  }

  const normalizedCurrency = sql<string>`upper(${successFees.currency})`;
  const rows = await db
    .select({
      currency: normalizedCurrency,
      totalCents: sql<number>`coalesce(sum(${successFees.monthlyFeeAmount}), 0)`,
      arrangementCount: sql<number>`count(*)`,
    })
    .from(successFees)
    .where(and(
      eq(successFees.userId, userId),
      inArray(successFees.status, ["active", "pending_verification"])
    ))
    .groupBy(normalizedCurrency)
    .orderBy(asc(normalizedCurrency));
  return rows.map((row) => ({
    currency: row.currency,
    totalCents: Number(row.totalCents),
    arrangementCount: Number(row.arrangementCount),
  }));
}

export async function getUserSuccessFeesForApplications(userId: number, applicationIds: number[]) {
  const ids = Array.from(new Set(applicationIds.filter((id) => Number.isInteger(id) && id > 0))).slice(0, 250);
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) {
    const idSet = new Set(ids);
    return memorySuccessFees
      .filter((fee) => fee.userId === userId && fee.applicationId != null && idSet.has(fee.applicationId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id) as SuccessFee[];
  }
  return await db
    .select()
    .from(successFees)
    .where(and(eq(successFees.userId, userId), inArray(successFees.applicationId, ids)))
    .orderBy(desc(successFees.createdAt), desc(successFees.id))
    .limit(1000);
}

export async function getUserSuccessFeeSummary(userId: number) {
  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + 14 * 86_400_000);
  const db = await getDb();
  if (!db) {
    const fees = memorySuccessFees.filter((fee) => fee.userId === userId);
    const active = fees.filter((fee) => fee.status === "active" || fee.status === "pending_verification");
    const deadlines = active
      .map((fee) => fee.nextVerificationDue)
      .filter((due): due is Date => due != null)
      .sort((a, b) => a.getTime() - b.getTime());
    const actionableFee = fees
      .filter((fee) =>
        (fee.status === "active" || fee.status === "pending_verification") && fee.nextVerificationDue != null
      )
      .sort((a, b) => a.nextVerificationDue!.getTime() - b.nextVerificationDue!.getTime() || a.id - b.id)[0] ?? null;
    return {
      activeFees: active.length,
      suspendedFees: fees.filter((fee) => fee.status === "suspended").length,
      pausedFees: fees.filter((fee) => fee.status === "paused").length,
      disputedFees: fees.filter((fee) => fee.status === "disputed").length,
      pendingVerification: fees.filter((fee) => fee.status === "pending_verification").length,
      overdueVerifications: deadlines.filter((due) => due < now).length,
      dueSoonVerifications: deadlines.filter((due) => due >= now && due <= dueSoonCutoff).length,
      monthlyFeeCents: active.reduce((sum, fee) => sum + fee.monthlyFeeAmount, 0),
      nextVerificationDue: deadlines[0] ?? null,
      actionableFee: actionableFee as SuccessFee | null,
    };
  }
  const [[summary], [actionableFee]] = await Promise.all([
    db
      .select({
        activeFees: sql<number>`coalesce(sum(case when ${successFees.status} in ('active', 'pending_verification') then 1 else 0 end), 0)`,
        suspendedFees: sql<number>`coalesce(sum(case when ${successFees.status} = 'suspended' then 1 else 0 end), 0)`,
        pausedFees: sql<number>`coalesce(sum(case when ${successFees.status} = 'paused' then 1 else 0 end), 0)`,
        disputedFees: sql<number>`coalesce(sum(case when ${successFees.status} = 'disputed' then 1 else 0 end), 0)`,
        pendingVerification: sql<number>`coalesce(sum(case when ${successFees.status} = 'pending_verification' then 1 else 0 end), 0)`,
        overdueVerifications: sql<number>`coalesce(sum(case when ${successFees.status} in ('active', 'pending_verification') and ${successFees.nextVerificationDue} < ${now} then 1 else 0 end), 0)`,
        dueSoonVerifications: sql<number>`coalesce(sum(case when ${successFees.status} in ('active', 'pending_verification') and ${successFees.nextVerificationDue} >= ${now} and ${successFees.nextVerificationDue} <= ${dueSoonCutoff} then 1 else 0 end), 0)`,
        monthlyFeeCents: sql<number>`coalesce(sum(case when ${successFees.status} in ('active', 'pending_verification') then ${successFees.monthlyFeeAmount} else 0 end), 0)`,
        nextVerificationDue: sql<Date | null>`min(case when ${successFees.status} in ('active', 'pending_verification') then ${successFees.nextVerificationDue} else null end)`,
      })
      .from(successFees)
      .where(eq(successFees.userId, userId)),
    db
      .select()
      .from(successFees)
      .where(and(
        eq(successFees.userId, userId),
        inArray(successFees.status, ["active", "pending_verification"]),
        isNotNull(successFees.nextVerificationDue)
      ))
      .orderBy(asc(successFees.nextVerificationDue), asc(successFees.id))
      .limit(1),
  ]);
  return {
    activeFees: Number(summary?.activeFees ?? 0),
    suspendedFees: Number(summary?.suspendedFees ?? 0),
    pausedFees: Number(summary?.pausedFees ?? 0),
    disputedFees: Number(summary?.disputedFees ?? 0),
    pendingVerification: Number(summary?.pendingVerification ?? 0),
    overdueVerifications: Number(summary?.overdueVerifications ?? 0),
    dueSoonVerifications: Number(summary?.dueSoonVerifications ?? 0),
    monthlyFeeCents: Number(summary?.monthlyFeeCents ?? 0),
    nextVerificationDue: summary?.nextVerificationDue ?? null,
    actionableFee: actionableFee ?? null,
  };
}

export async function getUserSuccessFeeOperatingItems(userId: number, requestedLimit = 100) {
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100);
  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + 14 * 86_400_000);
  const isActionable = (fee: SuccessFee) =>
    ["disputed", "suspended", "paused", "pending_verification"].includes(fee.status) ||
    (fee.status === "active" && fee.nextVerificationDue != null && fee.nextVerificationDue <= dueSoonCutoff);
  const priority = (fee: SuccessFee) => {
    if (fee.status === "disputed") return 0;
    if (fee.status === "suspended" || fee.status === "paused") return 1;
    if (fee.nextVerificationDue && fee.nextVerificationDue < now) return 0;
    if (fee.nextVerificationDue && fee.nextVerificationDue <= dueSoonCutoff) return 1;
    return 2;
  };
  const db = await getDb();
  if (!db) {
    const rows = (memorySuccessFees as SuccessFee[])
      .filter((fee) => fee.userId === userId && isActionable(fee))
      .sort((left, right) =>
        priority(left) - priority(right) ||
        (left.nextVerificationDue?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (right.nextVerificationDue?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
        left.id - right.id
      );
    return { items: rows.slice(0, limit), hasMore: rows.length > limit, limit };
  }
  const priorityOrder = sql<number>`case
    when ${successFees.status} = 'disputed' then 0
    when ${successFees.status} in ('suspended', 'paused') then 1
    when ${successFees.nextVerificationDue} < now() then 0
    when ${successFees.nextVerificationDue} <= ${dueSoonCutoff} then 1
    else 2 end`;
  const rows = await db
    .select()
    .from(successFees)
    .where(and(
      eq(successFees.userId, userId),
      or(
        inArray(successFees.status, ["disputed", "suspended", "paused", "pending_verification"]),
        and(eq(successFees.status, "active"), lte(successFees.nextVerificationDue, dueSoonCutoff))
      )
    ))
    .orderBy(asc(priorityOrder), asc(successFees.nextVerificationDue), asc(successFees.id))
    .limit(limit + 1);
  return { items: rows.slice(0, limit), hasMore: rows.length > limit, limit };
}

export async function touchApplicationActivity(
  applicationId: number,
  userId: number,
  occurredAt = new Date()
) {
  const db = await getDb();
  if (!db) {
    const application = memoryApplications.find((item) =>
      item.id === applicationId && item.userId === userId
    );
    if (!application) throw new Error("Application not found.");
    application.lastActivity = occurredAt;
    application.updatedAt = new Date();
    return;
  }

  await db
    .update(applications)
    .set({ lastActivity: occurredAt })
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
}

/**
 * Supplies the admin command center with the same in-memory ledger state used
 * by local review fixtures. Mutating admin actions intentionally remain
 * database-backed and fail closed when no database is configured.
 */
export async function getAdminMemoryFallback() {
  const db = await getDb();
  if (db) return null;

  const now = new Date();
  const usersById = new Map(memoryUsers.map((user) => [user.id, user]));
  const fees = memorySuccessFees
    .map((fee) => {
      const user = usersById.get(fee.userId);
      return {
        id: fee.id,
        userId: fee.userId,
        employerName: fee.employerName ?? "Unknown employer",
        jobTitle: fee.jobTitle ?? "Unknown role",
        monthlySalary: fee.monthlySalary ?? 0,
        currency: fee.currency ?? "USD",
        monthlyFeeAmount: fee.monthlyFeeAmount ?? 0,
        status: fee.status ?? "pending_verification",
        startDate: fee.startDate ?? fee.createdAt,
        endDate: fee.endDate ?? null,
        nextVerificationDue: fee.nextVerificationDue ?? null,
        verificationGraceExpiry: fee.verificationGraceExpiry ?? null,
        stripeSubscriptionId: fee.stripeSubscriptionId ?? null,
        notes: fee.notes ?? null,
        createdAt: fee.createdAt,
        userName: user?.name ?? null,
        userEmail: user?.email ?? null,
        userAccountStatus: user?.accountStatus ?? null,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const overdue = fees
    .filter((fee) =>
      (fee.status === "active" || fee.status === "suspended") &&
      fee.nextVerificationDue != null &&
      fee.nextVerificationDue < now
    )
    .map((fee) => ({
      ...fee,
      daysOverdue: Math.floor((now.getTime() - fee.nextVerificationDue!.getTime()) / (1000 * 60 * 60 * 24)),
      graceExpired: fee.verificationGraceExpiry ? fee.verificationGraceExpiry < now : false,
    }));

  return {
    stats: {
      activeFees: fees.filter((fee) => fee.status === "active").length,
      pendingFees: fees.filter((fee) => fee.status === "pending_verification").length,
      suspendedFees: fees.filter((fee) => fee.status === "suspended").length,
      pausedFees: fees.filter((fee) => fee.status === "paused").length,
      disputedFees: fees.filter((fee) => fee.status === "disputed").length,
      totalRevenueUsd: 0,
      monthlyRevenueUsd: 0,
      overdueVerifications: overdue.length,
      totalUsers: memoryUsers.length,
    },
    fees,
    overdue,
    pendingVerifications: [],
    payments: [],
    reviewItems: memoryAdminReviewItems
      .slice()
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
  };
}

export async function createAuditEvent(event: InsertAuditEvent) {
  const db = await getDb();
  if (!db) {
    const record = {
      ...event,
      id: memoryAuditEvents.length + 1,
      actor: event.actor ?? "system",
      source: event.source ?? null,
      beforeState: event.beforeState ?? null,
      afterState: event.afterState ?? null,
      riskLevel: event.riskLevel ?? "medium",
      approvalId: event.approvalId ?? null,
      createdAt: new Date(),
    };
    memoryAuditEvents.push(record);
    return { insertId: record.id };
  }

  const result = await db.insert(auditEvents).values(event);
  return { insertId: Number(result[0].insertId) };
}

export async function getAuditEventsForEntity(
  userId: number,
  entityType: AuditEvent["entityType"],
  entityId: number
) {
  const db = await getDb();
  if (!db) {
    return memoryAuditEvents
      .filter((event) =>
        event.userId === userId &&
        event.entityType === entityType &&
        event.entityId === entityId
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) as AuditEvent[];
  }

  return await db
    .select()
    .from(auditEvents)
    .where(and(
      eq(auditEvents.userId, userId),
      eq(auditEvents.entityType, entityType),
      eq(auditEvents.entityId, entityId)
    ))
    .orderBy(desc(auditEvents.createdAt));
}

export async function getRecentAuditEventsForEntity(
  userId: number,
  entityType: AuditEvent["entityType"],
  entityId: number,
  requestedLimit = 25
) {
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    return (await getAuditEventsForEntity(userId, entityType, entityId)).slice(0, limit);
  }
  return await db
    .select()
    .from(auditEvents)
    .where(and(
      eq(auditEvents.userId, userId),
      eq(auditEvents.entityType, entityType),
      eq(auditEvents.entityId, entityId)
    ))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit);
}

export async function getAuditEventsForUser(userId: number, limit = 50) {
  const db = await getDb();
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  if (!db) {
    return memoryAuditEvents
      .filter((event) => event.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, boundedLimit) as AuditEvent[];
  }

  return await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.userId, userId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(boundedLimit);
}

export async function createAdminReviewItem(item: InsertAdminReviewItem) {
  const db = await getDb();
  const openStatuses = new Set(["open", "in_progress"]);
  if (!db) {
    const existing = memoryAdminReviewItems.find((review) =>
      review.userId === item.userId &&
      review.entityType === item.entityType &&
      review.entityId === item.entityId &&
      review.category === item.category &&
      openStatuses.has(review.status || "open")
    );
    if (existing) {
      existing.priority = item.priority ?? existing.priority ?? "medium";
      existing.title = item.title ?? existing.title;
      existing.description = item.description ?? existing.description ?? null;
      existing.assignedTo = item.assignedTo ?? existing.assignedTo ?? null;
      existing.updatedAt = new Date();
      return { insertId: existing.id, existing: true };
    }

    const record = {
      ...item,
      id: memoryAdminReviewItems.length + 1,
      status: item.status ?? "open",
      priority: item.priority ?? "medium",
      description: item.description ?? null,
      assignedTo: item.assignedTo ?? null,
      resolvedBy: item.resolvedBy ?? null,
      resolvedAt: item.resolvedAt ?? null,
      resolution: item.resolution ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryAdminReviewItems.push(record);
    return { insertId: record.id };
  }

  const existing = await db
    .select({ id: adminReviewItems.id })
    .from(adminReviewItems)
    .where(and(
      eq(adminReviewItems.userId, item.userId),
      eq(adminReviewItems.entityType, item.entityType),
      eq(adminReviewItems.entityId, item.entityId),
      eq(adminReviewItems.category, item.category),
      or(eq(adminReviewItems.status, "open"), eq(adminReviewItems.status, "in_progress"))
    ))
    .limit(1);

  if (existing[0]) {
    await db
      .update(adminReviewItems)
      .set({
        priority: item.priority ?? "medium",
        title: item.title,
        description: item.description,
        assignedTo: item.assignedTo,
      })
      .where(eq(adminReviewItems.id, existing[0].id));
    return { insertId: existing[0].id, existing: true };
  }

  const result = await db.insert(adminReviewItems).values(item);
  return { insertId: Number(result[0].insertId) };
}

export async function listAdminReviewItems(
  status: AdminReviewItem["status"] | "all" = "open",
  requestedLimit = 100
) {
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    return memoryAdminReviewItems
      .filter((item) => status === "all" || item.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit) as AdminReviewItem[];
  }

  return await db
    .select()
    .from(adminReviewItems)
    .where(status === "all" ? undefined : eq(adminReviewItems.status, status))
    .orderBy(desc(adminReviewItems.createdAt), desc(adminReviewItems.id))
    .limit(limit);
}

export async function listUserAdminReviewItems(
  userId: number,
  statuses: AdminReviewItem["status"][] = ["open", "in_progress"],
  limit = 100
) {
  const allowedStatuses = new Set<AdminReviewItem["status"]>([
    "open",
    "in_progress",
    "resolved",
    "dismissed",
  ]);
  const selectedStatuses = Array.from(new Set(statuses.filter((status) => allowedStatuses.has(status))));
  if (selectedStatuses.length === 0) return [] as AdminReviewItem[];
  const boundedLimit = Math.min(250, Math.max(1, Math.floor(limit)));
  const db = await getDb();
  if (!db) {
    const selectedStatusSet = new Set(selectedStatuses);
    return memoryAdminReviewItems
      .filter((item) => item.userId === userId && selectedStatusSet.has(item.status))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, boundedLimit);
  }

  return await db
    .select()
    .from(adminReviewItems)
    .where(and(
      eq(adminReviewItems.userId, userId),
      inArray(adminReviewItems.status, selectedStatuses)
    ))
    .orderBy(desc(adminReviewItems.createdAt))
    .limit(boundedLimit);
}

export async function getUserAdminReviewPage(
  userId: number,
  statuses: AdminReviewItem["status"][] = ["open", "in_progress"],
  requestedLimit = 100
) {
  const allowedStatuses = new Set<AdminReviewItem["status"]>([
    "open",
    "in_progress",
    "resolved",
    "dismissed",
  ]);
  const selectedStatuses = Array.from(new Set(statuses.filter((status) => allowedStatuses.has(status))));
  const limit = Math.min(250, Math.max(1, Math.trunc(requestedLimit)));
  if (selectedStatuses.length === 0) {
    return { items: [] as AdminReviewItem[], total: 0, limit, hasMore: false };
  }
  const db = await getDb();
  if (!db) {
    const selectedStatusSet = new Set(selectedStatuses);
    const rows = memoryAdminReviewItems
      .filter((item) => item.userId === userId && selectedStatusSet.has(item.status))
      .sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id
      );
    return { items: rows.slice(0, limit), total: rows.length, limit, hasMore: rows.length > limit };
  }
  const condition = and(
    eq(adminReviewItems.userId, userId),
    inArray(adminReviewItems.status, selectedStatuses)
  );
  const [items, totalRows] = await Promise.all([
    db
      .select()
      .from(adminReviewItems)
      .where(condition)
      .orderBy(desc(adminReviewItems.createdAt), desc(adminReviewItems.id))
      .limit(limit),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(adminReviewItems)
      .where(condition),
  ]);
  const total = Number(totalRows[0]?.count ?? 0);
  return { items, total, limit, hasMore: total > items.length };
}

export async function getUnreadInterviewNotificationPage(userId: number, requestedLimit = 5) {
  const limit = Math.min(50, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    const candidates = memoryApplicationNotifications.flatMap((notification) => {
      if (notification.userId !== userId || notification.readAt) return [];
      const application = memoryApplications.find((item) =>
        item.id === notification.applicationId &&
        item.userId === userId &&
        item.status === "interview"
      );
      const response = memoryEmployerResponses.find((item) =>
        item.id === notification.employerResponseId &&
        item.applicationId === notification.applicationId &&
        item.userId === userId &&
        item.responseType === "interview_invite"
      );
      return application && response ? [{ notification, application, response }] : [];
    }).sort((left, right) =>
      right.notification.createdAt.getTime() - left.notification.createdAt.getTime() ||
      right.notification.id - left.notification.id
    );
    const items = await Promise.all(candidates.slice(0, limit).map(async ({ notification, application, response }) => {
      const job = await getJobById(application.jobId);
      return {
        notificationId: notification.id,
        applicationId: application.id,
        jobId: application.jobId,
        employerResponseId: response.id,
        notificationType: notification.notificationType,
        createdAt: notification.createdAt,
        receivedAt: response.receivedAt,
        summary: response.summary,
        job: job ? { id: job.id, title: job.title, company: job.company, location: job.location } : null,
      };
    }));
    return { items, total: candidates.length, limit, hasMore: candidates.length > items.length };
  }
  const notificationJoin = and(
    eq(applicationNotifications.applicationId, applications.id),
    eq(applicationNotifications.userId, applications.userId)
  );
  const responseJoin = and(
    eq(applicationNotifications.employerResponseId, employerResponses.id),
    eq(employerResponses.applicationId, applications.id),
    eq(employerResponses.userId, applications.userId)
  );
  const condition = and(
    eq(applicationNotifications.userId, userId),
    isNull(applicationNotifications.readAt),
    eq(applications.status, "interview"),
    eq(employerResponses.responseType, "interview_invite")
  );
  const [items, totalRows] = await Promise.all([
    db
      .select({
        notificationId: applicationNotifications.id,
        applicationId: applications.id,
        jobId: applications.jobId,
        employerResponseId: employerResponses.id,
        notificationType: applicationNotifications.notificationType,
        createdAt: applicationNotifications.createdAt,
        receivedAt: employerResponses.receivedAt,
        summary: employerResponses.summary,
        job: { id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location },
      })
      .from(applicationNotifications)
      .innerJoin(applications, notificationJoin)
      .innerJoin(employerResponses, responseJoin)
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .where(condition)
      .orderBy(desc(applicationNotifications.createdAt), desc(applicationNotifications.id))
      .limit(limit),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(applicationNotifications)
      .innerJoin(applications, notificationJoin)
      .innerJoin(employerResponses, responseJoin)
      .where(condition),
  ]);
  const total = Number(totalRows[0]?.count ?? 0);
  return { items, total, limit, hasMore: total > items.length };
}

export async function listActiveAdminReviewItemsForEntity(
  userId: number,
  entityType: AdminReviewItem["entityType"],
  entityId: number
) {
  const activeStatuses: AdminReviewItem["status"][] = ["open", "in_progress"];
  const db = await getDb();
  if (!db) {
    return memoryAdminReviewItems
      .filter((item) =>
        item.userId === userId &&
        item.entityType === entityType &&
        item.entityId === entityId &&
        activeStatuses.includes(item.status)
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 100);
  }

  return await db
    .select()
    .from(adminReviewItems)
    .where(and(
      eq(adminReviewItems.userId, userId),
      eq(adminReviewItems.entityType, entityType),
      eq(adminReviewItems.entityId, entityId),
      inArray(adminReviewItems.status, activeStatuses)
    ))
    .orderBy(desc(adminReviewItems.createdAt))
    .limit(100);
}

export async function getLatestPrivacyDeletionReview(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryAdminReviewItems
      .filter((item) =>
        item.userId === userId &&
        item.entityType === "user" &&
        item.entityId === userId &&
        item.category === "privacy_deletion"
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }

  const reviews = await db
    .select()
    .from(adminReviewItems)
    .where(and(
      eq(adminReviewItems.userId, userId),
      eq(adminReviewItems.entityType, "user"),
      eq(adminReviewItems.entityId, userId),
      eq(adminReviewItems.category, "privacy_deletion")
    ))
    .orderBy(desc(adminReviewItems.createdAt))
    .limit(1);
  return reviews[0] ?? null;
}

export async function requestPrivacyDeletionReview(userId: number, reason?: string) {
  await createAdminReviewItem({
    userId,
    entityType: "user",
    entityId: userId,
    category: "privacy_deletion",
    priority: "high",
    title: "User requested account data deletion review",
    description: reason
      ? `The user requested account erasure. User note: ${reason}`
      : "The user requested account erasure. Review active billing, employment verification, disputes, legal holds, provider records, and document retention before recording a decision. Resolving this item does not itself delete data.",
  });
  return await getLatestPrivacyDeletionReview(userId);
}

export async function cancelPrivacyDeletionReview(userId: number) {
  const current = await getLatestPrivacyDeletionReview(userId);
  if (!current || (current.status !== "open" && current.status !== "in_progress")) {
    throw new Error("No open deletion request was found.");
  }

  const cancelledAt = new Date();
  const db = await getDb();
  if (!db) {
    const item = memoryAdminReviewItems.find((review) => review.id === current.id);
    if (!item || item.userId !== userId || item.category !== "privacy_deletion") {
      throw new Error("Deletion request not found.");
    }
    item.status = "dismissed";
    item.resolution = "Cancelled by the user before operator review was completed.";
    item.resolvedAt = cancelledAt;
    item.updatedAt = cancelledAt;
    return item as AdminReviewItem;
  }

  const result = await db
    .update(adminReviewItems)
    .set({
      status: "dismissed",
      resolution: "Cancelled by the user before operator review was completed.",
      resolvedAt: cancelledAt,
    })
    .where(and(
      eq(adminReviewItems.id, current.id),
      eq(adminReviewItems.userId, userId),
      eq(adminReviewItems.category, "privacy_deletion"),
      inArray(adminReviewItems.status, ["open", "in_progress"])
    ));
  if (Number(result[0].affectedRows) === 0) {
    throw new Error("Deletion request changed before it could be cancelled.");
  }
  return await getLatestPrivacyDeletionReview(userId);
}

export async function dismissOfferAttributionAdminReviews(
  userId: number,
  applicationId: number,
  resolution: string
) {
  const db = await getDb();
  const dismissedAt = new Date();
  if (!db) {
    const reviews = memoryAdminReviewItems.filter((review) =>
      review.userId === userId &&
      review.entityType === "application" &&
      review.entityId === applicationId &&
      review.category === "offer_attribution" &&
      (review.status === "open" || review.status === "in_progress")
    );
    for (const review of reviews) {
      review.status = "dismissed";
      review.resolution = resolution;
      review.resolvedAt = dismissedAt;
      review.updatedAt = dismissedAt;
    }
    return { dismissedReviewIds: reviews.map((review) => review.id) };
  }

  const reviews = await db
    .select({ id: adminReviewItems.id })
    .from(adminReviewItems)
    .where(and(
      eq(adminReviewItems.userId, userId),
      eq(adminReviewItems.entityType, "application"),
      eq(adminReviewItems.entityId, applicationId),
      eq(adminReviewItems.category, "offer_attribution"),
      inArray(adminReviewItems.status, ["open", "in_progress"])
    ));
  if (reviews.length > 0) {
    await db
      .update(adminReviewItems)
      .set({
        status: "dismissed",
        resolution,
        resolvedAt: dismissedAt,
      })
      .where(inArray(adminReviewItems.id, reviews.map((review) => review.id)));
  }
  return { dismissedReviewIds: reviews.map((review) => review.id) };
}

export async function getAdminReviewEvidenceSnapshot(reviewItemId: number) {
  const db = await getDb();
  const reviewItem = !db
    ? memoryAdminReviewItems.find((item) => item.id === reviewItemId)
    : (await db
      .select()
      .from(adminReviewItems)
      .where(eq(adminReviewItems.id, reviewItemId))
      .limit(1))[0];
  if (!reviewItem) {
    throw new Error("Review item not found.");
  }

  const user = !db
    ? memoryUsers.find((item) => item.id === reviewItem.userId)
    : (await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        accountStatus: users.accountStatus,
        tosAcceptedAt: users.tosAcceptedAt,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .where(eq(users.id, reviewItem.userId))
      .limit(1))[0];

  let application: Awaited<ReturnType<typeof getUserApplications>>[number] | null = null;
  let artifacts: Awaited<ReturnType<typeof getApplicationLedgerArtifacts>> | null = null;
  let approvals: ApplicationApproval[] = [];
  let decision: Awaited<ReturnType<typeof getUserApplicationDecisions>>[number] | null = null;

  if (reviewItem.entityType === "application") {
    [application, approvals] = await Promise.all([
      getUserApplicationById(reviewItem.userId, reviewItem.entityId),
      listUserApplicationApprovalsForApplication(reviewItem.userId, reviewItem.entityId),
    ]);

    if (application) {
      [artifacts, decision] = await Promise.all([
        getApplicationLedgerArtifacts(reviewItem.entityId, reviewItem.userId),
        getUserApplicationDecisionForJob(reviewItem.userId, application.jobId),
      ]);
    }
  }

  const reviewAuditEvents = reviewItem.entityType === "application"
    ? artifacts?.auditEvents ?? []
    : reviewItem.entityType === "user"
      ? await getAuditEventsForUser(reviewItem.userId, 100)
      : [];

  return {
    reviewItem,
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          accountStatus: user.accountStatus,
          tosAcceptedAt: user.tosAcceptedAt,
          createdAt: user.createdAt,
          lastSignedIn: user.lastSignedIn,
        }
      : null,
    application,
    decision,
    material: artifacts?.material ?? null,
    attempts: artifacts?.attempts ?? [],
    employerResponses: artifacts?.employerResponses ?? [],
    approvals,
    auditEvents: reviewAuditEvents,
  };
}

export async function resolveAdminReviewItem(
  reviewItemId: number,
  adminUserId: number,
  status: "resolved" | "dismissed",
  resolution: string
) {
  const db = await getDb();
  if (!db) {
    const item = memoryAdminReviewItems.find((review) => review.id === reviewItemId);
    if (!item) throw new Error("Review item not found.");
    item.status = status;
    item.resolvedBy = adminUserId;
    item.resolvedAt = new Date();
    item.resolution = resolution;
    item.updatedAt = new Date();
    return { success: true };
  }

  const result = await db
    .update(adminReviewItems)
    .set({
      status,
      resolvedBy: adminUserId,
      resolvedAt: new Date(),
      resolution,
    })
    .where(eq(adminReviewItems.id, reviewItemId));
  if (Number(result[0].affectedRows) === 0) {
    throw new Error("Review item not found.");
  }
  return { success: true };
}

export async function createApplicationApproval(approval: InsertApplicationApproval) {
  const db = await getDb();
  if (!db) {
    const existing = memoryApplicationApprovals.find((item) =>
      item.userId === approval.userId &&
      item.entityType === approval.entityType &&
      item.entityId === approval.entityId &&
      item.approvalType === approval.approvalType &&
      item.status === "pending"
    );
    if (existing) {
      existing.applicationId = approval.applicationId ?? existing.applicationId ?? null;
      existing.riskLevel = approval.riskLevel ?? existing.riskLevel ?? "medium";
      existing.requestedBy = approval.requestedBy ?? existing.requestedBy ?? "system";
      existing.title = approval.title ?? existing.title;
      existing.description = approval.description ?? existing.description ?? null;
      existing.payload = approval.payload ?? existing.payload ?? null;
      existing.updatedAt = new Date();
      return { insertId: existing.id, existing: true };
    }

    const record = {
      ...approval,
      id: memoryApplicationApprovals.length + 1,
      applicationId: approval.applicationId ?? null,
      status: approval.status ?? "pending",
      riskLevel: approval.riskLevel ?? "medium",
      requestedBy: approval.requestedBy ?? "system",
      decidedBy: approval.decidedBy ?? null,
      description: approval.description ?? null,
      payload: approval.payload ?? null,
      decisionNote: approval.decisionNote ?? null,
      requestedAt: approval.requestedAt ?? new Date(),
      decidedAt: approval.decidedAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryApplicationApprovals.push(record);
    return { insertId: record.id };
  }

  const existing = await db
    .select({ id: applicationApprovals.id })
    .from(applicationApprovals)
    .where(and(
      eq(applicationApprovals.userId, approval.userId),
      eq(applicationApprovals.entityType, approval.entityType),
      eq(applicationApprovals.entityId, approval.entityId),
      eq(applicationApprovals.approvalType, approval.approvalType),
      eq(applicationApprovals.status, "pending")
    ))
    .limit(1);
  if (existing[0]) {
    await db
      .update(applicationApprovals)
      .set({
        applicationId: approval.applicationId,
        riskLevel: approval.riskLevel ?? "medium",
        requestedBy: approval.requestedBy ?? "system",
        title: approval.title,
        description: approval.description,
        payload: approval.payload,
      })
      .where(eq(applicationApprovals.id, existing[0].id));
    return { insertId: existing[0].id, existing: true };
  }

  const result = await db.insert(applicationApprovals).values(approval);
  return { insertId: Number(result[0].insertId) };
}

export async function listUserApplicationApprovals(
  userId: number,
  status: ApplicationApproval["status"] | "all" = "pending"
) {
  const db = await getDb();
  if (!db) {
    return memoryApplicationApprovals
      .filter((approval) => approval.userId === userId && (status === "all" || approval.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) as ApplicationApproval[];
  }

  const conditions: SQL[] = [eq(applicationApprovals.userId, userId)];
  if (status !== "all") {
    conditions.push(eq(applicationApprovals.status, status));
  }

  return await db
    .select()
    .from(applicationApprovals)
    .where(and(...conditions))
    .orderBy(desc(applicationApprovals.createdAt));
}

export async function listUserApplicationApprovalsForApplications(
  userId: number,
  requestedApplicationIds: number[]
) {
  const applicationIds = Array.from(new Set(
    requestedApplicationIds.filter((applicationId) => Number.isInteger(applicationId) && applicationId > 0)
  )).slice(0, 250);
  if (applicationIds.length === 0) return [] as ApplicationApproval[];

  const requested = new Set(applicationIds);
  const db = await getDb();
  if (!db) {
    return memoryApplicationApprovals
      .filter((approval) =>
        approval.userId === userId &&
        ((approval.applicationId != null && requested.has(approval.applicationId)) ||
          (approval.entityType === "application" && requested.has(approval.entityId)))
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 2000) as ApplicationApproval[];
  }

  return await db
    .select()
    .from(applicationApprovals)
    .where(and(
      eq(applicationApprovals.userId, userId),
      or(
        inArray(applicationApprovals.applicationId, applicationIds),
        and(
          eq(applicationApprovals.entityType, "application"),
          inArray(applicationApprovals.entityId, applicationIds)
        )
      )
    ))
    .orderBy(desc(applicationApprovals.createdAt), desc(applicationApprovals.id))
    .limit(2000);
}

export async function getUserOperatingApplicationApprovals(
  userId: number,
  requestedApplicationIds: number[],
  requestedPendingLimit = 100
) {
  const applicationIds = Array.from(new Set(
    requestedApplicationIds.filter((applicationId) => Number.isInteger(applicationId) && applicationId > 0)
  )).slice(0, 500);
  const pendingLimit = Math.min(Math.max(Math.floor(requestedPendingLimit), 1), 100);
  const db = await getDb();
  if (!db) {
    const requested = new Set(applicationIds);
    const pending = memoryApplicationApprovals
      .filter((approval) => approval.userId === userId && approval.status === "pending")
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const scopedApproved = memoryApplicationApprovals.filter((approval) =>
      approval.userId === userId &&
      approval.status === "approved" &&
      approval.approvalType === "follow_up_send" &&
      approval.applicationId != null &&
      requested.has(approval.applicationId)
    )
      .sort((left, right) => (right.decidedAt?.getTime() ?? 0) - (left.decidedAt?.getTime() ?? 0))
      .slice(0, 500);
    return {
      items: Array.from(new Map(
        [...pending.slice(0, pendingLimit), ...scopedApproved]
          .map((approval) => [approval.id, approval] as const)
      ).values()) as ApplicationApproval[],
      pendingTotal: pending.length,
      pendingHasMore: pending.length > pendingLimit,
      pendingLimit,
    };
  }

  const pendingCondition = and(
    eq(applicationApprovals.userId, userId),
    eq(applicationApprovals.status, "pending")
  );
  const [pendingRows, pendingCountRows, scopedApproved] = await Promise.all([
    db
      .select()
      .from(applicationApprovals)
      .where(pendingCondition)
      .orderBy(desc(applicationApprovals.createdAt))
      .limit(pendingLimit + 1),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(applicationApprovals)
      .where(pendingCondition),
    applicationIds.length === 0
      ? Promise.resolve([] as ApplicationApproval[])
      : db
          .select()
          .from(applicationApprovals)
          .where(and(
            eq(applicationApprovals.userId, userId),
            eq(applicationApprovals.status, "approved"),
            eq(applicationApprovals.approvalType, "follow_up_send"),
            inArray(applicationApprovals.applicationId, applicationIds)
          ))
          .orderBy(desc(applicationApprovals.decidedAt), desc(applicationApprovals.id))
          .limit(500),
  ]);
  return {
    items: Array.from(new Map(
      [...pendingRows.slice(0, pendingLimit), ...scopedApproved]
        .map((approval) => [approval.id, approval] as const)
    ).values()),
    pendingTotal: Number(pendingCountRows[0]?.count ?? 0),
    pendingHasMore: pendingRows.length > pendingLimit,
    pendingLimit,
  };
}

export async function listUserApplicationApprovalsForApplication(
  userId: number,
  applicationId: number
) {
  const db = await getDb();
  if (!db) {
    return memoryApplicationApprovals
      .filter((approval) =>
        approval.userId === userId &&
        (approval.applicationId === applicationId ||
          (approval.entityType === "application" && approval.entityId === applicationId))
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()) as ApplicationApproval[];
  }

  return await db
    .select()
    .from(applicationApprovals)
    .where(and(
      eq(applicationApprovals.userId, userId),
      or(
        eq(applicationApprovals.applicationId, applicationId),
        and(
          eq(applicationApprovals.entityType, "application"),
          eq(applicationApprovals.entityId, applicationId)
        )
      )
    ))
    .orderBy(desc(applicationApprovals.createdAt));
}

export async function getUserApplicationApprovalById(userId: number, approvalId: number) {
  const db = await getDb();
  if (!db) {
    return memoryApplicationApprovals.find((approval) =>
      approval.id === approvalId && approval.userId === userId
    ) as ApplicationApproval | undefined;
  }

  const rows = await db
    .select()
    .from(applicationApprovals)
    .where(and(
      eq(applicationApprovals.id, approvalId),
      eq(applicationApprovals.userId, userId)
    ))
    .limit(1);
  return rows[0];
}

export async function getPendingFollowUpApproval(followUpId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryApplicationApprovals.find((approval) =>
      approval.userId === userId &&
      approval.entityType === "follow_up" &&
      approval.entityId === followUpId &&
      approval.approvalType === "follow_up_send" &&
      approval.status === "pending"
    ) as ApplicationApproval | undefined;
  }

  const result = await db
    .select()
    .from(applicationApprovals)
    .where(and(
      eq(applicationApprovals.userId, userId),
      eq(applicationApprovals.entityType, "follow_up"),
      eq(applicationApprovals.entityId, followUpId),
      eq(applicationApprovals.approvalType, "follow_up_send"),
      eq(applicationApprovals.status, "pending")
    ))
    .limit(1);
  return result[0];
}

export async function resolveApplicationApproval(
  approvalId: number,
  userId: number,
  status: "approved" | "rejected" | "cancelled",
  decisionNote?: string,
  decidedBy: "user" | "admin" = "user"
) {
  const db = await getDb();
  const decidedAt = new Date();
  if (!db) {
    const approval = memoryApplicationApprovals.find((item) => item.id === approvalId && item.userId === userId);
    if (!approval) throw new Error("Approval not found.");
    if (approval.status !== "pending") throw new Error("Approval has already been resolved.");
    approval.status = status;
    approval.decidedBy = decidedBy;
    approval.decisionNote = decisionNote ?? null;
    approval.decidedAt = decidedAt;
    approval.updatedAt = decidedAt;
    return { success: true, approval };
  }

  const existing = await db
    .select()
    .from(applicationApprovals)
    .where(and(eq(applicationApprovals.id, approvalId), eq(applicationApprovals.userId, userId)))
    .limit(1);
  if (!existing[0]) throw new Error("Approval not found.");
  if (existing[0].status !== "pending") throw new Error("Approval has already been resolved.");

  await db
    .update(applicationApprovals)
    .set({
      status,
      decidedBy,
      decisionNote,
      decidedAt,
    })
    .where(and(eq(applicationApprovals.id, approvalId), eq(applicationApprovals.userId, userId)));

  return {
    success: true,
    approval: {
      ...existing[0],
      status,
      decidedBy,
      decisionNote: decisionNote ?? null,
      decidedAt,
    },
  };
}

export async function getApplicationCampaign(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryApplicationCampaigns.find((campaign) => campaign.userId === userId) as ApplicationCampaign | undefined;
  }

  const result = await db
    .select()
    .from(applicationCampaigns)
    .where(eq(applicationCampaigns.userId, userId))
    .limit(1);
  return result[0];
}

export async function upsertApplicationCampaign(
  campaign: InsertApplicationCampaign,
  options: { preserveStatus?: boolean } = {}
) {
  const db = await getDb();
  const now = new Date();

  if (!db) {
    const existing = memoryApplicationCampaigns.find((item) => item.userId === campaign.userId);
    if (existing) {
      existing.status = options.preserveStatus
        ? existing.status ?? "active"
        : campaign.status ?? existing.status ?? "active";
      existing.title = campaign.title ?? existing.title;
      existing.targetRoles = campaign.targetRoles ?? existing.targetRoles ?? null;
      existing.targetLocations = campaign.targetLocations ?? existing.targetLocations ?? null;
      existing.salaryMin = campaign.salaryMin ?? existing.salaryMin ?? null;
      existing.salaryMax = campaign.salaryMax ?? existing.salaryMax ?? null;
      existing.remoteOnly = campaign.remoteOnly ?? existing.remoteOnly ?? 1;
      existing.automationMode = campaign.automationMode ?? existing.automationMode ?? "review_first";
      existing.dailyApplicationLimit = campaign.dailyApplicationLimit ?? existing.dailyApplicationLimit ?? 12;
      existing.minMatchScore = campaign.minMatchScore ?? existing.minMatchScore ?? 70;
      existing.readinessScore = campaign.readinessScore ?? existing.readinessScore ?? 0;
      existing.autoApplyEligible = campaign.autoApplyEligible ?? existing.autoApplyEligible ?? 0;
      existing.blockers = campaign.blockers ?? existing.blockers ?? null;
      existing.nextActions = campaign.nextActions ?? existing.nextActions ?? null;
      existing.lastPlanSummary = campaign.lastPlanSummary ?? existing.lastPlanSummary ?? null;
      existing.lastSyncedAt = campaign.lastSyncedAt ?? now;
      existing.updatedAt = now;
      return { insertId: existing.id, existing: true };
    }

    const record = {
      ...campaign,
      id: memoryApplicationCampaigns.length + 1,
      status: campaign.status ?? "active",
      targetRoles: campaign.targetRoles ?? null,
      targetLocations: campaign.targetLocations ?? null,
      salaryMin: campaign.salaryMin ?? null,
      salaryMax: campaign.salaryMax ?? null,
      remoteOnly: campaign.remoteOnly ?? 1,
      automationMode: campaign.automationMode ?? "review_first",
      dailyApplicationLimit: campaign.dailyApplicationLimit ?? 12,
      minMatchScore: campaign.minMatchScore ?? 70,
      readinessScore: campaign.readinessScore ?? 0,
      autoApplyEligible: campaign.autoApplyEligible ?? 0,
      blockers: campaign.blockers ?? null,
      nextActions: campaign.nextActions ?? null,
      lastPlanSummary: campaign.lastPlanSummary ?? null,
      lastSyncedAt: campaign.lastSyncedAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    memoryApplicationCampaigns.push(record);
    return { insertId: record.id };
  }

  const result = await db
    .insert(applicationCampaigns)
    .values(campaign)
    .onDuplicateKeyUpdate({
      set: {
        id: sql`LAST_INSERT_ID(${applicationCampaigns.id})`,
        status: options.preserveStatus
          ? sql`${applicationCampaigns.status}`
          : sql`VALUES(${applicationCampaigns.status})`,
        title: sql`VALUES(${applicationCampaigns.title})`,
        targetRoles: sql`VALUES(${applicationCampaigns.targetRoles})`,
        targetLocations: sql`VALUES(${applicationCampaigns.targetLocations})`,
        salaryMin: sql`VALUES(${applicationCampaigns.salaryMin})`,
        salaryMax: sql`VALUES(${applicationCampaigns.salaryMax})`,
        remoteOnly: sql`VALUES(${applicationCampaigns.remoteOnly})`,
        automationMode: sql`VALUES(${applicationCampaigns.automationMode})`,
        dailyApplicationLimit: sql`VALUES(${applicationCampaigns.dailyApplicationLimit})`,
        minMatchScore: sql`VALUES(${applicationCampaigns.minMatchScore})`,
        readinessScore: sql`VALUES(${applicationCampaigns.readinessScore})`,
        autoApplyEligible: sql`VALUES(${applicationCampaigns.autoApplyEligible})`,
        blockers: sql`VALUES(${applicationCampaigns.blockers})`,
        nextActions: sql`VALUES(${applicationCampaigns.nextActions})`,
        lastPlanSummary: sql`VALUES(${applicationCampaigns.lastPlanSummary})`,
        lastSyncedAt: sql`VALUES(${applicationCampaigns.lastSyncedAt})`,
        updatedAt: now,
      },
    });

  return {
    insertId: Number(result[0].insertId),
    existing: Number(result[0].affectedRows) !== 1,
  };
}

export async function updateApplicationCampaignStatus(
  userId: number,
  status: ApplicationCampaign["status"]
) {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const campaign = memoryApplicationCampaigns.find((item) => item.userId === userId);
    if (!campaign) throw new Error("Application campaign not found.");
    campaign.status = status;
    campaign.updatedAt = now;
    return campaign as ApplicationCampaign;
  }

  const result = await db
    .update(applicationCampaigns)
    .set({ status, updatedAt: now })
    .where(eq(applicationCampaigns.userId, userId));
  if (Number(result[0].affectedRows) === 0) {
    throw new Error("Application campaign not found.");
  }

  const campaign = await getApplicationCampaign(userId);
  if (!campaign) throw new Error("Application campaign not found.");
  return campaign;
}

export async function upsertInterviewPreparation(preparation: InsertInterviewPreparation) {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const existing = memoryInterviewPreparations.find((item) =>
      item.userId === preparation.userId && item.jobId === preparation.jobId
    );
    if (existing) {
      existing.questions = preparation.questions ?? existing.questions ?? null;
      existing.coachingTips = preparation.coachingTips ?? existing.coachingTips ?? null;
      existing.companyInsights = preparation.companyInsights ?? existing.companyInsights ?? null;
      return { insertId: existing.id, existing: true };
    }

    const record = {
      ...preparation,
      id: memoryInterviewPreparations.length + 1,
      questions: preparation.questions ?? null,
      coachingTips: preparation.coachingTips ?? null,
      companyInsights: preparation.companyInsights ?? null,
      createdAt: preparation.createdAt ?? now,
    };
    memoryInterviewPreparations.push(record);
    return { insertId: record.id, existing: false };
  }

  const result = await db
    .insert(interviewPreparation)
    .values(preparation)
    .onDuplicateKeyUpdate({
      set: {
        id: sql`LAST_INSERT_ID(${interviewPreparation.id})`,
        questions: preparation.questions ?? null,
        coachingTips: preparation.coachingTips ?? null,
        companyInsights: preparation.companyInsights ?? null,
      },
    });

  return {
    insertId: Number(result[0].insertId),
    existing: Number(result[0].affectedRows) !== 1,
  };
}

export async function getInterviewPreparationForJob(userId: number, jobId: number) {
  const db = await getDb();
  if (!db) {
    return memoryInterviewPreparations.find((item) =>
      item.userId === userId && item.jobId === jobId
    ) as InterviewPreparation | undefined;
  }

  const rows = await db
    .select()
    .from(interviewPreparation)
    .where(and(eq(interviewPreparation.userId, userId), eq(interviewPreparation.jobId, jobId)))
    .orderBy(desc(interviewPreparation.createdAt))
    .limit(1);
  return rows[0];
}

export async function getInterviewPreparationsForJobs(userId: number, requestedJobIds: number[]) {
  const jobIds = Array.from(new Set(requestedJobIds.filter((jobId) => Number.isInteger(jobId) && jobId > 0)));
  if (jobIds.length === 0) return [] as InterviewPreparation[];
  const db = await getDb();
  if (!db) {
    const requested = new Set(jobIds);
    return memoryInterviewPreparations.filter((item) =>
      item.userId === userId && requested.has(item.jobId)
    ) as InterviewPreparation[];
  }
  const batches = [] as InterviewPreparation[];
  for (let offset = 0; offset < jobIds.length; offset += 500) {
    const rows = await db
      .select()
      .from(interviewPreparation)
      .where(and(
        eq(interviewPreparation.userId, userId),
        inArray(interviewPreparation.jobId, jobIds.slice(offset, offset + 500))
      ));
    batches.push(...rows);
  }
  return batches;
}

export async function listInterviewPreparationsForUser(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryInterviewPreparations
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) as InterviewPreparation[];
  }

  return await db
    .select()
    .from(interviewPreparation)
    .where(eq(interviewPreparation.userId, userId))
    .orderBy(desc(interviewPreparation.createdAt));
}

// Job Matches
export async function createJobMatch(match: InsertJobMatch) {
  const canonicalJobId = await getCanonicalJobId(match.jobId);
  if (canonicalJobId === null) throw new Error("Job not found.");
  match = { ...match, jobId: canonicalJobId };
  const db = await getDb();
  if (!db) {
    const existing = memoryJobMatches.find((item) =>
      item.userId === match.userId && item.jobId === match.jobId
    );
    if (existing) {
      existing.matchScore = match.matchScore;
      existing.matchReasons = match.matchReasons ?? null;
      existing.skillsMatch = match.skillsMatch ?? null;
      existing.experienceMatch = match.experienceMatch ?? null;
      existing.locationMatch = match.locationMatch ?? null;
      existing.salaryMatch = match.salaryMatch ?? null;
      existing.updatedAt = new Date();
      return { insertId: existing.id, existing: true };
    }

    const now = new Date();
    const record = {
      ...match,
      id: memoryJobMatches.length + 1,
      matchReasons: match.matchReasons ?? null,
      skillsMatch: match.skillsMatch ?? null,
      experienceMatch: match.experienceMatch ?? null,
      locationMatch: match.locationMatch ?? null,
      salaryMatch: match.salaryMatch ?? null,
      createdAt: now,
      updatedAt: now,
    };
    memoryJobMatches.push(record);
    return { insertId: record.id };
  }

  const result = await db
    .insert(jobMatches)
    .values(match)
    .onDuplicateKeyUpdate({
      set: {
        id: sql`LAST_INSERT_ID(${jobMatches.id})`,
        matchScore: sql`VALUES(${jobMatches.matchScore})`,
        matchReasons: sql`VALUES(${jobMatches.matchReasons})`,
        skillsMatch: sql`VALUES(${jobMatches.skillsMatch})`,
        experienceMatch: sql`VALUES(${jobMatches.experienceMatch})`,
        locationMatch: sql`VALUES(${jobMatches.locationMatch})`,
        salaryMatch: sql`VALUES(${jobMatches.salaryMatch})`,
        updatedAt: new Date(),
      },
    });
  const writeResult = result[0];
  return {
    insertId: Number(writeResult.insertId),
    existing: Number(writeResult.affectedRows) !== 1,
  };
}

export async function createCanonicalJobMatches(matches: InsertJobMatch[]) {
  if (matches.length === 0) return;
  const db = await getDb();
  if (!db) {
    for (const match of matches) {
      await createJobMatch(match);
    }
    return;
  }

  await db
    .insert(jobMatches)
    .values(matches)
    .onDuplicateKeyUpdate({
      set: {
        matchScore: sql`VALUES(${jobMatches.matchScore})`,
        matchReasons: sql`VALUES(${jobMatches.matchReasons})`,
        skillsMatch: sql`VALUES(${jobMatches.skillsMatch})`,
        experienceMatch: sql`VALUES(${jobMatches.experienceMatch})`,
        locationMatch: sql`VALUES(${jobMatches.locationMatch})`,
        salaryMatch: sql`VALUES(${jobMatches.salaryMatch})`,
        updatedAt: new Date(),
      },
    });
}

export async function getUserJobMatches(userId: number, minScore = 70) {
  const db = await getDb();
  if (!db) {
    return memoryJobMatches
      .filter((match) => match.userId === userId && match.matchScore >= minScore)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()) as JobMatch[];
  }
  return await db
    .select()
    .from(jobMatches)
    .where(and(eq(jobMatches.userId, userId), gte(jobMatches.matchScore, minScore)))
    .orderBy(desc(jobMatches.updatedAt));
}

export async function getUserJobMatchesForJobs(userId: number, requestedJobIds: number[]) {
  const jobIds = Array.from(new Set(
    requestedJobIds.filter((jobId) => Number.isInteger(jobId) && jobId > 0)
  ));
  if (jobIds.length === 0) return [] as JobMatch[];

  const db = await getDb();
  if (!db) {
    const requested = new Set(jobIds);
    return memoryJobMatches.filter((match) =>
      match.userId === userId && requested.has(match.jobId)
    ) as JobMatch[];
  }

  const matches: JobMatch[] = [];
  for (let offset = 0; offset < jobIds.length; offset += 500) {
    const rows = await db
      .select()
      .from(jobMatches)
      .where(and(
        eq(jobMatches.userId, userId),
        inArray(jobMatches.jobId, jobIds.slice(offset, offset + 500))
      ));
    matches.push(...rows);
  }
  return matches;
}

// Decision Makers
export async function getDecisionMakerByCompany(company: string) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(decisionMakers).where(eq(decisionMakers.company, company));
}

export async function createDecisionMaker(decisionMaker: InsertDecisionMaker) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(decisionMakers).values(decisionMaker);
}

// Work Experiences
export async function getWorkExperiences(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(workExperiences)
    .where(eq(workExperiences.userId, userId))
    .orderBy(desc(workExperiences.startDate), desc(workExperiences.id))
    .limit(PROFILE_EVIDENCE_LIMITS.workExperiences);
}

export async function createWorkExperience(experience: InsertWorkExperience) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${experience.userId} FOR UPDATE`);
    const [row] = await tx.select({ count: sql<number>`COUNT(*)` }).from(workExperiences)
      .where(eq(workExperiences.userId, experience.userId));
    if (Number(row?.count ?? 0) >= PROFILE_EVIDENCE_LIMITS.workExperiences) {
      throw new Error(profileEvidenceLimitMessage("work experiences", PROFILE_EVIDENCE_LIMITS.workExperiences));
    }
    return await tx.insert(workExperiences).values(experience);
  });
}

export async function getAllWorkExperiencesForPrivacyExport(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(workExperiences)
    .where(eq(workExperiences.userId, userId))
    .orderBy(desc(workExperiences.startDate), desc(workExperiences.id));
}

export async function updateWorkExperience(id: number, userId: number, experience: Partial<InsertWorkExperience>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(workExperiences)
    .set({ ...experience, updatedAt: new Date() })
    .where(and(eq(workExperiences.id, id), eq(workExperiences.userId, userId)));
}

export async function deleteWorkExperience(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(workExperiences).where(and(eq(workExperiences.id, id), eq(workExperiences.userId, userId)));
}

// Education Entries
export async function getEducationEntries(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(educationEntries)
    .where(eq(educationEntries.userId, userId))
    .orderBy(desc(educationEntries.endDate), desc(educationEntries.id))
    .limit(PROFILE_EVIDENCE_LIMITS.educationEntries);
}

export async function createEducationEntry(education: InsertEducationEntry) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${education.userId} FOR UPDATE`);
    const [row] = await tx.select({ count: sql<number>`COUNT(*)` }).from(educationEntries)
      .where(eq(educationEntries.userId, education.userId));
    if (Number(row?.count ?? 0) >= PROFILE_EVIDENCE_LIMITS.educationEntries) {
      throw new Error(profileEvidenceLimitMessage("education entries", PROFILE_EVIDENCE_LIMITS.educationEntries));
    }
    return await tx.insert(educationEntries).values(education);
  });
}

export async function getAllEducationEntriesForPrivacyExport(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(educationEntries)
    .where(eq(educationEntries.userId, userId))
    .orderBy(desc(educationEntries.endDate), desc(educationEntries.id));
}

export async function updateEducationEntry(id: number, userId: number, education: Partial<InsertEducationEntry>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(educationEntries)
    .set({ ...education, updatedAt: new Date() })
    .where(and(eq(educationEntries.id, id), eq(educationEntries.userId, userId)));
}

export async function deleteEducationEntry(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(educationEntries).where(and(eq(educationEntries.id, id), eq(educationEntries.userId, userId)));
}

// User Skills
export async function getUserSkills(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(userSkills)
    .where(eq(userSkills.userId, userId))
    .orderBy(userSkills.sortOrder, userSkills.id)
    .limit(PROFILE_EVIDENCE_LIMITS.skills);
}

export async function createUserSkill(skill: InsertUserSkill) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${skill.userId} FOR UPDATE`);
    const [row] = await tx.select({ count: sql<number>`COUNT(*)` }).from(userSkills)
      .where(eq(userSkills.userId, skill.userId));
    if (Number(row?.count ?? 0) >= PROFILE_EVIDENCE_LIMITS.skills) {
      throw new Error(profileEvidenceLimitMessage("skills", PROFILE_EVIDENCE_LIMITS.skills));
    }
    return await tx.insert(userSkills).values(skill);
  });
}

export async function getAllUserSkillsForPrivacyExport(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(userSkills)
    .where(eq(userSkills.userId, userId))
    .orderBy(userSkills.sortOrder, userSkills.id);
}

export async function updateUserSkill(id: number, userId: number, skill: Partial<InsertUserSkill>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(userSkills)
    .set(skill)
    .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)));
}

export async function deleteUserSkill(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(userSkills).where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)));
}

// User Projects
export async function getUserProjects(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(userProjects)
    .where(eq(userProjects.userId, userId))
    .orderBy(userProjects.sortOrder, userProjects.id)
    .limit(PROFILE_EVIDENCE_LIMITS.projects);
}

export async function createUserProject(project: InsertUserProject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${project.userId} FOR UPDATE`);
    const [row] = await tx.select({ count: sql<number>`COUNT(*)` }).from(userProjects)
      .where(eq(userProjects.userId, project.userId));
    if (Number(row?.count ?? 0) >= PROFILE_EVIDENCE_LIMITS.projects) {
      throw new Error(profileEvidenceLimitMessage("projects", PROFILE_EVIDENCE_LIMITS.projects));
    }
    return await tx.insert(userProjects).values(project);
  });
}

export async function getAllUserProjectsForPrivacyExport(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(userProjects)
    .where(eq(userProjects.userId, userId))
    .orderBy(userProjects.sortOrder, userProjects.id);
}

export async function updateUserProject(id: number, userId: number, project: Partial<InsertUserProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(userProjects)
    .set({ ...project, updatedAt: new Date() })
    .where(and(eq(userProjects.id, id), eq(userProjects.userId, userId)));
}

export async function deleteUserProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(userProjects).where(and(eq(userProjects.id, id), eq(userProjects.userId, userId)));
}
