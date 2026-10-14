Warning: truncated output (original token count: 60171)
Total output lines: 6216

import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
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
  operationalFailureSignals,
  autonomousRunStates,
  jobDiscoveryRunState,
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
import { REMOTE_ONLY_EXCLUSION_PATTERN } from "@shared/remoteEligibility";
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
import {
  getOperationalFailureSnapshot,
  logOperationalFailure,
  type OperationalFailureSignal,
} from "./operationalFailureLog";
import {
  ErasedOAuthIdentityError,
  getOAuthIdentityDigests,
  getOAuthIdentityLockName,
} from "./erasedOAuthIdentity";

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

let _db: MySql2Database | null = null;
let _pool: Pool | null = null;
let _poolClose: Promise<void> | null = null;
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
const memoryApplicationTransactionTails = new Map<number, Promise<void>>();
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
let memoryJobDiscoveryLease: {
  leaseToken: string | null;
  leaseExpiresAt: number;
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
} | null = null;

type MemoryRow = { id: number };

function captureMemoryRows<T extends MemoryRow>(rows: T[], matches: (row: T) => boolean) {
  return rows.filter(matches).map((row) => ({ row, values: structuredClone(row) }));
}

function restoreMemoryRows<T extends MemoryRow>(
  rows: T[],
  matches: (row: T) => boolean,
  snapshot: Array<{ row: T; values: T }>
) {
  const snapshotIds = new Set(snapshot.map(({ row }) => row.id));
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (matches(row) && !snapshotIds.has(row.id)) rows.splice(index, 1);
  }
  for (const { row, values } of snapshot) {
    Object.assign(row, structuredClone(values));
    if (!rows.some((current) => current.id === row.id)) rows.push(row);
  }
}

/** Snapshot and roll back the memory-backed evidence belonging to one application. */
export async function withMemoryApplicationTransaction<T>(
  applicationId: number,
  userId: number,
  operation: () => Promise<T>,
  captureLocalRollback: () => () => void = () => () => undefined
): Promise<T> {
  const previous = memoryApplicationTransactionTails.get(applicationId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  memoryApplicationTransactionTails.set(applicationId, current);
  await previous;

  const rollbackLocalState = captureLocalRollback();
  const application = memoryApplications.find((row) => row.id === applicationId && row.userId === userId);
  const applicationBefore = application ? structuredClone(application) : null;
  const auditMatches = (row: (typeof memoryAuditEvents)[number]) =>
    row.userId === userId && row.entityType === "application" && row.entityId === applicationId;
  const responseMatches = (row: (typeof memoryEmployerResponses)[number]) =>
    row.userId === userId && row.applicationId === applicationId;
  const notificationMatches = (row: (typeof memoryApplicationNotifications)[number]) =>
    row.userId === userId && row.applicationId === applicationId;
  const approvalMatches = (row: (typeof memoryApplicationApprovals)[number]) =>
    row.userId === userId && row.applicationId === applicationId;
  const reviewMatches = (row: AdminReviewItem) =>
    row.userId === userId && row.entityType === "application" && row.entityId === applicationId;
  const snapshots = {
    responses: captureMemoryRows(memoryEmployerResponses, responseMatches),
    notifications: captureMemoryRows(memoryApplicationNotifications, notificationMatches),
    audits: captureMemoryRows(memoryAuditEvents, auditMatches),
    approvals: captureMemoryRows(memoryApplicationApprovals, approvalMatches),
    reviews: captureMemoryRows(memoryAdminReviewItems, reviewMatches),
  };

  try {
    return await operation();
  } catch (error) {
    if (application && applicationBefore) Object.assign(application, applicationBefore);
    restoreMemoryRows(memoryEmployerResponses, responseMatches, snapshots.responses);
    restoreMemoryRows(memoryApplicationNotifications, notificationMatches, snapshots.notifications);
    restoreMemoryRows(memoryAuditEvents, auditMatches, snapshots.audits);
    restoreMemoryRows(memoryApplicationApprovals, approvalMatches, snapshots.approvals);
    restoreMemoryRows(memoryAdminReviewItems, reviewMatches, snapshots.reviews);
    rollbackLocalState();
    throw error;
  } finally {
    release();
    if (memoryApplicationTransactionTails.get(applicationId) === current) {
      memoryApplicationTransactionTails.delete(applicationId);
    }
  }
}

const JOB_DISCOVERY_LEASE_NAME = "global";
const JOB_DISCOVERY_LEASE_MS = 2 * 60 * 1000;

export async function acquireJobDiscoveryLease(leaseToken: string) {
  const db = await getDb();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + JOB_DISCOVERY_LEASE_MS);
  if (!db) {
    if (memoryJobDiscoveryLease && memoryJobDiscoveryLease.leaseExpiresAt > now.getTime()) return false;
    memoryJobDiscoveryLease = {
      leaseToken,
      leaseExpiresAt: leaseExpiresAt.getTime(),
      lastStartedAt: now.getTime(),
      lastCompletedAt: memoryJobDiscoveryLease?.lastCompletedAt ?? null,
    };
    return true;
  }

  const canAcquire = sql`(${jobDiscoveryRunState.leaseExpiresAt} IS NULL OR ${jobDiscoveryRunState.leaseExpiresAt} <= ${now})`;
  await db.insert(jobDiscoveryRunState).values({
    name: JOB_DISCOVERY_LEASE_NAME,
    leaseToken,
    leaseExpiresAt,
    lastStartedAt: now,
  }).onDuplicateKeyUpdate({ set: {
    leaseToken: sql`IF(${canAcquire}, ${leaseToken}, ${jobDiscoveryRunState.leaseToken})`,
    leaseExpiresAt: sql`IF(${canAcquire}, ${leaseExpiresAt}, ${jobDiscoveryRunState.leaseExpiresAt})`,
    lastStartedAt: sql`IF(${canAcquire}, ${now}, ${jobDiscoveryRunState.lastStartedAt})`,
  }});
  const state = await db.select({ leaseToken: jobDiscoveryRunState.leaseToken })
    .from(jobDiscoveryRunState)
    .where(eq(jobDiscoveryRunState.name, JOB_DISCOVERY_LEASE_NAME))
    .limit(1);
  return state[0]?.leaseToken === leaseToken;
}

