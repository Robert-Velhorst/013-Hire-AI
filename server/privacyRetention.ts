import { count, eq } from "drizzle-orm";
import {
  adminReviewItems,
  applicationApprovals,
  applicationAttempts,
  applicationCampaigns,
  applicationDecisions,
  applicationMaterials,
  applicationNotes,
  applicationNotifications,
  applications,
  auditEvents,
  autonomousRunStates,
  connectorAuthorizations,
  educationEntries,
  employerResponses,
  employmentVerifications,
  feePayments,
  followUps,
  inboxResponseCandidates,
  interviewPreparation,
  interviewSchedules,
  jobAlerts,
  jobMatches,
  privacyErasureRuns,
  privacyErasureTasks,
  savedJobs,
  socialMediaProfiles,
  successFees,
  userConnectorAccounts,
  userProfiles,
  userProjects,
  userResumes,
  userSkills,
  users,
  workExperiences,
} from "../drizzle/schema";
import { getDb } from "./db";

export const PRIVACY_RETENTION_POLICY_VERSION = "2026-08-09.v1";

export type PrivacyRetentionAction = "erase" | "scrub_and_retain" | "retain";

type DirectPolicyEntry = {
  table: string;
  action: PrivacyRetentionAction;
  reason: string;
  tableRef: any;
  userColumn: any;
  privateObjectColumns?: string[];
  providerRevocationRequired?: boolean;
};

type IndirectPolicyEntry = {
  table: string;
  action: PrivacyRetentionAction;
  reason: string;
  countForUser: (db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) => Promise<number>;
};

const erasableReason = "User-owned product data with no declared statutory retention basis.";
const ledgerReason = "Consequential application evidence is retained only in scrubbed form under an approved retention schedule.";
const regulatedReason = "Billing or employment evidence requires an approved legal retention period before erasure.";

export const directPrivacyRetentionPolicy: DirectPolicyEntry[] = [
  { table: "users", action: "scrub_and_retain", reason: "Authentication identity must be disabled and personal fields irreversibly pseudonymized.", tableRef: users, userColumn: users.id },
  { table: "user_profiles", action: "erase", reason: erasableReason, tableRef: userProfiles, userColumn: userProfiles.userId, privateObjectColumns: ["resume_file_key"] },
  { table: "social_media_profiles", action: "erase", reason: erasableReason, tableRef: socialMediaProfiles, userColumn: socialMediaProfiles.userId },
  { table: "user_connector_accounts", action: "erase", reason: erasableReason, tableRef: userConnectorAccounts, userColumn: userConnectorAccounts.userId, providerRevocationRequired: true },
  { table: "connector_authorizations", action: "erase", reason: "Encrypted grants must be revoked with the provider before local deletion.", tableRef: connectorAuthorizations, userColumn: connectorAuthorizations.userId, providerRevocationRequired: true },
  { table: "applications", action: "scrub_and_retain", reason: ledgerReason, tableRef: applications, userColumn: applications.userId },
  { table: "application_decisions", action: "erase", reason: erasableReason, tableRef: applicationDecisions, userColumn: applicationDecisions.userId },
  { table: "application_attempts", action: "scrub_and_retain", reason: ledgerReason, tableRef: applicationAttempts, userColumn: applicationAttempts.userId, privateObjectColumns: ["screenshot_key"] },
  { table: "employer_responses", action: "scrub_and_retain", reason: ledgerReason, tableRef: employerResponses, userColumn: employerResponses.userId },
  { table: "application_notifications", action: "erase", reason: erasableReason, tableRef: applicationNotifications, userColumn: applicationNotifications.userId },
  { table: "audit_events", action: "scrub_and_retain", reason: "Security and consequential-action evidence requires bounded retention with payload scrubbing.", tableRef: auditEvents, userColumn: auditEvents.userId },
  { table: "admin_review_items", action: "scrub_and_retain", reason: "Compliance decision evidence requires bounded retention with free-text scrubbing.", tableRef: adminReviewItems, userColumn: adminReviewItems.userId },
  { table: "application_approvals", action: "scrub_and_retain", reason: ledgerReason, tableRef: applicationApprovals, userColumn: applicationApprovals.userId },
  { table: "application_campaigns", action: "erase", reason: erasableReason, tableRef: applicationCampaigns, userColumn: applicationCampaigns.userId },
  { table: "autonomous_run_states", action: "erase", reason: erasableReason, tableRef: autonomousRunStates, userColumn: autonomousRunStates.userId },
  { table: "job_matches", action: "erase", reason: erasableReason, tableRef: jobMatches, userColumn: jobMatches.userId },
  { table: "interview_preparation", action: "erase", reason: erasableReason, tableRef: interviewPreparation, userColumn: interviewPreparation.userId },
  { table: "inbox_response_candidates", action: "erase", reason: erasableReason, tableRef: inboxResponseCandidates, userColumn: inboxResponseCandidates.userId },
  { table: "user_resumes", action: "erase", reason: erasableReason, tableRef: userResumes, userColumn: userResumes.userId, privateObjectColumns: ["file_key"] },
  { table: "saved_jobs", action: "erase", reason: erasableReason, tableRef: savedJobs, userColumn: savedJobs.userId },
  { table: "work_experiences", action: "erase", reason: erasableReason, tableRef: workExperiences, userColumn: workExperiences.userId },
  { table: "education_entries", action: "erase", reason: erasableReason, tableRef: educationEntries, userColumn: educationEntries.userId },
  { table: "user_skills", action: "erase", reason: erasableReason, tableRef: userSkills, userColumn: userSkills.userId },
  { table: "user_projects", action: "erase", reason: erasableReason, tableRef: userProjects, userColumn: userProjects.userId },
  { table: "job_alerts", action: "erase", reason: erasableReason, tableRef: jobAlerts, userColumn: jobAlerts.userId },
  { table: "privacy_erasure_runs", action: "scrub_and_retain", reason: "Erasure execution evidence must remain bounded and non-sensitive.", tableRef: privacyErasureRuns, userColumn: privacyErasureRuns.userId },
  { table: "privacy_erasure_tasks", action: "scrub_and_retain", reason: "Itemized cleanup evidence must remain bounded and contains no copied tokens or object keys.", tableRef: privacyErasureTasks, userColumn: privacyErasureTasks.userId },
  { table: "success_fees", action: "retain", reason: regulatedReason, tableRef: successFees, userColumn: successFees.userId, privateObjectColumns: ["offer_letter_key"] },
  { table: "employment_verifications", action: "retain", reason: regulatedReason, tableRef: employmentVerifications, userColumn: employmentVerifications.userId, privateObjectColumns: ["document_key"] },
  { table: "fee_payments", action: "retain", reason: regulatedReason, tableRef: feePayments, userColumn: feePayments.userId },
];

