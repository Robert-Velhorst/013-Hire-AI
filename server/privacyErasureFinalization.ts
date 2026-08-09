import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
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
  userConnectorAccounts,
  userProfiles,
  userProjects,
  userResumes,
  userSkills,
  users,
  workExperiences,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  PRIVACY_RETENTION_POLICY_VERSION,
  privacyRetentionPolicyTables,
} from "./privacyRetention";

const DATABASE_LEASE_MS = 5 * 60 * 1000;

export const privacyFinalizerPolicyTables = [
  "users",
  "user_profiles",
  "social_media_profiles",
  "user_connector_accounts",
  "connector_authorizations",
  "applications",
  "application_decisions",
  "application_materials",
  "application_attempts",
  "employer_responses",
  "application_notifications",
  "audit_events",
  "admin_review_items",
  "application_approvals",
  "application_campaigns",
  "autonomous_run_states",
  "job_matches",
  "interview_preparation",
  "follow_ups",
  "inbox_response_candidates",
  "user_resumes",
  "saved_jobs",
  "application_notes",
  "interview_schedules",
  "work_experiences",
  "education_entries",
  "user_skills",
  "user_projects",
  "job_alerts",
  "privacy_erasure_runs",
  "privacy_erasure_tasks",
  "success_fees",
  "employment_verifications",
  "fee_payments",
  "workspace_members",
  "workspaces",
  "workspace_invitations",
] as const;

export function assertPrivacyFinalizerCoverage() {
  const policy = [...privacyRetentionPolicyTables].sort().join("\n");
  const finalizer = [...privacyFinalizerPolicyTables].sort().join("\n");
  if (policy !== finalizer) {
    throw new Error(
      "Privacy finalization is disabled because policy table coverage has drifted."
    );
  }
}

export function privacyDatabaseErasureConfirmation(
  userId: number,
  policyVersion: string
) {
  return `ERASE DATABASE USER ${userId} USING ${policyVersion}`;
}

function affectedRows(result: unknown) {
  const packet = Array.isArray(result) ? result[0] : result;
  return Number(
    (packet as { affectedRows?: number } | undefined)?.affectedRows ?? 0
  );
}