export async function renewJobDiscoveryLease(leaseToken: string) {
  const db = await getDb();
  const leaseExpiresAt = new Date(Date.now() + JOB_DISCOVERY_LEASE_MS);
  if (!db) {
    if (memoryJobDiscoveryLease?.leaseToken !== leaseToken) return false;
    memoryJobDiscoveryLease.leaseExpiresAt = leaseExpiresAt.getTime();
    return true;
  }
  const result = await db.update(jobDiscoveryRunState)
    .set({ leaseExpiresAt })
    .where(and(
      eq(jobDiscoveryRunState.name, JOB_DISCOVERY_LEASE_NAME),
      eq(jobDiscoveryRunState.leaseToken, leaseToken)
    ));
  return Number(result[0].affectedRows) > 0;
}

export async function releaseJobDiscoveryLease(leaseToken: string, completed = false) {
  const db = await getDb();
  if (!db) {
    if (memoryJobDiscoveryLease?.leaseToken !== leaseToken) return false;
    memoryJobDiscoveryLease.leaseToken = null;
    memoryJobDiscoveryLease.leaseExpiresAt = 0;
    if (completed) memoryJobDiscoveryLease.lastCompletedAt = Date.now();
    return true;
  }
  const result = await db.update(jobDiscoveryRunState).set({
    leaseToken: null,
    leaseExpiresAt: null,
    lastCompletedAt: completed ? new Date() : sql`${jobDiscoveryRunState.lastCompletedAt}`,
  }).where(and(
    eq(jobDiscoveryRunState.name, JOB_DISCOVERY_LEASE_NAME),
    eq(jobDiscoveryRunState.leaseToken, leaseToken)
  ));
  return Number(result[0].affectedRows) > 0;
}

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
  if (!_db && !ENV.databaseUrl && ENV.isProduction) {
    throw new Error("Production database is not configured");
  }
  if (!_db && ENV.databaseUrl) {
    try {
      _pool = createPool({
        uri: ENV.databaseUrl,
        waitForConnections: true,
        connectionLimit: ENV.databasePoolLimit,
        maxIdle: ENV.databasePoolLimit,
        idleTimeout: ENV.databasePoolIdleTimeoutMs,
        queueLimit: ENV.databasePoolQueueLimit,
        enableKeepAlive: true,
      });
      _db = drizzle(_pool);
    } catch {
      logOperationalFailure("Database", "Connection initialization");
      _pool = null;
      _db = null;
      throw new Error("Database connection initialization failed");
    }
  }
  return _db;
}