async function countApplicationChildren(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tableRef: any,
  applicationColumn: any,
  userId: number
) {
  const rows = await db
    .select({ value: count() })
    .from(tableRef)
    .innerJoin(applications, eq(applicationColumn, applications.id))
    .where(eq(applications.userId, userId));
  return Number(rows[0]?.value ?? 0);
}

export const indirectPrivacyRetentionPolicy: IndirectPolicyEntry[] = [
  { table: "application_materials", action: "erase", reason: erasableReason, countForUser: (db, userId) => countApplicationChildren(db, applicationMaterials, applicationMaterials.applicationId, userId) },
  { table: "application_notes", action: "erase", reason: erasableReason, countForUser: (db, userId) => countApplicationChildren(db, applicationNotes, applicationNotes.applicationId, userId) },
  { table: "interview_schedules", action: "erase", reason: erasableReason, countForUser: (db, userId) => countApplicationChildren(db, interviewSchedules, interviewSchedules.applicationId, userId) },
  { table: "follow_ups", action: "scrub_and_retain", reason: ledgerReason, countForUser: (db, userId) => countApplicationChildren(db, followUps, followUps.applicationId, userId) },
];

export const privacyRetentionPolicyTables = [
  ...directPrivacyRetentionPolicy.map((entry) => entry.table),
  ...indirectPrivacyRetentionPolicy.map((entry) => entry.table),
];

export async function buildPrivacyErasurePreview(userId: number) {
  const db = await getDb();
  if (!db) {
    return {
      available: false as const,
      policyVersion: PRIVACY_RETENTION_POLICY_VERSION,
      reason: "A persistent production database is required for an authoritative erasure preview.",
      items: [],
      summary: { erase: 0, scrubAndRetain: 0, retain: 0, privateObjects: 0, providerRevocations: 0 },
      executionAllowed: false as const,
    };
  }

  const directItems = await Promise.all(directPrivacyRetentionPolicy.map(async (entry) => {
    const rows = await db.select({ value: count() }).from(entry.tableRef).where(eq(entry.userColumn, userId));
    return {
      table: entry.table,
      action: entry.action,
      reason: entry.reason,
      recordCount: Number(rows[0]?.value ?? 0),
      privateObjectFields: entry.privateObjectColumns?.length ?? 0,
      providerRevocationRequired: Boolean(entry.providerRevocationRequired),
    };
  }));
  const indirectItems = await Promise.all(indirectPrivacyRetentionPolicy.map(async (entry) => ({
    table: entry.table,
    action: entry.action,
    reason: entry.reason,
    recordCount: await entry.countForUser(db, userId),
    privateObjectFields: 0,
    providerRevocationRequired: false,
  })));
  const items = [...directItems, ...indirectItems];

  return {
    available: true as const,
    policyVersion: PRIVACY_RETENTION_POLICY_VERSION,
    generatedAt: new Date(),
    items,
    summary: {
      erase: items.filter((item) => item.action === "erase").reduce((total, item) => total + item.recordCount, 0),
      scrubAndRetain: items.filter((item) => item.action === "scrub_and_retain").reduce((total, item) => total + item.recordCount, 0),
      retain: items.filter((item) => item.action === "retain").reduce((total, item) => total + item.recordCount, 0),
      privateObjects: items.filter((item) => item.recordCount > 0).reduce((total, item) => total + item.privateObjectFields, 0),
      providerRevocations: items.filter((item) => item.recordCount > 0 && item.providerRevocationRequired).length,
    },
    executionAllowed: false as const,
  };
}