export async function finalizePrivacyErasure(
  runId: number,
  confirmation: string,
  options: { beforeCommit?: () => Promise<void> } = {}
) {
  assertPrivacyFinalizerCoverage();
  const db = await getDb();
  if (!db) {
    throw new Error(
      "A persistent production database is required for erasure finalization."
    );
  }
  const run = (
    await db
      .select()
      .from(privacyErasureRuns)
      .where(eq(privacyErasureRuns.id, runId))
      .limit(1)
  )[0];
  if (!run) throw new Error("Privacy erasure run not found.");
  if (run.policyVersion !== PRIVACY_RETENTION_POLICY_VERSION) {
    throw new Error(
      "The erasure run uses an outdated retention policy and must be replanned."
    );
  }
  if (
    confirmation !==
    privacyDatabaseErasureConfirmation(run.userId, run.policyVersion)
  ) {
    throw new Error("The database erasure confirmation text does not match.");
  }
  if (run.status === "completed") {
    return { success: true, existing: true, runId, userId: run.userId };
  }
  const now = new Date();
  const staleDatabaseLease =
    run.status === "database_in_progress" &&
    run.executionLeaseExpiresAt !== null &&
    run.executionLeaseExpiresAt < now;
  if (run.status === "database_in_progress" && !staleDatabaseLease) {
    throw new Error(
      "Another database erasure worker currently holds this run."
    );
  }
  if (run.status !== "ready_for_database" && !staleDatabaseLease) {
    throw new Error(
      `Privacy erasure finalization cannot run from status ${run.status}.`
    );
  }

  const ownedWorkspaces = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.createdByUserId, run.userId));
  if (ownedWorkspaces.length > 0) {
    const activeOtherMember = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(and(
        inArray(workspaceMembers.workspaceId, ownedWorkspaces.map(item => item.id)),
        eq(workspaceMembers.status, "active"),
        sql`${workspaceMembers.userId} <> ${run.userId}`
      ))
      .limit(1);
    if (activeOtherMember.length > 0) {
      throw new Error("Transfer workspace ownership or remove all other active members before account erasure.");
    }
  }

  const unfinishedExternalTasks = await db
    .select({ id: privacyErasureTasks.id })
    .from(privacyErasureTasks)
    .where(
      and(
        eq(privacyErasureTasks.runId, runId),
        inArray(privacyErasureTasks.kind, [
          "provider_revoke",
          "private_object_delete",
        ]),
        inArray(privacyErasureTasks.status, [
          "pending",
          "blocked",
          "in_progress",
          "failed",
        ])
      )
    )
    .limit(1);
  if (unfinishedExternalTasks.length > 0) {
    throw new Error(
      "External provider and private-object cleanup must complete first."
    );
  }

  const leaseId = randomUUID();
  const claimed = await db
    .update(privacyErasureRuns)
    .set({
      status: "database_in_progress",
      executionLeaseId: leaseId,
      executionLeaseExpiresAt: new Date(now.getTime() + DATABASE_LEASE_MS),
      failureSummary: null,
    })
    .where(
      and(
        eq(privacyErasureRuns.id, runId),
        inArray(privacyErasureRuns.status, [
          "ready_for_database",
          "database_in_progress",
        ]),
        or(
          isNull(privacyErasureRuns.executionLeaseId),
          lt(privacyErasureRuns.executionLeaseExpiresAt, now)
        )
      )
    );
  if (affectedRows(claimed) !== 1) {
    throw new Error(
      "Another database erasure worker currently holds this run."
    );
  }

  try {
    const result = await db.transaction(async tx => {
      const userIdentity = (await tx.select({ email: users.email }).from(users).where(eq(users.id, run.userId)).limit(1))[0];
      const applicationRows = await tx
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.userId, run.userId));
      const applicationIds = applicationRows.map(row => row.id);
      const deleted: Record<string, number> = {};
      const scrubbed: Record<string, number> = {};

      const remove = async (name: string, operation: Promise<unknown>) => {
        deleted[name] = affectedRows(await operation);
      };
      const scrub = async (name: string, operation: Promise<unknown>) => {
        scrubbed[name] = affectedRows(await operation);
      };

      if (applicationIds.length > 0) {
        await remove(
          "application_materials",
          tx
            .delete(applicationMaterials)
            .where(inArray(applicationMaterials.applicationId, applicationIds))
        );
        await remove(
          "application_notes",
          tx
            .delete(applicationNotes)
            .where(inArray(applicationNotes.applicationId, applicationIds))
        );
        await remove(
          "interview_schedules",
          tx
            .delete(interviewSchedules)
            .where(inArray(interviewSchedules.applicationId, applicationIds))
        );
        await scrub(
          "follow_ups",
          tx
            .update(followUps)
            .set({
              message: null,
              deliveryConfirmation: null,
              deliveryRecipient: null,
              deliverySubject: null,
              deliveryMessageId: null,
              deliveryAttemptKey: null,
              deliveryFailureMessage: null,
            })
            .where(inArray(followUps.applicationId, applicationIds))
        );
      }

      const erasableDirect = [
        [
          "application_notifications",
          applicationNotifications,
          applicationNotifications.userId,
        ],
        [
          "application_decisions",
          applicationDecisions,
          applicationDecisions.userId,
        ],
        [
          "application_campaigns",
          applicationCampaigns,
          applicationCampaigns.userId,
        ],
        [
          "autonomous_run_states",
          autonomousRunStates,
          autonomousRunStates.userId,
        ],
        ["job_matches", jobMatches, jobMatches.userId],
        [
          "interview_preparation",
          interviewPreparation,
          interviewPreparation.userId,
        ],
        [
          "inbox_response_candidates",
          inboxResponseCandidates,
          inboxResponseCandidates.userId,
        ],
        ["saved_jobs", savedJobs, savedJobs.userId],
        ["job_alerts", jobAlerts, jobAlerts.userId],
        ["user_resumes", userResumes, userResumes.userId],
        ["work_experiences", workExperiences, workExperiences.userId],
        ["education_entries", educationEntries, educationEntries.userId],
        ["user_skills", userSkills, userSkills.userId],
        ["user_projects", userProjects, userProjects.userId],
        [
          "social_media_profiles",
          socialMediaProfiles,
          socialMediaProfiles.userId,
        ],
        [
          "connector_authorizations",
          connectorAuthorizations,
          connectorAuthorizations.userId,
        ],
        [
          "user_connector_accounts",
          userConnectorAccounts,
          userConnectorAccounts.userId,
        ],
        ["user_profiles", userProfiles, userProfiles.userId],
      ] as const;
      for (const [name, table, userColumn] of erasableDirect) {
        await remove(name, tx.delete(table).where(eq(userColumn, run.userId)));
      }

      const invitationOwnership = [
        eq(workspaceInvitations.invitedByUserId, run.userId),
        eq(workspaceInvitations.acceptedByUserId, run.userId),
      ];
      if (userIdentity?.email) {
        invitationOwnership.push(eq(workspaceInvitations.email, userIdentity.email.trim().toLowerCase()));
      }
      await remove(
        "workspace_invitations",
        tx.delete(workspaceInvitations).where(or(...invitationOwnership))
      );
      await remove(
        "workspaces",
        tx.delete(workspaces).where(eq(workspaces.createdByUserId, run.userId))
      );
      await remove(
        "workspace_members",
        tx.delete(workspaceMembers).where(eq(workspaceMembers.userId, run.userId))
      );

      await scrub(
        "applications",
        tx
          .update(applications)
          .set({ coverLetter: null, customResume: null, notes: null })
          .where(eq(applications.userId, run.userId))
      );
      await scrub(
        "application_attempts",
        tx
          .update(applicationAttempts)
          .set({
            errorMessage: null,
            confirmationText: null,
            confirmationUrl: null,
            screenshotKey: null,
          })
          .where(eq(applicationAttempts.userId, run.userId))
      );
      await scrub(
        "employer_responses",
        tx
          .update(employerResponses)
          .set({ sourceReference: null, summary: "[privacy scrubbed]" })
          .where(eq(employerResponses.userId, run.userId))
      );
      await scrub(
        "application_approvals",
        tx
          .update(applicationApprovals)
          .set({
            title: "[privacy scrubbed]",
            description: null,
            payload: null,
            decisionNote: null,
          })
          .where(eq(applicationApprovals.userId, run.userId))
      );
      await scrub(
        "audit_events",
        tx
          .update(auditEvents)
          .set({ beforeState: null, afterState: null })
          .where(eq(auditEvents.userId, run.userId))
      );
      await scrub(
        "admin_review_items",
        tx
          .update(adminReviewItems)
          .set({
            title: "[privacy review retained]",
            description: null,
            resolution:
              "Retention decision completed under the recorded policy.",
          })
          .where(eq(adminReviewItems.userId, run.userId))
      );

      const pseudonymousOpenId = `erased-${run.id}-${randomUUID()}`.slice(
        0,
        64
      );
      await scrub(
        "users",
        tx
          .update(users)
          .set({
            openId: pseudonymousOpenId,
            name: null,
            email: null,
            loginMethod: null,
            stripeCustomerId: null,
            accountStatus: "suspended",
          })
          .where(eq(users.id, run.userId))
      );

      await options.beforeCommit?.();

      await tx
        .update(privacyErasureTasks)
        .set({
          status: "completed",
          sourceRecordId: null,
          sourceColumn: null,
          completionEvidence: sql`CASE
            WHEN ${privacyErasureTasks.kind} = 'retention_hold'
              THEN 'Retained under the recorded policy; user identity was pseudonymized.'
            WHEN ${privacyErasureTasks.kind} = 'database_finalize'
              THEN 'Transactional database finalization completed.'
            ELSE NULL
          END`,
          lastErrorCode: null,
          completedAt: sql`COALESCE(${privacyErasureTasks.completedAt}, NOW())`,
        })
        .where(eq(privacyErasureTasks.runId, runId));
      await tx
        .update(privacyErasureRuns)
        .set({
          status: "completed",
          inventorySnapshot: JSON.stringify({
            policyVersion: run.policyVersion,
            deleted,
            scrubbed,
            regulatedRecordsRetained: true,
          }),
          failureSummary: null,
          executionLeaseId: null,
          executionLeaseExpiresAt: null,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(privacyErasureRuns.id, runId),
            eq(privacyErasureRuns.executionLeaseId, leaseId)
          )
        );
      return { deleted, scrubbed };
    });
    return {
      success: true,
      existing: false,
      runId,
      userId: run.userId,
      ...result,
    };
  } catch (error) {
    await db
      .update(privacyErasureRuns)
      .set({
        status: "ready_for_database",
        failureSummary:
          "Transactional database finalization failed and was rolled back.",
        executionLeaseId: null,
        executionLeaseExpiresAt: null,
      })
      .where(
        and(
          eq(privacyErasureRuns.id, runId),
          eq(privacyErasureRuns.executionLeaseId, leaseId),
          isNotNull(privacyErasureRuns.executionLeaseId)
        )
      );
    throw error;
  }
}