async function isOAuthIdentityErasedOnConnection(
  connection: PoolConnection,
  openId: string
) {
  const digests = getOAuthIdentityDigests(openId);
  if (digests.length === 0) {
    throw new Error("OAuth identity erasure keys are not configured.");
  }
  const predicates = digests.map(() => "(key_version = ? AND identity_hash = ?)");
  const values = digests.flatMap(digest => [digest.keyVersion, digest.identityHash]);
  const [rows] = await connection.query(
    `SELECT id FROM erased_oauth_identities WHERE ${predicates.join(" OR ")} LIMIT 1`,
    values
  );
  return (rows as Array<{ id: number }>).length > 0;
}

export async function isOAuthIdentityErased(openId: string): Promise<boolean> {
  const database = await getDb();
  if (!database || !_pool) return false;
  const connection = await _pool.getConnection();
  try {
    return await isOAuthIdentityErasedOnConnection(connection, openId);
  } finally {
    connection.release();
  }
}

/** Serialize account provisioning and erasure finalization for one OAuth subject. */
export async function withOAuthIdentitySerialization<T>(
  openId: string,
  operation: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  await getDb();
  if (!_pool) throw new Error("A persistent database is required for OAuth identity protection.");
  const lockName = getOAuthIdentityLockName(openId);
  const connection = await _pool.getConnection();
  let lockAcquired = false;
  let connectionUsable = true;
  try {
    const [rows] = await connection.query(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [lockName]
    );
    lockAcquired = Number((rows as Array<{ acquired: number | null }>)[0]?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the OAuth identity serialization lock.");
    }
    return await operation(connection);
  } finally {
    try {
      if (lockAcquired) {
        const [rows] = await connection.query(
          "SELECT RELEASE_LOCK(?) AS released",
          [lockName]
        );
        if (Number((rows as Array<{ released: number | null }>)[0]?.released) !== 1) {
          throw new Error("OAuth identity serialization lock cleanup failed.");
        }
      }
    } catch (error) {
      connection.destroy();
      connectionUsable = false;
      throw error;
    } finally {
      if (connectionUsable) connection.release();
    }
  }
}

/** Serialize job persistence across application replicas sharing this database. */
export async function withJobPersistenceSerialization<T>(
  operation: (database: MySql2Database | null) => Promise<T>
): Promise<T> {
  const database = await getDb();
  if (!database) return operation(null);
  if (!_pool) throw new Error("A persistent database pool is required for job persistence.");

  const databaseUrl = new URL(ENV.databaseUrl);
  const lockSuffix = createHash("sha256").update(databaseUrl.pathname).digest("hex").slice(0, 32);
  const lockName = `hireai:jobpersist:${lockSuffix}`;
  const connection = await _pool.getConnection();
  let lockAcquired = false;
  let connectionUsable = true;
  try {
    const [rows] = await connection.query(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [lockName]
    );
    lockAcquired = Number((rows as Array<{ acquired: number | null }>)[0]?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the job persistence serialization lock.");
    }
    return await operation(drizzle(connection));
  } finally {
    try {
      if (lockAcquired) {
        const [rows] = await connection.query(
          "SELECT RELEASE_LOCK(?) AS released",
          [lockName]
        );
        if (Number((rows as Array<{ released: number | null }>)[0]?.released) !== 1) {
          throw new Error("Job persistence serialization lock cleanup failed.");
        }
      }
    } catch (error) {
      connection.destroy();
      connectionUsable = false;
      throw error;
    } finally {
      if (connectionUsable) connection.release();
    }
  }
}

/** Drain the explicit SQL pool after HTTP requests and workers have stopped. */
export async function closeDatabaseConnection(): Promise<void> {
  if (_poolClose) return _poolClose;
  const pool = _pool;
  if (!pool) return;
  _db = null;
  _pool = null;
  _poolClose = pool.end().finally(() => {
    _poolClose = null;
  });
  return _poolClose;
}

export async function probeDatabaseConnection(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.execute(sql`SELECT 1`);
}

export async function persistOperationalFailureSignals(signals: OperationalFailureSignal[]): Promise<void> {
  if (signals.length === 0) return;
  const db = await getDb();
  if (!db) return;
  await db
    .insert(operationalFailureSignals)
    .values(signals.slice(0, 100).map((signal) => ({
      scope: signal.scope,
      operation: signal.operation,
      count: signal.count,
      firstOccurredAt: new Date(signal.firstOccurredAt),
      lastOccurredAt: new Date(signal.lastOccurredAt),
    })))
    .onDuplicateKeyUpdate({
      set: {
        count: sql`${operationalFailureSignals.count} + VALUES(${operationalFailureSignals.count})`,
        firstOccurredAt: sql`LEAST(${operationalFailureSignals.firstOccurredAt}, VALUES(${operationalFailureSignals.firstOccurredAt}))`,
        lastOccurredAt: sql`GREATEST(${operationalFailureSignals.lastOccurredAt}, VALUES(${operationalFailureSignals.lastOccurredAt}))`,
      },
    });
}

export async function getOperationalFailureMonitoringSnapshot(limit = 20) {
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const db = await getDb();
  if (!db) return getOperationalFailureSnapshot(boundedLimit);
  const [summaryRows, rows] = await Promise.all([
    db.select({
      totalFailures: sql<number>`COALESCE(SUM(${operationalFailureSignals.count}), 0)`,
      uniqueSignals: sql<number>`COUNT(*)`,
      firstOccurredAt: sql<Date | null>`MIN(${operationalFailureSignals.firstOccurredAt})`,
    }).from(operationalFailureSignals),
    db.select({
      scope: operationalFailureSignals.scope,
      operation: operationalFailureSignals.operation,
      count: operationalFailureSignals.count,
      firstOccurredAt: operationalFailureSignals.firstOccurredAt,
      lastOccurredAt: operationalFailureSignals.lastOccurredAt,
    })
      .from(operationalFailureSignals)
      .orderBy(desc(operationalFailureSignals.lastOccurredAt))
      .limit(boundedLimit),
  ]);
  return {
    processStartedAt: summaryRows[0]?.firstOccurredAt
      ? new Date(summaryRows[0].firstOccurredAt).toISOString()
      : new Date().toISOString(),
    totalFailures: Number(summaryRows[0]?.totalFailures ?? 0),
    uniqueSignals: Number(summaryRows[0]?.uniqueSignals ?? 0),
    signals: rows.map((signal) => ({
      ...signal,
      firstOccurredAt: signal.firstOccurredAt.toISOString(),
      lastOccurredAt: signal.lastOccurredAt.toISOString(),
    })),
  };
}

export async function getOperationalFailureAggregateSnapshot() {
  const db = await getDb();
  if (!db) {
    const snapshot = getOperationalFailureSnapshot(1);
    return {
      totalFailures: snapshot.totalFailures,
      uniqueSignals: snapshot.uniqueSignals,
      latestAt: snapshot.signals[0]?.lastOccurredAt ?? null,
    };
  }
  const rows = await db.select({
    totalFailures: sql<number>`COALESCE(SUM(${operationalFailureSignals.count}), 0)`,
    uniqueSignals: sql<number>`COUNT(*)`,
    latestAt: sql<Date | null>`MAX(${operationalFailureSignals.lastOccurredAt})`,
  }).from(operationalFailureSignals);
  return {
    totalFailures: Number(rows[0]?.totalFailures ?? 0),
    uniqueSignals: Number(rows[0]?.uniqueSignals ?? 0),
    latestAt: rows[0]?.latestAt?.toISOString() ?? null,
  };
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
      sessionVersion: user.sessionVersion ?? 0,
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
    if (user.acco…45171 tokens truncated…pproval[];

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

