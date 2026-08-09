/**
 * Application Features Service
 * Handles saved jobs, application notes, interview scheduling, and follow-up emails
 */

import { eq, and, desc, asc, sql, inArray, isNull, lte, lt, or, gt } from "drizzle-orm";
import {
  createApplicationApproval,
  createAdminReviewItem,
  createApplicationAttempt,
  createAuditEvent,
  createEmployerResponse,
  createInterviewNotification,
  dismissOfferAttributionAdminReviews,
  findEmployerResponseBySourceReference,
  getEmployerResponseReplyTarget,
  getEmployerResponses,
  getInterviewPreparationForJob,
  getInterviewPreparationsForJobs,
  getDb,
  getCanonicalJobId,
  getApplicationLedgerArtifacts,
  getJobById,
  getUserApplicationById,
  getUserApplicationStatusPage,
  getUserApplicationsByIds,
  getUserEmployerResponsesForApplications,
  listUserApplicationApprovalsForApplication,
  markUnreadInterviewNotificationsReadForApplication,
  resolveApplicationApproval,
  touchApplicationActivity,
  updateApplicationStatus,
  upsertInterviewPreparation,
} from "./db";
import { savedJobs, applicationNotes, interviewSchedules, interviewPreparation, followUps, applications, applicationAttempts, employerResponses, applicationNotifications, auditEvents, adminReviewItems, applicationApprovals, jobs, jobAlerts, jobDuplicates, jobPlatforms, users, type Application, type ApplicationApproval, type EmployerResponse, type FollowUp, type InterviewSchedule, type JobAlertConfig } from "../drizzle/schema";
import { matchesJobAlert } from "../shared/jobAlertMatching";
import { isJobListingCurrent } from "../shared/jobListingFreshness";
import { generateInterviewPreparation as generateAiInterviewPreparation } from "./aiMatching";
import { invokeLLM } from "./_core/llm";
import {
  canTransitionApplicationStatus,
  canTransitionInterviewStatus,
  type ApplicationStatus,
} from "./applicationLifecycle";
import { sanitizeFollowUpMessage } from "./messageSanitization";
import {
  normalizeSubmissionEvidence,
  type SubmissionEvidenceInput,
} from "./applicationSubmissionEvidence";
import {
  normalizeEmployerResponse,
  normalizeEmployerResponseSourceReference,
  type EmployerResponseInput,
} from "./applicationResponses";
import {
  getInterviewSchedulingRequirement,
  getLatestSchedulableInterviewInvite,
  type InterviewSchedulingRequirement,
} from "./interviewScheduling";

async function assertUserOwnsApplication(applicationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select({ id: applications.id, status: applications.status })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);

  if (result.length === 0) {
    throw new Error("Application not found");
  }
  return result[0];
}

// ==================== SAVED JOBS ====================

export interface SaveJobInput {
  userId: number;
  jobId: number;
  notes?: string;
  tags?: string;
  priority?: "low" | "medium" | "high";
}

const memorySavedJobs: {
  id: number;
  userId: number;
  jobId: number;
  notes: string | null;
  tags: string | null;
  priority: "low" | "medium" | "high";
  createdAt: Date;
  updatedAt: Date;
}[] = [];

function nextMemorySavedJobId() {
  return (memorySavedJobs.reduce((max, item) => Math.max(max, item.id), 0) || 0) + 1;
}

export async function saveJob(input: SaveJobInput) {
  const canonicalJobId = await getCanonicalJobId(input.jobId);
  if (canonicalJobId === null) throw new Error("Job not found.");
  input = { ...input, jobId: canonicalJobId };
  const db = await getDb();
  if (!db) {
    const existing = memorySavedJobs.find((item) =>
      item.userId === input.userId && item.jobId === input.jobId
    );
    if (existing) {
      existing.notes = input.notes ?? existing.notes;
      existing.tags = input.tags ?? existing.tags;
      existing.priority = input.priority ?? existing.priority;
      existing.updatedAt = new Date();
      return { id: existing.id, updated: true };
    }

    const record = {
      id: nextMemorySavedJobId(),
      userId: input.userId,
      jobId: input.jobId,
      notes: input.notes || null,
      tags: input.tags || null,
      priority: input.priority || "medium",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memorySavedJobs.push(record);
    return { id: record.id, updated: false };
  }

  const result = await db
    .insert(savedJobs)
    .values({
      userId: input.userId,
      jobId: input.jobId,
      notes: input.notes ?? null,
      tags: input.tags ?? null,
      priority: input.priority ?? "medium",
    })
    .onDuplicateKeyUpdate({
      set: {
        id: sql`LAST_INSERT_ID(${savedJobs.id})`,
        notes: input.notes === undefined
          ? sql`${savedJobs.notes}`
          : sql`VALUES(${savedJobs.notes})`,
        tags: input.tags === undefined
          ? sql`${savedJobs.tags}`
          : sql`VALUES(${savedJobs.tags})`,
        priority: input.priority === undefined
          ? sql`${savedJobs.priority}`
          : sql`VALUES(${savedJobs.priority})`,
        updatedAt: new Date(),
      },
    });

  return {
    id: Number(result[0].insertId),
    updated: Number(result[0].affectedRows) !== 1,
  };
}

export async function unsaveJob(userId: number, jobId: number) {
  const canonicalJobId = await getCanonicalJobId(jobId);
  if (canonicalJobId === null) return { success: true };
  jobId = canonicalJobId;
  const db = await getDb();
  if (!db) {
    const index = memorySavedJobs.findIndex((item) =>
      item.userId === userId && item.jobId === jobId
    );
    if (index >= 0) {
      memorySavedJobs.splice(index, 1);
    }
    return { success: true };
  }

  await db
    .delete(savedJobs)
    .where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)));

  return { success: true };
}

export async function getSavedJobs(userId: number) {
  const db = await getDb();
  if (!db) {
    return await Promise.all(
      memorySavedJobs
        .filter((item) => item.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(async (item) => {
          const job = await getJobById(item.jobId);
          return {
            id: item.id,
            jobId: item.jobId,
            notes: item.notes,
            tags: item.tags,
            priority: item.priority,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            job: job ? {
              id: job.id,
              title: job.title,
              company: job.company,
              location: job.location,
              salaryMin: job.salaryMin,
              salaryMax: job.salaryMax,
              salaryCurrency: job.salaryCurrency,
              jobType: job.jobType,
              applicationUrl: job.applicationUrl,
            } : null,
          };
        })
    );
  }

  const result = await db
    .select({
      id: savedJobs.id,
      jobId: savedJobs.jobId,
      notes: savedJobs.notes,
      tags: savedJobs.tags,
      priority: savedJobs.priority,
      createdAt: savedJobs.createdAt,
      updatedAt: savedJobs.updatedAt,
      job: {
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        location: jobs.location,
        salaryMin: jobs.salaryMin,
        salaryMax: jobs.salaryMax,
        salaryCurrency: jobs.salaryCurrency,
        jobType: jobs.jobType,
        applicationUrl: jobs.applicationUrl,
      },
    })
    .from(savedJobs)
    .leftJoin(jobs, eq(savedJobs.jobId, jobs.id))
    .where(eq(savedJobs.userId, userId))
    .orderBy(desc(savedJobs.updatedAt));

  return result;
}

export async function getSavedJobPage(
  userId: number,
  options: {
    limit?: number;
    cursor?: { updatedAt: Date; id: number };
  } = {}
) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
  const db = await getDb();
  if (!db) {
    const rows = memorySavedJobs
      .filter((item) => item.userId === userId)
      .filter((item) => !options.cursor || (
        item.updatedAt < options.cursor.updatedAt ||
        (item.updatedAt.getTime() === options.cursor.updatedAt.getTime() && item.id < options.cursor.id)
      ))
      .sort((left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() || right.id - left.id
      )
      .slice(0, limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const items = await Promise.all(pageRows.map(async (item) => {
      const job = await getJobById(item.jobId);
      return {
        ...item,
        job: job ? {
          id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryCurrency: job.salaryCurrency,
          jobType: job.jobType,
          applicationUrl: job.applicationUrl,
        } : null,
      };
    }));
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null,
    };
  }

  const cursorCondition = options.cursor ? or(
    lt(savedJobs.updatedAt, options.cursor.updatedAt),
    and(eq(savedJobs.updatedAt, options.cursor.updatedAt), lt(savedJobs.id, options.cursor.id))
  ) : undefined;
  const rows = await db
    .select({
      id: savedJobs.id,
      jobId: savedJobs.jobId,
      notes: savedJobs.notes,
      tags: savedJobs.tags,
      priority: savedJobs.priority,
      createdAt: savedJobs.createdAt,
      updatedAt: savedJobs.updatedAt,
      job: {
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        location: jobs.location,
        salaryMin: jobs.salaryMin,
        salaryMax: jobs.salaryMax,
        salaryCurrency: jobs.salaryCurrency,
        jobType: jobs.jobType,
        applicationUrl: jobs.applicationUrl,
      },
    })
    .from(savedJobs)
    .leftJoin(jobs, eq(savedJobs.jobId, jobs.id))
    .where(and(eq(savedJobs.userId, userId), cursorCondition))
    .orderBy(desc(savedJobs.updatedAt), desc(savedJobs.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null,
  };
}

export async function updateSavedJobNotes(
  userId: number,
  jobId: number,
  notes: string,
  tags?: string,
  priority?: "low" | "medium" | "high"
) {
  const canonicalJobId = await getCanonicalJobId(jobId);
  if (canonicalJobId === null) throw new Error("Job not found.");
  jobId = canonicalJobId;
  const db = await getDb();
  if (!db) {
    const existing = memorySavedJobs.find((item) =>
      item.userId === userId && item.jobId === jobId
    );
    if (existing) {
      existing.notes = notes;
      existing.tags = tags ?? existing.tags;
      existing.priority = priority ?? existing.priority;
      existing.updatedAt = new Date();
    }
    return { success: true };
  }

  const updateData: Record<string, unknown> = { notes, updatedAt: new Date() };
  if (tags !== undefined) updateData.tags = tags;
  if (priority !== undefined) updateData.priority = priority;

  await db
    .update(savedJobs)
    .set(updateData)
    .where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)));

  return { success: true };
}

// ==================== APPLICATION NOTES ====================

export interface AddNoteInput {
  applicationId: number;
  noteType: "general" | "interview" | "followup" | "research" | "feedback";
  content: string;
}

export async function addApplicationNote(input: AddNoteInput, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await assertUserOwnsApplication(input.applicationId, userId);

  const result = await db.insert(applicationNotes).values({
    applicationId: input.applicationId,
    noteType: input.noteType,
    content: input.content,
  });

  return { id: Number(result[0].insertId) };
}

export async function getApplicationNotes(applicationId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  await assertUserOwnsApplication(applicationId, userId);

  return await db
    .select()
    .from(applicationNotes)
    .where(eq(applicationNotes.applicationId, applicationId))
    .orderBy(desc(applicationNotes.createdAt));
}

export async function updateApplicationNote(noteId: number, content: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(applicationNotes)
    .set({ content })
    .where(
      and(
        eq(applicationNotes.id, noteId),
        sql`EXISTS (
          SELECT 1 FROM applications
          WHERE applications.id = ${applicationNotes.applicationId}
          AND applications.user_id = ${userId}
        )`
      )
    );

  return { success: true };
}

export async function deleteApplicationNote(noteId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .delete(applicationNotes)
    .where(
      and(
        eq(applicationNotes.id, noteId),
        sql`EXISTS (
          SELECT 1 FROM applications
          WHERE applications.id = ${applicationNotes.applicationId}
          AND applications.user_id = ${userId}
        )`
      )
    );
  return { success: true };
}

// ==================== SUBMISSION CONFIRMATION ====================

export interface ConfirmSubmissionInput extends SubmissionEvidenceInput {
  applicationId: number;
}

function isMatchingSubmissionEvidence(
  attempt: { confirmationText?: string | null; confirmationUrl?: string | null },
  evidence: { noteContent: string; confirmationUrl: string | null }
) {
  return attempt.confirmationText === evidence.noteContent &&
    (attempt.confirmationUrl || null) === evidence.confirmationUrl;
}

export async function confirmApplicationSubmission(input: ConfirmSubmissionInput, userId: number) {
  const db = await getDb();
  const evidence = normalizeSubmissionEvidence(input);

  if (!db) {
    const application = await getUserApplicationById(userId, input.applicationId);
    if (!application) throw new Error("Application not found.");

    const currentStatus = application.status || "pending";
    if (!canTransitionApplicationStatus(currentStatus, "applied")) {
      throw new Error(`Application cannot move from ${currentStatus} to applied.`);
    }

    const artifacts = await getApplicationLedgerArtifacts(input.applicationId, userId);
    const recordedSubmission = artifacts.attempts.find((attempt) =>
      attempt.attemptType === "manual_confirmation" && attempt.status === "submitted"
    );
    if (currentStatus === "applied" && recordedSubmission) {
      if (isMatchingSubmissionEvidence(recordedSubmission, evidence)) {
        return {
          success: true,
          status: "applied" as const,
          evidenceAttemptId: recordedSubmission.id,
          existing: true,
        };
      }
      throw new Error("Application submission is already confirmed. Add any new proof as an application note instead.");
    }

    const confirmedAt = new Date();
    const submissionApproval = (await listUserApplicationApprovalsForApplication(userId, input.applicationId)).find((approval) =>
      approval.entityType === "application" &&
      approval.entityId === input.applicationId &&
      approval.approvalType === "application_submission"
    );
    let approvalId: number;
    if (submissionApproval?.status === "rejected" || submissionApproval?.status === "cancelled") {
      throw new Error("Application submission approval was rejected or cancelled.");
    } else if (submissionApproval?.status === "pending") {
      approvalId = submissionApproval.id;
      await resolveApplicationApproval(
        approvalId,
        userId,
        "approved",
        "Approved through manual submission evidence confirmation.",
        "user"
      );
    } else if (submissionApproval?.status === "approved") {
      approvalId = submissionApproval.id;
    } else {
      const approval = await createApplicationApproval({
        userId,
        applicationId: input.applicationId,
        entityType: "application",
        entityId: input.applicationId,
        approvalType: "application_submission",
        status: "approved",
        riskLevel: "high",
        requestedBy: "user",
        decidedBy: "user",
        title: "Manual submission confirmed",
        description: "User confirmed application submission with evidence.",
        payload: JSON.stringify({
          source: evidence.source,
          confirmationUrl: evidence.confirmationUrl,
        }),
        decisionNote: "Manual submission evidence confirmed by user.",
        requestedAt: confirmedAt,
        decidedAt: confirmedAt,
      });
      approvalId = Number(approval.insertId);
    }

    if (currentStatus !== "applied") {
      await updateApplicationStatus(input.applicationId, "applied", userId);
    }

    const attempt = await createApplicationAttempt({
      applicationId: input.applicationId,
      userId,
      jobId: application.jobId,
      platformId: application.job?.platformId ?? undefined,
      attemptType: "manual_confirmation",
      status: "submitted",
      startedAt: confirmedAt,
      finishedAt: confirmedAt,
      confirmationText: evidence.noteContent,
      confirmationUrl: evidence.confirmationUrl,
      retryCount: 0,
    });
    const attemptId = Number(attempt.insertId);

    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: input.applicationId,
      action: "application_submission_confirmed",
      actor: "user",
      source: "applications.confirmSubmission",
      beforeState: JSON.stringify({ status: currentStatus }),
      afterState: JSON.stringify({
        status: "applied",
        evidenceSource: evidence.source,
        confirmationUrl: evidence.confirmationUrl,
        attemptId,
      }),
      riskLevel: "high",
      approvalId,
    });

    return {
      success: true,
      status: "applied" as const,
      evidenceAttemptId: attemptId,
    };
  }

  return await db.transaction(async (tx) => {
    const application = await tx
      .select({
        id: applications.id,
        userId: applications.userId,
        jobId: applications.jobId,
        status: applications.status,
        platformId: jobs.platformId,
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(and(eq(applications.id, input.applicationId), eq(applications.userId, userId)))
      .limit(1);
    if (!application[0]) throw new Error("Application not found.");

    const currentStatus = application[0].status;
    if (!canTransitionApplicationStatus(currentStatus, "applied")) {
      throw new Error(`Application cannot move from ${currentStatus} to applied.`);
    }

    const recordedSubmission = await tx
      .select({
        id: applicationAttempts.id,
        confirmationText: applicationAttempts.confirmationText,
        confirmationUrl: applicationAttempts.confirmationUrl,
      })
      .from(applicationAttempts)
      .where(and(
        eq(applicationAttempts.applicationId, input.applicationId),
        eq(applicationAttempts.userId, userId),
        eq(applicationAttempts.attemptType, "manual_confirmation"),
        eq(applicationAttempts.status, "submitted")
      ))
      .orderBy(desc(applicationAttempts.createdAt))
      .limit(1);
    if (currentStatus === "applied" && recordedSubmission[0]) {
      if (isMatchingSubmissionEvidence(recordedSubmission[0], evidence)) {
        return {
          success: true,
          status: "applied" as const,
          evidenceAttemptId: recordedSubmission[0].id,
          existing: true,
        };
      }
      throw new Error("Application submission is already confirmed. Add any new proof as an application note instead.");
    }

    const confirmedAt = new Date();
    const submissionApproval = await tx
      .select({ id: applicationApprovals.id, status: applicationApprovals.status })
      .from(applicationApprovals)
      .where(and(
        eq(applicationApprovals.userId, userId),
        eq(applicationApprovals.entityType, "application"),
        eq(applicationApprovals.entityId, input.applicationId),
        eq(applicationApprovals.approvalType, "application_submission")
      ))
      .orderBy(desc(applicationApprovals.createdAt))
      .limit(1);
    let approvalId: number;
    if (submissionApproval[0]?.status === "rejected" || submissionApproval[0]?.status === "cancelled") {
      throw new Error("Application submission approval was rejected or cancelled.");
    } else if (submissionApproval[0]?.status === "pending") {
      approvalId = submissionApproval[0].id;
      await tx
        .update(applicationApprovals)
        .set({
          status: "approved",
          decidedBy: "user",
          decisionNote: "Approved through manual submission evidence confirmation.",
          decidedAt: confirmedAt,
        })
        .where(eq(applicationApprovals.id, approvalId));
    } else if (submissionApproval[0]?.status === "approved") {
      approvalId = submissionApproval[0].id;
    } else {
      const approval = await tx.insert(applicationApprovals).values({
        userId,
        applicationId: input.applicationId,
        entityType: "application",
        entityId: input.applicationId,
        approvalType: "application_submission",
        status: "approved",
        riskLevel: "high",
        requestedBy: "user",
        decidedBy: "user",
        title: "Manual submission confirmed",
        description: "User confirmed application submission with evidence.",
        payload: JSON.stringify({
          source: evidence.source,
          confirmationUrl: evidence.confirmationUrl,
        }),
        decisionNote: "Manual submission evidence confirmed by user.",
        requestedAt: confirmedAt,
        decidedAt: confirmedAt,
      });
      approvalId = Number(approval[0].insertId);
    }

    if (currentStatus !== "applied") {
      const result = await tx
        .update(applications)
        .set({
          status: "applied",
          appliedDate: confirmedAt,
          lastActivity: confirmedAt,
        })
        .where(and(
          eq(applications.id, input.applicationId),
          eq(applications.userId, userId),
          eq(applications.status, currentStatus)
        ));
      if (Number(result[0].affectedRows) === 0) {
        throw new Error("Application status changed concurrently. Refresh and try again.");
      }
    }

    const note = await tx.insert(applicationNotes).values({
      applicationId: input.applicationId,
      noteType: "general",
      content: evidence.noteContent,
    });

    const attempt = await tx.insert(applicationAttempts).values({
      applicationId: input.applicationId,
      userId: application[0].userId,
      jobId: application[0].jobId,
      platformId: application[0].platformId,
      attemptType: "manual_confirmation",
      status: "submitted",
      startedAt: confirmedAt,
      finishedAt: confirmedAt,
      confirmationText: evidence.noteContent,
      confirmationUrl: evidence.confirmationUrl,
      retryCount: 0,
    });
    const attemptId = Number(attempt[0].insertId);

    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: input.applicationId,
      action: "application_submission_confirmed",
      actor: "user",
      source: "applications.confirmSubmission",
      beforeState: JSON.stringify({ status: currentStatus }),
      afterState: JSON.stringify({
        status: "applied",
        evidenceSource: evidence.source,
        confirmationUrl: evidence.confirmationUrl,
        attemptId,
      }),
      riskLevel: "high",
      approvalId,
    });

    return {
      success: true,
      status: "applied" as const,
      evidenceNoteId: Number(note[0].insertId),
      evidenceAttemptId: attemptId,
    };
  });
}

export interface RecordEmployerResponseInput extends EmployerResponseInput {
  applicationId: number;
  interviewId?: number | null;
}

function existingEmployerResponseResult(response: {
  applicationId: number;
  id: number;
  responseType: EmployerResponseInput["responseType"];
  statusAfter: ApplicationStatus;
}, applicationId: number) {
  if (response.applicationId !== applicationId) {
    throw new Error("This employer response reference is already linked to another application.");
  }

  return {
    success: true,
    existing: true,
    status: response.statusAfter,
    responseType: response.responseType,
    responseId: response.id,
    cancelledFollowUpApprovalIds: [] as number[],
    cancelledOfferAttributionApprovalIds: [] as number[],
    dismissedOfferAttributionReviewIds: [] as number[],
    cancelledInterviewIds: [] as number[],
  };
}

function shouldCancelUnsentFollowUpApprovals(responseType: EmployerResponseInput["responseType"]) {
  return !["viewed", "no_response"].includes(responseType);
}

function staleFollowUpCancellationNote(responseType: EmployerResponseInput["responseType"], responseId: number) {
  return `Employer response ${responseId} (${responseType}) made the unsent follow-up draft stale.`;
}

function shouldRetireOfferAttribution(
  currentStatus: ApplicationStatus,
  responseType: EmployerResponseInput["responseType"]
) {
  return currentStatus === "offer" && responseType === "rejection";
}

function staleOfferAttributionCancellationNote(responseId: number) {
  return `Employer response ${responseId} withdrew or rejected the offer, so offer attribution is no longer actionable.`;
}

function shouldCancelOutstandingInterviews(
  currentStatus: ApplicationStatus,
  responseType: EmployerResponseInput["responseType"]
) {
  return currentStatus === "interview" && responseType === "rejection";
}

function shouldRetireInterviewNotifications(statusAfter: ApplicationStatus) {
  return ["offer", "rejected"].includes(statusAfter);
}

async function retireInterviewNotificationsAfterApplicationClosure(
  applicationId: number,
  userId: number,
  status: "withdrawn" | "accepted",
  source: "applications.withdraw" | "applications.confirmOfferAcceptance"
) {
  const { notificationIds } = await markUnreadInterviewNotificationsReadForApplication(applicationId, userId);
  if (notificationIds.length > 0) {
    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: applicationId,
      action: "interview_notifications_retired_after_application_closure",
      actor: "user",
      source,
      afterState: JSON.stringify({ status, notificationIds }),
      riskLevel: "low",
    });
  }
  return notificationIds;
}

export async function recordEmployerResponse(input: RecordEmployerResponseInput, userId: number) {
  const db = await getDb();
  if (!db) {
    const application = await getUserApplicationById(userId, input.applicationId);
    if (!application) throw new Error("Application not found.");

    const sourceReference = normalizeEmployerResponseSourceReference(input.sourceReference);
    if (sourceReference) {
      const existing = await findEmployerResponseBySourceReference({
        userId,
        source: input.source,
        sourceReference,
      });
      if (existing) return existingEmployerResponseResult(existing, input.applicationId);
    }

    const currentStatus = application.status || "pending";
    const response = normalizeEmployerResponse(input, currentStatus);
    if (response.nextStatus && !canTransitionApplicationStatus(currentStatus, response.nextStatus)) {
      throw new Error(`Application cannot move from ${currentStatus} to ${response.nextStatus}.`);
    }

    const statusAfter = response.nextStatus || currentStatus;
    const responseWrite = await createEmployerResponse({
      applicationId: input.applicationId,
      interviewId: input.interviewId ?? null,
      userId,
      responseType: response.responseType,
      source: response.source,
      sourceReference: response.sourceReference,
      summary: response.summary,
      receivedAt: response.receivedAt,
      statusBefore: currentStatus,
      statusAfter,
      noteId: null,
    });
    const responseId = Number(responseWrite.insertId);

    if (response.responseType === "interview_invite") {
      const notification = await createInterviewNotification({
        userId,
        applicationId: input.applicationId,
        employerResponseId: responseId,
      });
      if (!notification.existing) {
        await createAuditEvent({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "interview_notification_queued",
          actor: "system",
          source: "applications.recordResponse",
          afterState: JSON.stringify({
            employerResponseId: responseId,
            notificationId: notification.notification.id,
            notificationType: "interview_invite",
          }),
          riskLevel: "medium",
        });
      }
    }

    if (response.nextStatus && response.nextStatus !== currentStatus) {
      await updateApplicationStatus(input.applicationId, response.nextStatus, userId);
    } else {
      await touchApplicationActivity(input.applicationId, userId, response.receivedAt);
    }

    const retiredInterviewNotificationIds: number[] = [];
    if (shouldRetireInterviewNotifications(statusAfter)) {
      const { notificationIds } = await markUnreadInterviewNotificationsReadForApplication(
        input.applicationId,
        userId
      );
      retiredInterviewNotificationIds.push(...notificationIds);
      if (notificationIds.length > 0) {
        await createAuditEvent({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "interview_notifications_retired_after_response",
          actor: "system",
          source: "applications.recordResponse",
          afterState: JSON.stringify({
            responseId,
            responseType: response.responseType,
            status: statusAfter,
            notificationIds,
          }),
          riskLevel: "low",
        });
      }
    }

    const cancelledFollowUpApprovalIds: number[] = [];
    if (shouldCancelUnsentFollowUpApprovals(response.responseType)) {
      const unsentFollowUpApprovals = (await listUserApplicationApprovalsForApplication(userId, input.applicationId)).filter((approval) =>
        approval.applicationId === input.applicationId &&
        approval.entityType === "follow_up" &&
        approval.approvalType === "follow_up_send" &&
        ["pending", "approved"].includes(approval.status) &&
        memoryFollowUps.some((followUp) =>
          followUp.id === approval.entityId &&
          followUp.applicationId === input.applicationId &&
          !followUp.sentDate
        )
      );
      const cancelledFollowUpApprovalStatuses = unsentFollowUpApprovals.map((approval) => approval.status);
      for (const approval of unsentFollowUpApprovals) {
        const cancellationNote = staleFollowUpCancellationNote(response.responseType, responseId);
        if (approval.status === "pending") {
          await resolveApplicationApproval(
            approval.id,
            userId,
            "cancelled",
            cancellationNote,
            "user"
          );
        } else {
          approval.status = "cancelled";
          approval.decidedBy = "user";
          approval.decisionNote = cancellationNote;
          approval.decidedAt = response.receivedAt;
          approval.updatedAt = response.receivedAt;
        }
        cancelledFollowUpApprovalIds.push(approval.id);
      }
      if (cancelledFollowUpApprovalIds.length > 0) {
        await createAuditEvent({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "stale_follow_up_approvals_cancelled",
          actor: "system",
          source: "applications.recordResponse",
          afterState: JSON.stringify({
            responseId,
            responseType: response.responseType,
            cancelledApprovalIds: cancelledFollowUpApprovalIds,
            cancelledStatuses: cancelledFollowUpApprovalStatuses,
          }),
          riskLevel: "medium",
        });
      }
    }

    const cancelledOfferAttributionApprovalIds: number[] = [];
    const dismissedOfferAttributionReviewIds: number[] = [];
    if (shouldRetireOfferAttribution(currentStatus, response.responseType)) {
      const staleApprovals = (await listUserApplicationApprovalsForApplication(userId, input.applicationId)).filter((approval) =>
        approval.applicationId === input.applicationId &&
        approval.entityType === "application" &&
        approval.entityId === input.applicationId &&
        approval.approvalType === "offer_attribution" &&
        ["pending", "approved"].includes(approval.status)
      );
      for (const approval of staleApprovals) {
        const cancellationNote = staleOfferAttributionCancellationNote(responseId);
        if (approval.status === "pending") {
          await resolveApplicationApproval(approval.id, userId, "cancelled", cancellationNote, "user");
        } else {
          approval.status = "cancelled";
          approval.decidedBy = "user";
          approval.decisionNote = cancellationNote;
          approval.decidedAt = response.receivedAt;
          approval.updatedAt = response.receivedAt;
        }
        cancelledOfferAttributionApprovalIds.push(approval.id);
      }
      const reviewResult = await dismissOfferAttributionAdminReviews(
        userId,
        input.applicationId,
        "Dismissed because an employer response withdrew or rejected the offer."
      );
      dismissedOfferAttributionReviewIds.push(...reviewResult.dismissedReviewIds);
      if (cancelledOfferAttributionApprovalIds.length > 0 || dismissedOfferAttributionReviewIds.length > 0) {
        await createAuditEvent({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "stale_offer_attribution_retired",
          actor: "system",
          source: "applications.recordResponse",
          afterState: JSON.stringify({
            responseId,
            responseType: response.responseType,
            cancelledApprovalIds: cancelledOfferAttributionApprovalIds,
            dismissedReviewIds: dismissedOfferAttributionReviewIds,
          }),
          riskLevel: "high",
        });
      }
    }

    const cancelledInterviewIds: number[] = [];
    if (shouldCancelOutstandingInterviews(currentStatus, response.responseType)) {
      const cancelledInterviews = memoryInterviewSchedules.filter((interview) =>
        interview.applicationId === input.applicationId &&
        ["scheduled", "rescheduled"].includes(interview.status || "scheduled")
      );
      for (const interview of cancelledInterviews) {
        interview.status = "cancelled";
        interview.updatedAt = response.receivedAt;
        cancelledInterviewIds.push(interview.id);
      }
      if (cancelledInterviewIds.length > 0) {
        await createAuditEvent({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "interviews_cancelled_after_employer_rejection",
          actor: "system",
          source: "applications.recordResponse",
          afterState: JSON.stringify({
            responseId,
            responseType: response.responseType,
            cancelledInterviewIds,
            externalCancellationSent: false,
          }),
          riskLevel: "medium",
        });
      }
    }

    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: input.applicationId,
      action: "employer_response_recorded",
      actor: "user",
      source: "applications.recordResponse",
      beforeState: JSON.stringify({ status: currentStatus }),
      afterState: JSON.stringify({
        status: statusAfter,
        responseId,
        responseType: response.responseType,
        receivedAt: response.receivedAt.toISOString(),
        sourceReferencePresent: Boolean(response.sourceReference),
      }),
      riskLevel: response.responseType === "offer" ? "high" : response.responseType === "interview_invite" ? "medium" : "low",
    });

    if (response.responseType === "offer") {
      const approvalPayload = JSON.stringify({
        applicationId: input.applicationId,
        responseId,
        responseType: response.responseType,
        receivedAt: response.receivedAt.toISOString(),
        source: response.source,
        sourceReference: response.sourceReference,
      });
      await createApplicationApproval({
        userId,
        applicationId: input.applicationId,
        entityType: "application",
        entityId: input.applicationId,
        approvalType: "offer_attribution",
        status: "pending",
        riskLevel: "high",
        requestedBy: "system",
        title: "Confirm offer attribution",
        description: response.noteContent,
        payload: approvalPayload,
      });
      await createAdminReviewItem({
        userId,
        entityType: "application",
        entityId: input.applicationId,
        category: "offer_attribution",
        priority: "high",
        title: "Offer response needs success-fee attribution review",
        description: response.noteContent,
      });
    }

    return {
      success: true,
      existing: false,
      status: statusAfter,
      responseType: response.responseType,
      responseId,
      cancelledFollowUpApprovalIds,
      cancelledOfferAttributionApprovalIds,
      dismissedOfferAttributionReviewIds,
      cancelledInterviewIds,
      retiredInterviewNotificationIds,
    };
  }

  return await db.transaction(async (tx) => {
    const owner = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!owner[0]) throw new Error("Account not found.");

    const application = await tx
      .select({ id: applications.id, userId: applications.userId, status: applications.status })
      .from(applications)
      .where(and(eq(applications.id, input.applicationId), eq(applications.userId, userId)))
      .limit(1);
    if (!application[0]) throw new Error("Application not found.");

    const sourceReference = normalizeEmployerResponseSourceReference(input.sourceReference);
    if (sourceReference) {
      const existing = await tx
        .select({
          id: employerResponses.id,
          applicationId: employerResponses.applicationId,
          responseType: employerResponses.responseType,
          statusAfter: employerResponses.statusAfter,
        })
        .from(employerResponses)
        .where(and(
          eq(employerResponses.userId, userId),
          eq(employerResponses.source, input.source),
          eq(employerResponses.sourceReference, sourceReference)
        ))
        .limit(1);
      if (existing[0]) return existingEmployerResponseResult(existing[0], input.applicationId);
    }

    const response = normalizeEmployerResponse(input, application[0].status);
    if (response.nextStatus && !canTransitionApplicationStatus(application[0].status, response.nextStatus)) {
      throw new Error(`Application cannot move from ${application[0].status} to ${response.nextStatus}.`);
    }

    const note = await tx.insert(applicationNotes).values({
      applicationId: input.applicationId,
      noteType: "feedback",
      content: response.noteContent,
    });
    const noteId = Number(note[0].insertId);
    const statusAfter = response.nextStatus || application[0].status;

    const responseWrite = await tx.insert(employerResponses).values({
      applicationId: input.applicationId,
      interviewId: input.interviewId ?? null,
      userId,
      responseType: response.responseType,
      source: response.source,
      sourceReference: response.sourceReference,
      summary: response.summary,
      receivedAt: response.receivedAt,
      statusBefore: application[0].status,
      statusAfter,
      noteId,
    });
    const responseId = Number(responseWrite[0].insertId);
    const cancelledFollowUpApprovalIds: number[] = [];
    const cancelledOfferAttributionApprovalIds: number[] = [];
    const dismissedOfferAttributionReviewIds: number[] = [];
    const cancelledInterviewIds: number[] = [];
    const retiredInterviewNotificationIds: number[] = [];

    if (response.responseType === "interview_invite") {
      const notification = await tx.insert(applicationNotifications).values({
        userId,
        applicationId: input.applicationId,
        employerResponseId: responseId,
        notificationType: "interview_invite",
      });
      await tx.insert(auditEvents).values({
        userId,
        entityType: "application",
        entityId: input.applicationId,
        action: "interview_notification_queued",
        actor: "system",
        source: "applications.recordResponse",
        afterState: JSON.stringify({
          employerResponseId: responseId,
          notificationId: Number(notification[0].insertId),
          notificationType: "interview_invite",
        }),
        riskLevel: "medium",
      });
    }

    if (response.nextStatus && response.nextStatus !== application[0].status) {
      const updateResult = await tx
        .update(applications)
        .set({
          status: response.nextStatus,
          lastActivity: response.receivedAt,
        })
        .where(and(
          eq(applications.id, input.applicationId),
          eq(applications.userId, userId),
          eq(applications.status, application[0].status)
        ));
      if (Number(updateResult[0].affectedRows) === 0) {
        throw new Error("Application status changed concurrently. Refresh and try again.");
      }
    } else {
      await tx
        .update(applications)
        .set({ lastActivity: response.receivedAt })
        .where(and(eq(applications.id, input.applicationId), eq(applications.userId, userId)));
    }

    if (shouldRetireInterviewNotifications(statusAfter)) {
      const unreadNotifications = await tx
        .select({ id: applicationNotifications.id })
        .from(applicationNotifications)
        .where(and(
          eq(applicationNotifications.applicationId, input.applicationId),
          eq(applicationNotifications.userId, userId),
          isNull(applicationNotifications.readAt)
        ));
      retiredInterviewNotificationIds.push(...unreadNotifications.map((notification) => notification.id));
      if (retiredInterviewNotificationIds.length > 0) {
        await tx
          .update(applicationNotifications)
          .set({ readAt: response.receivedAt })
          .where(and(
            inArray(applicationNotifications.id, retiredInterviewNotificationIds),
            isNull(applicationNotifications.readAt)
          ));
        await tx.insert(auditEvents).values({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "interview_notifications_retired_after_response",
          actor: "system",
          source: "applications.recordResponse",
          afterState: JSON.stringify({
            responseId,
            responseType: response.responseType,
            status: statusAfter,
            notificationIds: retiredInterviewNotificationIds,
          }),
          riskLevel: "low",
        });
      }
    }

    if (shouldCancelUnsentFollowUpApprovals(response.responseType)) {
      const staleApprovals = await tx
        .select({ id: applicationApprovals.id, status: applicationApprovals.status })
        .from(applicationApprovals)
        .innerJoin(followUps, eq(applicationApprovals.entityId, followUps.id))
        .where(and(
          eq(applicationApprovals.userId, userId),
          eq(applicationApprovals.applicationId, input.applicationId),
          eq(applicationApprovals.entityType, "follow_up"),
          eq(applicationApprovals.approvalType, "follow_up_send"),
          inArray(applicationApprovals.status, ["pending", "approved"]),
          eq(followUps.applicationId, input.applicationId),
          isNull(followUps.sentDate)
        ));
      if (staleApprovals.length > 0) {
        const cancellationNote = staleFollowUpCancellationNote(response.responseType, responseId);
        await tx
          .update(applicationApprovals)
          .set({
            status: "cancelled",
            decidedBy: "user",
            decisionNote: cancellationNote,
            decidedAt: response.receivedAt,
          })
          .where(and(
            eq(applicationApprovals.userId, userId),
            eq(applicationApprovals.applicationId, input.applicationId),
            eq(applicationApprovals.entityType, "follow_up"),
            eq(applicationApprovals.approvalType, "follow_up_send"),
            inArray(applicationApprovals.id, staleApprovals.map((approval) => approval.id)),
            inArray(applicationApprovals.status, ["pending", "approved"])
          ));
        cancelledFollowUpApprovalIds.push(...staleApprovals.map((approval) => approval.id));
        await tx.insert(auditEvents).values({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "stale_follow_up_approvals_cancelled",
          actor: "system",
          source: "applications.recordResponse",
          afterState: JSON.stringify({
            responseId,
            responseType: response.responseType,
            cancelledApprovalIds: cancelledFollowUpApprovalIds,
            cancelledStatuses: staleApprovals.map((approval) => approval.status),
          }),
          riskLevel: "medium",
        });
      }
    }

    if (shouldCancelOutstandingInterviews(application[0].status, response.responseType)) {
      const scheduledInterviews = await tx
        .select({ id: interviewSchedules.id })
        .from(interviewSchedules)
        .where(and(
          eq(interviewSchedules.applicationId, input.applicationId),
          inArray(interviewSchedules.status, ["scheduled", "rescheduled"])
        ));
      if (scheduledInterviews.length > 0) {
        await tx
          .update(interviewSchedules)
          .set({ status: "cancelled" })
          .where(and(
            inArray(interviewSchedules.id, scheduledInterviews.map((interview) => interview.id)),
            inArray(interviewSchedules.status, ["scheduled", "rescheduled"])
          ));
        cancelledInterviewIds.push(...scheduledInterviews.map((interview) => interview.id));
        await tx.insert(auditEvents).values({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "interviews_cancelled_after_employer_rejection",
          actor: "system",
          source: "applications.recordResponse",
          afterState: JSON.stringify({
            responseId,
            responseType: response.responseType,
            cancelledInterviewIds,
            externalCancellationSent: false,
          }),
          riskLevel: "medium",
        });
      }
    }

    if (shouldRetireOfferAttribution(application[0].status, response.responseType)) {
      const staleApprovals = await tx
        .select({ id: applicationApprovals.id, status: applicationApprovals.status })
        .from(applicationApprovals)
        .where(and(
          eq(applicationApprovals.userId, userId),
          eq(applicationApprovals.applicationId, input.applicationId),
          eq(applicationApprovals.entityType, "application"),
          eq(applicationApprovals.entityId, input.applicationId),
          eq(applicationApprovals.approvalType, "offer_attribution"),
          inArray(applicationApprovals.status, ["pending", "approved"])
        ));
      if (staleApprovals.length > 0) {
        await tx
          .update(applicationApprovals)
          .set({
            status: "cancelled",
            decidedBy: "user",
            decisionNote: staleOfferAttributionCancellationNote(responseId),
            decidedAt: response.receivedAt,
          })
          .where(inArray(applicationApprovals.id, staleApprovals.map((approval) => approval.id)));
        cancelledOfferAttributionApprovalIds.push(...staleApprovals.map((approval) => approval.id));
      }
      const staleReviews = await tx
        .select({ id: adminReviewItems.id })
        .from(adminReviewItems)
        .where(and(
          eq(adminReviewItems.userId, userId),
          eq(adminReviewItems.entityType, "application"),
          eq(adminReviewItems.entityId, input.applicationId),
          eq(adminReviewItems.category, "offer_attribution"),
          inArray(adminReviewItems.status, ["open", "in_progress"])
        ));
      if (staleReviews.length > 0) {
        await tx
          .update(adminReviewItems)
          .set({
            status: "dismissed",
            resolution: "Dismissed because an employer response withdrew or rejected the offer.",
            resolvedAt: response.receivedAt,
          })
          .where(inArray(adminReviewItems.id, staleReviews.map((review) => review.id)));
        dismissedOfferAttributionReviewIds.push(...staleReviews.map((review) => review.id));
      }
      if (cancelledOfferAttributionApprovalIds.length > 0 || dismissedOfferAttributionReviewIds.length > 0) {
        await tx.insert(auditEvents).values({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "stale_offer_attribution_retired",
          actor: "system",
          source: "applications.recordResponse",
          afterState: JSON.stringify({
            responseId,
            responseType: response.responseType,
            cancelledApprovalIds: cancelledOfferAttributionApprovalIds,
            dismissedReviewIds: dismissedOfferAttributionReviewIds,
          }),
          riskLevel: "high",
        });
      }
    }

    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: input.applicationId,
      action: "employer_response_recorded",
      actor: "user",
      source: "applications.recordResponse",
      beforeState: JSON.stringify({ status: application[0].status }),
      afterState: JSON.stringify({
        status: statusAfter,
        responseId,
        responseType: response.responseType,
        receivedAt: response.receivedAt.toISOString(),
        sourceReferencePresent: Boolean(response.sourceReference),
      }),
      riskLevel: response.responseType === "offer" ? "high" : response.responseType === "interview_invite" ? "medium" : "low",
    });

    if (response.responseType === "offer") {
      const existingApproval = await tx
        .select({ id: applicationApprovals.id })
        .from(applicationApprovals)
        .where(and(
          eq(applicationApprovals.userId, application[0].userId),
          eq(applicationApprovals.entityType, "application"),
          eq(applicationApprovals.entityId, input.applicationId),
          eq(applicationApprovals.approvalType, "offer_attribution"),
          eq(applicationApprovals.status, "pending")
        ))
        .limit(1);
      const approvalPayload = JSON.stringify({
        applicationId: input.applicationId,
        responseId,
        responseType: response.responseType,
        receivedAt: response.receivedAt.toISOString(),
        source: response.source,
        sourceReference: response.sourceReference,
      });
      if (existingApproval[0]) {
        await tx
          .update(applicationApprovals)
          .set({
            title: "Confirm offer attribution",
            description: response.noteContent,
            payload: approvalPayload,
          })
          .where(eq(applicationApprovals.id, existingApproval[0].id));
      } else {
        await tx.insert(applicationApprovals).values({
          userId: application[0].userId,
          applicationId: input.applicationId,
          entityType: "application",
          entityId: input.applicationId,
          approvalType: "offer_attribution",
          status: "pending",
          riskLevel: "high",
          requestedBy: "system",
          title: "Confirm offer attribution",
          description: response.noteContent,
          payload: approvalPayload,
        });
      }
      await tx.insert(adminReviewItems).values({
        userId: application[0].userId,
        entityType: "application",
        entityId: input.applicationId,
        category: "offer_attribution",
        priority: "high",
        title: "Offer response needs success-fee attribution review",
        description: response.noteContent,
      });
    }

    return {
      success: true,
      existing: false,
      status: statusAfter,
      responseType: response.responseType,
      responseId,
      cancelledFollowUpApprovalIds,
      cancelledOfferAttributionApprovalIds,
      dismissedOfferAttributionReviewIds,
      cancelledInterviewIds,
      retiredInterviewNotificationIds,
    };
  });
}

// ==================== INTERVIEW SCHEDULING ====================

export interface ScheduleInterviewInput {
  applicationId: number;
  interviewType: "phone" | "video" | "onsite" | "technical" | "behavioral" | "panel";
  scheduledAt: Date;
  duration?: number;
  location?: string;
  meetingLink?: string;
  interviewerName?: string;
  interviewerTitle?: string;
  notes?: string;
}

const memoryInterviewSchedules: (InterviewSchedule & { id: number; createdAt: Date; updatedAt: Date })[] = [];

function nextMemoryInterviewId() {
  return (memoryInterviewSchedules.reduce((max, item) => Math.max(max, item.id), 0) || 0) + 1;
}

async function getInterviewApplication(applicationId: number, userId: number) {
  const application = await getUserApplicationById(userId, applicationId);
  if (!application) {
    throw new Error("Application not found.");
  }
  return application;
}

async function findOwnedMemoryInterview(interviewId: number, userId: number) {
  const interview = memoryInterviewSchedules.find((item) => item.id === interviewId);
  if (!interview || !await getUserApplicationById(userId, interview.applicationId)) {
    throw new Error("Interview not found.");
  }
  return interview;
}

async function acknowledgeInterviewNotificationsAfterScheduling(applicationId: number, userId: number) {
  const { notificationIds } = await markUnreadInterviewNotificationsReadForApplication(applicationId, userId);
  if (notificationIds.length > 0) {
    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: applicationId,
      action: "interview_notifications_acknowledged_by_scheduling",
      actor: "user",
      source: "applications.scheduleInterview",
      afterState: JSON.stringify({ notificationIds }),
      riskLevel: "low",
    });
  }
  return notificationIds;
}

export async function scheduleInterview(input: ScheduleInterviewInput, userId: number) {
  const db = await getDb();
  if (input.scheduledAt.getTime() <= Date.now()) {
    throw new Error("Interview must be scheduled in the future.");
  }

  if (!db) {
    const application = await getInterviewApplication(input.applicationId, userId);
    const currentStatus = application.status || "pending";
    if (currentStatus !== "interview") {
      throw new Error("Record an interview invitation before scheduling an interview.");
    }
    const invitation = getLatestSchedulableInterviewInvite(
      memoryInterviewSchedules.filter((schedule) => schedule.applicationId === input.applicationId),
      await getEmployerResponses(input.applicationId, userId)
    );
    if (!invitation) {
      throw new Error("Record a new interview invitation before scheduling another interview.");
    }

    const now = new Date(Math.max(Date.now(), invitation.receivedAt.getTime() + 1));
    const record = {
      id: nextMemoryInterviewId(),
      applicationId: input.applicationId,
      interviewType: input.interviewType,
      scheduledAt: input.scheduledAt,
      duration: input.duration || 60,
      location: input.location || null,
      meetingLink: input.meetingLink || null,
      interviewerName: input.interviewerName || null,
      interviewerTitle: input.interviewerTitle || null,
      notes: input.notes || null,
      status: "scheduled" as const,
      employerResponseId: invitation.id ?? null,
      createdAt: now,
      updatedAt: now,
    };
    memoryInterviewSchedules.push(record);

    const approval = await createApplicationApproval({
      userId,
      applicationId: input.applicationId,
      entityType: "application",
      entityId: input.applicationId,
      approvalType: "interview_schedule",
      status: "approved",
      riskLevel: "high",
      requestedBy: "user",
      decidedBy: "user",
      title: "Interview time accepted",
      description: `User scheduled a ${input.interviewType} interview for ${input.scheduledAt.toISOString()}.`,
      payload: JSON.stringify({
        interviewId: record.id,
        interviewType: input.interviewType,
        scheduledAt: input.scheduledAt.toISOString(),
        duration: input.duration || 60,
        location: input.location || null,
        meetingLink: input.meetingLink || null,
        sourceResponseId: invitation.id ?? null,
      }),
      decisionNote: "User accepted this interview time.",
      requestedAt: now,
      decidedAt: now,
    });
    const approvalId = Number(approval.insertId);

    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: input.applicationId,
      action: "interview_scheduled",
      actor: "user",
      source: "applications.scheduleInterview",
      beforeState: JSON.stringify({ status: currentStatus }),
      afterState: JSON.stringify({
        status: "interview",
        interviewId: record.id,
        interviewType: input.interviewType,
        scheduledAt: input.scheduledAt.toISOString(),
        sourceResponseId: invitation.id ?? null,
      }),
      riskLevel: "high",
      approvalId,
    });

    await acknowledgeInterviewNotificationsAfterScheduling(input.applicationId, userId);
    return { id: record.id, approvalId };
  }

  const scheduledInterview = await db.transaction(async (tx) => {
    const application = await tx
      .select({ status: applications.status })
      .from(applications)
      .where(and(eq(applications.id, input.applicationId), eq(applications.userId, userId)))
      .limit(1);
    if (!application[0]) throw new Error("Application not found.");
    if (application[0].status !== "interview") {
      throw new Error("Record an interview invitation before scheduling an interview.");
    }
    const [schedules, responses] = await Promise.all([
      tx
        .select({
          status: interviewSchedules.status,
          createdAt: interviewSchedules.createdAt,
          employerResponseId: interviewSchedules.employerResponseId,
        })
        .from(interviewSchedules)
        .where(eq(interviewSchedules.applicationId, input.applicationId)),
      tx
        .select({ id: employerResponses.id, responseType: employerResponses.responseType, receivedAt: employerResponses.receivedAt })
        .from(employerResponses)
        .where(and(
          eq(employerResponses.applicationId, input.applicationId),
          eq(employerResponses.userId, userId)
        )),
    ]);
    const invitation = getLatestSchedulableInterviewInvite(schedules, responses);
    if (!invitation) {
      throw new Error("Record a new interview invitation before scheduling another interview.");
    }

    const createdAt = new Date(Math.max(Date.now(), invitation.receivedAt.getTime() + 1));
    const result = await tx.insert(interviewSchedules).values({
      applicationId: input.applicationId,
      interviewType: input.interviewType,
      scheduledAt: input.scheduledAt,
      duration: input.duration || 60,
      location: input.location || null,
      meetingLink: input.meetingLink || null,
      interviewerName: input.interviewerName || null,
      interviewerTitle: input.interviewerTitle || null,
      notes: input.notes || null,
      status: "scheduled",
      employerResponseId: invitation.id ?? null,
      createdAt,
    });
    const interviewId = Number(result[0].insertId);
    const approval = await tx.insert(applicationApprovals).values({
      userId,
      applicationId: input.applicationId,
      entityType: "application",
      entityId: input.applicationId,
      approvalType: "interview_schedule",
      status: "approved",
      riskLevel: "high",
      requestedBy: "user",
      decidedBy: "user",
      title: "Interview time accepted",
      description: `User scheduled a ${input.interviewType} interview for ${input.scheduledAt.toISOString()}.`,
      payload: JSON.stringify({
        interviewId,
        interviewType: input.interviewType,
        scheduledAt: input.scheduledAt.toISOString(),
        duration: input.duration || 60,
        location: input.location || null,
        meetingLink: input.meetingLink || null,
        sourceResponseId: invitation.id ?? null,
      }),
      decisionNote: "User accepted this interview time.",
      requestedAt: createdAt,
      decidedAt: createdAt,
    });
    const approvalId = Number(approval[0].insertId);

    const updateResult = await tx
      .update(applications)
      .set({ lastActivity: input.scheduledAt })
      .where(and(
        eq(applications.id, input.applicationId),
        eq(applications.userId, userId),
        eq(applications.status, "interview")
      ));
    if (Number(updateResult[0].affectedRows) === 0) {
      throw new Error("Application status changed concurrently. Refresh and try again.");
    }

    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: input.applicationId,
      action: "interview_scheduled",
      actor: "user",
      source: "applications.scheduleInterview",
      beforeState: JSON.stringify({ status: application[0].status }),
      afterState: JSON.stringify({
        status: "interview",
        interviewId,
        interviewType: input.interviewType,
        scheduledAt: input.scheduledAt.toISOString(),
        sourceResponseId: invitation.id ?? null,
      }),
      riskLevel: "high",
      approvalId,
    });

    return { id: interviewId, approvalId };
  });
  await acknowledgeInterviewNotificationsAfterScheduling(input.applicationId, userId);
  return scheduledInterview;
}

export async function getInterviewSchedules(applicationId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    await getInterviewApplication(applicationId, userId);
    return memoryInterviewSchedules
      .filter((interview) => interview.applicationId === applicationId)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }
  await assertUserOwnsApplication(applicationId, userId);

  return await db
    .select()
    .from(interviewSchedules)
    .where(eq(interviewSchedules.applicationId, applicationId))
    .orderBy(asc(interviewSchedules.scheduledAt));
}

export async function getInterviewSchedulePage(
  applicationId: number,
  userId: number,
  options: {
    historyLimit?: number;
    cursor?: { scheduledAt: Date; id: number };
  } = {}
) {
  const historyLimit = Math.min(50, Math.max(1, Math.trunc(options.historyLimit ?? 10)));
  const activeLimit = 25;
  const activeStatuses = ["scheduled", "rescheduled"] as const;
  const historyStatuses = ["completed", "cancelled"] as const;
  const db = await getDb();

  if (!db) {
    await getInterviewApplication(applicationId, userId);
    const applicationInterviews = memoryInterviewSchedules.filter(
      (interview) => interview.applicationId === applicationId
    );
    const activeRows = options.cursor
      ? []
      : applicationInterviews
          .filter((interview) => activeStatuses.includes(interview.status as typeof activeStatuses[number]))
          .sort((left, right) =>
            left.scheduledAt.getTime() - right.scheduledAt.getTime() || left.id - right.id
          )
          .slice(0, activeLimit + 1);
    const historyRows = applicationInterviews
      .filter((interview) => historyStatuses.includes(interview.status as typeof historyStatuses[number]))
      .filter((interview) => !options.cursor ||
        interview.scheduledAt < options.cursor.scheduledAt ||
        (interview.scheduledAt.getTime() === options.cursor.scheduledAt.getTime() &&
          interview.id < options.cursor.id)
      )
      .sort((left, right) =>
        right.scheduledAt.getTime() - left.scheduledAt.getTime() || right.id - left.id
      )
      .slice(0, historyLimit + 1);
    const historyItems = historyRows.slice(0, historyLimit);
    const lastHistoryItem = historyItems.at(-1);
    return {
      activeItems: activeRows.slice(0, activeLimit),
      activeHasMore: activeRows.length > activeLimit,
      historyItems,
      nextCursor: historyRows.length > historyLimit && lastHistoryItem
        ? { scheduledAt: lastHistoryItem.scheduledAt, id: lastHistoryItem.id }
        : null,
    };
  }

  await assertUserOwnsApplication(applicationId, userId);
  const historyCursorCondition = options.cursor
    ? or(
        lt(interviewSchedules.scheduledAt, options.cursor.scheduledAt),
        and(
          eq(interviewSchedules.scheduledAt, options.cursor.scheduledAt),
          lt(interviewSchedules.id, options.cursor.id)
        )
      )
    : undefined;
  const [activeRows, historyRows] = await Promise.all([
    options.cursor
      ? Promise.resolve([] as Array<typeof interviewSchedules.$inferSelect>)
      : db
          .select()
          .from(interviewSchedules)
          .where(and(
            eq(interviewSchedules.applicationId, applicationId),
            inArray(interviewSchedules.status, [...activeStatuses])
          ))
          .orderBy(asc(interviewSchedules.scheduledAt), asc(interviewSchedules.id))
          .limit(activeLimit + 1),
    db
      .select()
      .from(interviewSchedules)
      .where(and(
        eq(interviewSchedules.applicationId, applicationId),
        inArray(interviewSchedules.status, [...historyStatuses]),
        historyCursorCondition
      ))
      .orderBy(desc(interviewSchedules.scheduledAt), desc(interviewSchedules.id))
      .limit(historyLimit + 1),
  ]);
  const historyItems = historyRows.slice(0, historyLimit);
  const lastHistoryItem = historyItems.at(-1);
  return {
    activeItems: activeRows.slice(0, activeLimit),
    activeHasMore: activeRows.length > activeLimit,
    historyItems,
    nextCursor: historyRows.length > historyLimit && lastHistoryItem
      ? { scheduledAt: lastHistoryItem.scheduledAt, id: lastHistoryItem.id }
      : null,
  };
}

export async function getUserInterviewSchedulesForApplications(
  userId: number,
  applicationIds: number[]
) {
  const boundedApplicationIds = Array.from(new Set(
    applicationIds.filter((applicationId) => Number.isInteger(applicationId) && applicationId > 0)
  )).slice(0, 500);
  if (boundedApplicationIds.length === 0) return [] as InterviewSchedule[];
  const requestedApplicationIds = new Set(boundedApplicationIds);

  const db = await getDb();
  if (!db) {
    const applicationsForUser = await getUserApplicationsByIds(userId, boundedApplicationIds);
    const ownedApplicationIds = new Set(
      applicationsForUser
        .filter((application) => requestedApplicationIds.has(application.id))
        .map((application) => application.id)
    );
    return memoryInterviewSchedules
      .filter((interview) => ownedApplicationIds.has(interview.applicationId))
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
  }

  const rows = await db
    .select({ interview: interviewSchedules })
    .from(interviewSchedules)
    .innerJoin(applications, eq(interviewSchedules.applicationId, applications.id))
    .where(and(
      eq(applications.userId, userId),
      inArray(applications.id, boundedApplicationIds)
    ))
    .orderBy(asc(interviewSchedules.scheduledAt));
  return rows.map((row) => row.interview);
}

export async function getInterviewOutcomePage(userId: number, requestedLimit = 10) {
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    const completed = memoryInterviewSchedules
      .filter((schedule) => schedule.status === "completed")
      .sort((left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() || right.id - left.id
      );
    const applicationIds = Array.from(new Set(completed.map((schedule) => schedule.applicationId)));
    const ownedApplications: Awaited<ReturnType<typeof getUserApplicationsByIds>>[number][] = [];
    for (let offset = 0; offset < applicationIds.length; offset += 500) {
      ownedApplications.push(...await getUserApplicationsByIds(userId, applicationIds.slice(offset, offset + 500)));
    }
    const applicationsById = new Map(
      ownedApplications
        .filter((application) => application.status === "interview")
        .map((application) => [application.id, application] as const)
    );
    const responses = await getUserEmployerResponsesForApplications(userId, Array.from(applicationsById.keys()));
    const recordedInterviewIds = new Set(
      responses
        .map((response) => response.interviewId)
        .filter((interviewId): interviewId is number => typeof interviewId === "number")
    );
    const candidates = completed.filter((schedule) =>
      applicationsById.has(schedule.applicationId) && !recordedInterviewIds.has(schedule.id)
    );
    return {
      items: candidates.slice(0, limit).map((schedule) => {
        const application = applicationsById.get(schedule.applicationId)!;
        return {
          interviewId: schedule.id,
          applicationId: application.id,
          jobId: application.jobId,
          completedAt: schedule.updatedAt,
          interviewType: schedule.interviewType,
          status: application.status,
          job: application.job ? {
            id: application.job.id,
            title: application.job.title,
            company: application.job.company,
            location: application.job.location,
          } : null,
        };
      }),
      total: candidates.length,
      limit,
      hasMore: candidates.length > limit,
    };
  }

  const condition = and(
    eq(applications.userId, userId),
    eq(applications.status, "interview"),
    eq(interviewSchedules.status, "completed"),
    sql`NOT EXISTS (
      SELECT 1 FROM employer_responses
      WHERE employer_responses.interview_id = ${interviewSchedules.id}
      AND employer_responses.user_id = ${userId}
    )`
  );
  const [rows, countRows] = await Promise.all([
    db
      .select({
        interviewId: interviewSchedules.id,
        applicationId: applications.id,
        jobId: applications.jobId,
        completedAt: interviewSchedules.updatedAt,
        interviewType: interviewSchedules.interviewType,
        status: applications.status,
        job: {
          id: jobs.id,
          title: jobs.title,
          company: jobs.company,
          location: jobs.location,
        },
      })
      .from(interviewSchedules)
      .innerJoin(applications, eq(interviewSchedules.applicationId, applications.id))
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .where(condition)
      .orderBy(desc(interviewSchedules.updatedAt), desc(interviewSchedules.id))
      .limit(limit),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(interviewSchedules)
      .innerJoin(applications, eq(interviewSchedules.applicationId, applications.id))
      .where(condition),
  ]);
  const total = Number(countRows[0]?.count ?? 0);
  return { items: rows, total, limit, hasMore: total > rows.length };
}

export async function getInterviewSchedulingPage(userId: number, requestedLimit = 5) {
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    type StatusApplication = Awaited<ReturnType<typeof getUserApplicationStatusPage>>["items"][number];
    const interviewApplications: StatusApplication[] = [];
    let afterId = 0;
    while (true) {
      const page = await getUserApplicationStatusPage(userId, "interview", afterId, 500);
      interviewApplications.push(...page.items);
      if (!page.hasMore || page.nextAfterId === null) break;
      afterId = page.nextAfterId;
    }
    const applicationIds = interviewApplications.map((application) => application.id);
    const responses = await getUserEmployerResponsesForApplications(userId, applicationIds);
    const responsesByApplication = new Map<number, typeof responses>();
    for (const response of responses) {
      const existing = responsesByApplication.get(response.applicationId) ?? [];
      existing.push(response);
      responsesByApplication.set(response.applicationId, existing);
    }
    const schedulesByApplication = new Map<number, InterviewSchedule[]>();
    for (const schedule of memoryInterviewSchedules) {
      const existing = schedulesByApplication.get(schedule.applicationId) ?? [];
      existing.push(schedule);
      schedulesByApplication.set(schedule.applicationId, existing);
    }
    const candidates = interviewApplications
      .map((application) => ({
        application,
        schedulingRequirement: getInterviewSchedulingRequirement(
          schedulesByApplication.get(application.id) ?? [],
          responsesByApplication.get(application.id) ?? []
        ),
      }))
      .filter((candidate) => candidate.schedulingRequirement !== null)
      .sort((left, right) =>
        (right.application.lastActivity?.getTime() ?? 0) -
          (left.application.lastActivity?.getTime() ?? 0) ||
        right.application.id - left.application.id
      );
    return {
      items: candidates.slice(0, limit).map(({ application, schedulingRequirement }) => ({
        applicationId: application.id,
        jobId: application.jobId,
        status: application.status,
        lastActivity: application.lastActivity,
        schedulingRequirement: schedulingRequirement!,
        job: application.job ? {
          id: application.job.id,
          title: application.job.title,
          company: application.job.company,
          location: application.job.location,
        } : null,
      })),
      total: candidates.length,
      limit,
      hasMore: candidates.length > limit,
    };
  }

  const unconsumedLatestInvite = sql`EXISTS (
    SELECT 1 FROM employer_responses invite
    WHERE invite.application_id = ${applications.id}
      AND invite.user_id = ${userId}
      AND invite.response_type = 'interview_invite'
      AND NOT EXISTS (
        SELECT 1 FROM employer_responses later_invite
        WHERE later_invite.application_id = invite.application_id
          AND later_invite.user_id = invite.user_id
          AND later_invite.response_type = 'interview_invite'
          AND (
            later_invite.received_at > invite.received_at OR
            (later_invite.received_at = invite.received_at AND later_invite.id > invite.id)
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM interview_schedules consumed_schedule
        WHERE consumed_schedule.application_id = invite.application_id
          AND (
            consumed_schedule.employer_response_id = invite.id OR
            (consumed_schedule.employer_response_id IS NULL AND consumed_schedule.created_at > invite.received_at)
          )
      )
  )`;
  const activeSchedule = sql`EXISTS (
    SELECT 1 FROM interview_schedules active_schedule
    WHERE active_schedule.application_id = ${applications.id}
      AND active_schedule.status IN ('scheduled', 'rescheduled')
  )`;
  const cancelledSchedule = sql`EXISTS (
    SELECT 1 FROM interview_schedules cancelled_schedule
    WHERE cancelled_schedule.application_id = ${applications.id}
      AND cancelled_schedule.status = 'cancelled'
  )`;
  const completedSchedule = sql`EXISTS (
    SELECT 1 FROM interview_schedules completed_schedule
    WHERE completed_schedule.application_id = ${applications.id}
      AND completed_schedule.status = 'completed'
  )`;
  const schedulingRequirement = sql<Exclude<InterviewSchedulingRequirement, null>>`CASE
    WHEN ${unconsumedLatestInvite} THEN 'new_invite'
    WHEN ${activeSchedule} THEN NULL
    WHEN ${cancelledSchedule} THEN 'cancelled_schedule'
    WHEN ${completedSchedule} THEN NULL
    ELSE 'missing_schedule'
  END`;
  const condition = and(
    eq(applications.userId, userId),
    eq(applications.status, "interview"),
    sql`${schedulingRequirement} IS NOT NULL`
  );
  const [rows, countRows] = await Promise.all([
    db
      .select({
        applicationId: applications.id,
        jobId: applications.jobId,
        status: applications.status,
        lastActivity: applications.lastActivity,
        schedulingRequirement,
        job: {
          id: jobs.id,
          title: jobs.title,
          company: jobs.company,
          location: jobs.location,
        },
      })
      .from(applications)
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .where(condition)
      .orderBy(desc(applications.lastActivity), desc(applications.id))
      .limit(limit),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(applications)
      .where(condition),
  ]);
  const total = Number(countRows[0]?.count ?? 0);
  return { items: rows, total, limit, hasMore: total > rows.length };
}

export async function getEmployerResponseReplyPage(userId: number, requestedLimit = 5) {
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    type StatusApplication = Awaited<ReturnType<typeof getUserApplicationStatusPage>>["items"][number];
    const activeApplications: StatusApplication[] = [];
    for (const status of ["applied", "viewed", "interview"] as const) {
      let afterId = 0;
      while (true) {
        const page = await getUserApplicationStatusPage(userId, status, afterId, 500);
        activeApplications.push(...page.items);
        if (!page.hasMore || page.nextAfterId === null) break;
        afterId = page.nextAfterId;
      }
    }
    const responses = await getUserEmployerResponsesForApplications(
      userId,
      activeApplications.map((application) => application.id)
    );
    const latestResponseByApplication = new Map<number, EmployerResponse>();
    for (const response of responses) {
      const current = latestResponseByApplication.get(response.applicationId);
      if (!current || response.receivedAt > current.receivedAt ||
          (response.receivedAt.getTime() === current.receivedAt.getTime() && response.id > current.id)) {
        latestResponseByApplication.set(response.applicationId, response);
      }
    }
    const candidates = [] as Array<{
      application: StatusApplication;
      response: EmployerResponse;
    }>;
    for (const application of activeApplications) {
      const response = latestResponseByApplication.get(application.id);
      if (!response || !["employer_question", "other"].includes(response.responseType)) continue;
      const linkedDraftIds = new Set(memoryFollowUps.filter((followUp) =>
        followUp.applicationId === application.id &&
        followUp.sourceResponseId === response.id &&
        !followUp.sentDate
      ).map((followUp) => followUp.id));
      if (linkedDraftIds.size > 0) {
        const approvals = await listUserApplicationApprovalsForApplication(userId, application.id);
        if (approvals.some((approval) =>
          approval.entityType === "follow_up" &&
          linkedDraftIds.has(approval.entityId) &&
          approval.approvalType === "follow_up_send" &&
          ["pending", "approved"].includes(approval.status)
        )) continue;
      }
      candidates.push({ application, response });
    }
    candidates.sort((left, right) =>
      right.response.receivedAt.getTime() - left.response.receivedAt.getTime() ||
      right.response.id - left.response.id
    );
    return {
      items: candidates.slice(0, limit).map(({ application, response }) => ({
        applicationId: application.id,
        jobId: application.jobId,
        responseId: response.id,
        responseType: response.responseType,
        source: response.source,
        summary: response.summary,
        receivedAt: response.receivedAt,
        status: application.status,
        job: application.job ? {
          id: application.job.id,
          title: application.job.title,
          company: application.job.company,
          location: application.job.location,
        } : null,
      })),
      total: candidates.length,
      limit,
      hasMore: candidates.length > limit,
    };
  }

  const condition = and(
    eq(applications.userId, userId),
    inArray(applications.status, ["applied", "viewed", "interview"]),
    inArray(employerResponses.responseType, ["employer_question", "other"]),
    sql`NOT EXISTS (
      SELECT 1 FROM employer_responses later_response
      WHERE later_response.application_id = ${employerResponses.applicationId}
        AND later_response.user_id = ${employerResponses.userId}
        AND (
          later_response.received_at > ${employerResponses.receivedAt} OR
          (later_response.received_at = ${employerResponses.receivedAt} AND later_response.id > ${employerResponses.id})
        )
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM follow_ups active_draft
      INNER JOIN application_approvals active_approval
        ON active_approval.entity_type = 'follow_up'
        AND active_approval.entity_id = active_draft.id
        AND active_approval.user_id = ${userId}
        AND active_approval.approval_type = 'follow_up_send'
        AND active_approval.status IN ('pending', 'approved')
      WHERE active_draft.application_id = ${applications.id}
        AND active_draft.source_response_id = ${employerResponses.id}
        AND active_draft.sent_date IS NULL
    )`
  );
  const selection = {
    applicationId: applications.id,
    jobId: applications.jobId,
    responseId: employerResponses.id,
    responseType: employerResponses.responseType,
    source: employerResponses.source,
    summary: employerResponses.summary,
    receivedAt: employerResponses.receivedAt,
    status: applications.status,
    job: {
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
    },
  };
  const baseQuery = () => db
    .select(selection)
    .from(employerResponses)
    .innerJoin(applications, and(
      eq(employerResponses.applicationId, applications.id),
      eq(employerResponses.userId, applications.userId)
    ))
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .where(condition);
  const [items, countRows] = await Promise.all([
    baseQuery()
      .orderBy(desc(employerResponses.receivedAt), desc(employerResponses.id))
      .limit(limit),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(employerResponses)
      .innerJoin(applications, and(
        eq(employerResponses.applicationId, applications.id),
        eq(employerResponses.userId, applications.userId)
      ))
      .where(condition),
  ]);
  const total = Number(countRows[0]?.count ?? 0);
  return { items, total, limit, hasMore: total > items.length };
}

function parseFollowUpDeliveryPayload(payload: string | null) {
  if (!payload) return {} as {
    purpose?: string;
    sourceResponseId?: number | null;
    responseType?: string | null;
    message?: string | null;
  };
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      purpose: typeof parsed.purpose === "string" ? parsed.purpose : undefined,
      sourceResponseId: typeof parsed.sourceResponseId === "number" ? parsed.sourceResponseId : null,
      responseType: typeof parsed.responseType === "string" ? parsed.responseType : null,
      message: typeof parsed.message === "string" ? parsed.message : null,
    };
  } catch {
    return {};
  }
}

function toFollowUpDeliveryQueueItem(input: {
  followUp: FollowUp;
  approval: ApplicationApproval;
  application: Pick<Application, "id" | "jobId">;
  job: Pick<typeof jobs.$inferSelect, "id" | "title" | "company" | "location"> | null;
}) {
  const payload = parseFollowUpDeliveryPayload(input.approval.payload);
  const message = input.followUp.message || payload.message || "";
  return {
    followUpId: input.followUp.id,
    applicationId: input.application.id,
    jobId: input.application.jobId,
    approvalId: input.approval.id,
    approvalTitle: input.approval.title,
    riskLevel: input.approval.riskLevel,
    purpose: payload.purpose || "routine_follow_up",
    sourceResponseId: input.followUp.sourceResponseId ?? payload.sourceResponseId ?? null,
    responseType: payload.responseType ?? null,
    messagePreview: message.length > 180 ? `${message.slice(0, 177)}...` : message,
    approvedAt: input.approval.decidedAt ?? null,
    deliveryState: input.followUp.deliveryState || "draft",
    deliveryProvider: input.followUp.deliveryProvider || null,
    deliveryRecipient: input.followUp.deliveryRecipient || null,
    deliveryFailureMessage: input.followUp.deliveryFailureMessage || null,
    job: input.job,
  };
}

export async function getFollowUpDeliveryOperatingQueues(userId: number, requestedLimit = 5) {
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    const applicationIds = Array.from(new Set(memoryFollowUps
      .filter((followUp) => !followUp.sentDate)
      .map((followUp) => followUp.applicationId)));
    type OwnedApplication = Awaited<ReturnType<typeof getUserApplicationsByIds>>[number];
    const ownedApplications: OwnedApplication[] = [];
    for (let offset = 0; offset < applicationIds.length; offset += 500) {
      ownedApplications.push(...await getUserApplicationsByIds(userId, applicationIds.slice(offset, offset + 500)));
    }
    const applicationsById = new Map(ownedApplications
      .filter((application) => ["applied", "viewed", "interview"].includes(application.status || "pending"))
      .map((application) => [application.id, application] as const));
    const candidates = [] as ReturnType<typeof toFollowUpDeliveryQueueItem>[];
    for (const application of Array.from(applicationsById.values())) {
      const approvals = await listUserApplicationApprovalsForApplication(userId, application.id);
      const latestApprovalByFollowUp = new Map<number, ApplicationApproval>();
      for (const approval of approvals) {
        if (approval.entityType !== "follow_up" || approval.approvalType !== "follow_up_send" || approval.status !== "approved") continue;
        const current = latestApprovalByFollowUp.get(approval.entityId);
        if (!current || approval.id > current.id) latestApprovalByFollowUp.set(approval.entityId, approval);
      }
      for (const followUp of memoryFollowUps) {
        if (followUp.applicationId !== application.id || followUp.sentDate) continue;
        const approval = latestApprovalByFollowUp.get(followUp.id);
        if (!approval) continue;
        candidates.push(toFollowUpDeliveryQueueItem({
          followUp,
          approval,
          application,
          job: application.job?.id != null && application.job.title != null && application.job.company != null ? {
            id: application.job.id,
            title: application.job.title,
            company: application.job.company,
            location: application.job.location,
          } : null,
        }));
      }
    }
    candidates.sort((left, right) =>
      (right.approvedAt?.getTime() ?? 0) - (left.approvedAt?.getTime() ?? 0) ||
      right.approvalId - left.approvalId
    );
    const reconciliation = candidates.filter((item) => ["sending", "unknown"].includes(item.deliveryState));
    const ready = candidates.filter((item) => !["sending", "unknown"].includes(item.deliveryState));
    return {
      ready: { items: ready.slice(0, limit), total: ready.length, limit, hasMore: ready.length > limit },
      reconciliation: {
        items: reconciliation.slice(0, limit),
        total: reconciliation.length,
        limit,
        hasMore: reconciliation.length > limit,
      },
    };
  }

  const latestApproved = sql`NOT EXISTS (
    SELECT 1 FROM application_approvals later_approval
    WHERE later_approval.user_id = ${userId}
      AND later_approval.entity_type = 'follow_up'
      AND later_approval.entity_id = ${followUps.id}
      AND later_approval.approval_type = 'follow_up_send'
      AND later_approval.status = 'approved'
      AND later_approval.id > ${applicationApprovals.id}
  )`;
  const baseCondition = and(
    eq(applications.userId, userId),
    inArray(applications.status, ["applied", "viewed", "interview"]),
    eq(applicationApprovals.userId, userId),
    eq(applicationApprovals.entityType, "follow_up"),
    eq(applicationApprovals.approvalType, "follow_up_send"),
    eq(applicationApprovals.status, "approved"),
    isNull(followUps.sentDate),
    latestApproved
  );
  const selection = {
    followUp: followUps,
    approval: applicationApprovals,
    application: { id: applications.id, jobId: applications.jobId },
    job: { id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location },
  };
  const itemQuery = (reconciliation: boolean) => db
    .select(selection)
    .from(applicationApprovals)
    .innerJoin(followUps, eq(applicationApprovals.entityId, followUps.id))
    .innerJoin(applications, eq(followUps.applicationId, applications.id))
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(
      baseCondition,
      reconciliation
        ? inArray(followUps.deliveryState, ["sending", "unknown"])
        : sql`${followUps.deliveryState} NOT IN ('sending', 'unknown')`
    ))
    .orderBy(desc(applicationApprovals.decidedAt), desc(applicationApprovals.id))
    .limit(limit);
  const [readyRows, reconciliationRows, countRows] = await Promise.all([
    itemQuery(false),
    itemQuery(true),
    db
      .select({
        ready: sql<number>`SUM(CASE WHEN ${followUps.deliveryState} NOT IN ('sending', 'unknown') THEN 1 ELSE 0 END)`,
        reconciliation: sql<number>`SUM(CASE WHEN ${followUps.deliveryState} IN ('sending', 'unknown') THEN 1 ELSE 0 END)`,
      })
      .from(applicationApprovals)
      .innerJoin(followUps, eq(applicationApprovals.entityId, followUps.id))
      .innerJoin(applications, eq(followUps.applicationId, applications.id))
      .where(baseCondition),
  ]);
  const readyItems = readyRows.map(toFollowUpDeliveryQueueItem);
  const reconciliationItems = reconciliationRows.map(toFollowUpDeliveryQueueItem);
  const readyTotal = Number(countRows[0]?.ready ?? 0);
  const reconciliationTotal = Number(countRows[0]?.reconciliation ?? 0);
  return {
    ready: { items: readyItems, total: readyTotal, limit, hasMore: readyTotal > readyItems.length },
    reconciliation: {
      items: reconciliationItems,
      total: reconciliationTotal,
      limit,
      hasMore: reconciliationTotal > reconciliationItems.length,
    },
  };
}

function followUpDraftingCopy(status: string, daysSinceActivity: number) {
  if (status === "interview") {
    return {
      messageType: daysSinceActivity >= 5 ? "status_check" as const : "thank_you" as const,
      reason: daysSinceActivity >= 5
        ? "Interview-stage application has no recent activity and should receive a status check."
        : "Interview-stage application should receive a thank-you note.",
    };
  }
  return {
    messageType: daysSinceActivity >= 10 ? "status_check" as const : "reminder" as const,
    reason: "No recent activity after application submission.",
  };
}

export async function getFollowUpDraftingPage(
  userId: number,
  requestedLimit = 5,
  now = new Date()
) {
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const db = await getDb();
  if (!db) {
    type StatusApplication = Awaited<ReturnType<typeof getUserApplicationStatusPage>>["items"][number];
    const dueApplications: StatusApplication[] = [];
    for (const status of ["applied", "viewed", "interview"] as const) {
      let afterId = 0;
      while (true) {
        const page = await getUserApplicationStatusPage(userId, status, afterId, 500);
        for (const application of page.items) {
          const activity = application.lastActivity || application.appliedDate || application.createdAt;
          const daysSinceActivity = Math.max(0, Math.floor((now.getTime() - activity.getTime()) / 86400000));
          if (daysSinceActivity >= (status === "interview" ? 1 : 5)) dueApplications.push(application);
        }
        if (!page.hasMore || page.nextAfterId === null) break;
        afterId = page.nextAfterId;
      }
    }
    const responses = await getUserEmployerResponsesForApplications(
      userId,
      dueApplications.map((application) => application.id)
    );
    const responsesByApplication = new Map<number, EmployerResponse[]>();
    for (const response of responses) {
      const existing = responsesByApplication.get(response.applicationId) ?? [];
      existing.push(response);
      responsesByApplication.set(response.applicationId, existing);
    }
    const candidates = [] as Array<{
      application: StatusApplication;
      daysSinceActivity: number;
      messageType: "status_check" | "thank_you" | "reminder";
      reason: string;
    }>;
    for (const application of dueApplications) {
      const applicationResponses = (responsesByApplication.get(application.id) ?? [])
        .sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime() || right.id - left.id);
      const latestResponse = applicationResponses[0];
      if (latestResponse && ["employer_question", "other"].includes(latestResponse.responseType)) continue;
      const applicationSchedules = memoryInterviewSchedules.filter((schedule) => schedule.applicationId === application.id);
      if (application.status === "interview") {
        if (getInterviewSchedulingRequirement(applicationSchedules, applicationResponses) !== null) continue;
        if (applicationSchedules.some((schedule) =>
          schedule.status === "completed" &&
          !applicationResponses.some((response) => response.interviewId === schedule.id)
        )) continue;
      }
      const unsentFollowUpIds = new Set(memoryFollowUps
        .filter((followUp) => followUp.applicationId === application.id && !followUp.sentDate)
        .map((followUp) => followUp.id));
      if (unsentFollowUpIds.size > 0) {
        const approvals = await listUserApplicationApprovalsForApplication(userId, application.id);
        if (approvals.some((approval) =>
          approval.entityType === "follow_up" &&
          unsentFollowUpIds.has(approval.entityId) &&
          approval.approvalType === "follow_up_send" &&
          ["pending", "approved"].includes(approval.status)
        )) continue;
      }
      const activity = application.lastActivity || application.appliedDate || application.createdAt;
      const daysSinceActivity = Math.max(0, Math.floor((now.getTime() - activity.getTime()) / 86400000));
      candidates.push({ application, daysSinceActivity, ...followUpDraftingCopy(application.status || "pending", daysSinceActivity) });
    }
    candidates.sort((left, right) =>
      right.daysSinceActivity - left.daysSinceActivity || left.application.id - right.application.id
    );
    return {
      items: candidates.slice(0, limit).map(({ application, daysSinceActivity, messageType, reason }) => ({
        applicationId: application.id,
        jobId: application.jobId,
        status: application.status,
        daysSinceActivity,
        messageType,
        reason,
        job: application.job?.id != null && application.job.title != null && application.job.company != null ? {
          id: application.job.id,
          title: application.job.title,
          company: application.job.company,
          location: application.job.location,
        } : null,
      })),
      total: candidates.length,
      candidateTotal: dueApplications.length,
      blockedTotal: Math.max(0, dueApplications.length - candidates.length),
      limit,
      hasMore: candidates.length > limit,
    };
  }

  const activityAt = sql`COALESCE(${applications.lastActivity}, ${applications.appliedDate}, ${applications.createdAt})`;
  const daysSinceActivity = sql<number>`TIMESTAMPDIFF(DAY, ${activityAt}, ${now})`;
  const dueTiming = sql`(
    (${applications.status} = 'interview' AND ${activityAt} <= DATE_SUB(${now}, INTERVAL 1 DAY)) OR
    (${applications.status} IN ('applied', 'viewed') AND ${activityAt} <= DATE_SUB(${now}, INTERVAL 5 DAY))
  )`;
  const hasActiveDraft = sql`EXISTS (
    SELECT 1 FROM follow_ups active_follow_up
    INNER JOIN application_approvals active_approval
      ON active_approval.entity_type = 'follow_up'
      AND active_approval.entity_id = active_follow_up.id
      AND active_approval.user_id = ${userId}
      AND active_approval.approval_type = 'follow_up_send'
      AND active_approval.status IN ('pending', 'approved')
    WHERE active_follow_up.application_id = ${applications.id}
      AND active_follow_up.sent_date IS NULL
  )`;
  const hasLatestReplyableResponse = sql`EXISTS (
    SELECT 1 FROM employer_responses replyable_response
    WHERE replyable_response.application_id = ${applications.id}
      AND replyable_response.user_id = ${userId}
      AND replyable_response.response_type IN ('employer_question', 'other')
      AND NOT EXISTS (
        SELECT 1 FROM employer_responses later_response
        WHERE later_response.application_id = replyable_response.application_id
          AND later_response.user_id = replyable_response.user_id
          AND (
            later_response.received_at > replyable_response.received_at OR
            (later_response.received_at = replyable_response.received_at AND later_response.id > replyable_response.id)
          )
      )
  )`;
  const hasUnconsumedInvite = sql`EXISTS (
    SELECT 1 FROM employer_responses invite
    WHERE invite.application_id = ${applications.id}
      AND invite.user_id = ${userId}
      AND invite.response_type = 'interview_invite'
      AND NOT EXISTS (
        SELECT 1 FROM employer_responses later_invite
        WHERE later_invite.application_id = invite.application_id
          AND later_invite.user_id = invite.user_id
          AND later_invite.response_type = 'interview_invite'
          AND (later_invite.received_at > invite.received_at OR
            (later_invite.received_at = invite.received_at AND later_invite.id > invite.id))
      )
      AND NOT EXISTS (
        SELECT 1 FROM interview_schedules consumed_schedule
        WHERE consumed_schedule.application_id = invite.application_id
          AND (consumed_schedule.employer_response_id = invite.id OR
            (consumed_schedule.employer_response_id IS NULL AND consumed_schedule.created_at > invite.received_at))
      )
  )`;
  const hasActiveInterviewSchedule = sql`EXISTS (
    SELECT 1 FROM interview_schedules active_schedule
    WHERE active_schedule.application_id = ${applications.id}
      AND active_schedule.status IN ('scheduled', 'rescheduled')
  )`;
  const hasCancelledInterviewSchedule = sql`EXISTS (
    SELECT 1 FROM interview_schedules cancelled_schedule
    WHERE cancelled_schedule.application_id = ${applications.id}
      AND cancelled_schedule.status = 'cancelled'
  )`;
  const hasCompletedInterviewSchedule = sql`EXISTS (
    SELECT 1 FROM interview_schedules completed_schedule
    WHERE completed_schedule.application_id = ${applications.id}
      AND completed_schedule.status = 'completed'
  )`;
  const hasMissingInterviewOutcome = sql`EXISTS (
    SELECT 1 FROM interview_schedules completed_interview
    WHERE completed_interview.application_id = ${applications.id}
      AND completed_interview.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM employer_responses outcome_response
        WHERE outcome_response.user_id = ${userId}
          AND outcome_response.application_id = ${applications.id}
          AND outcome_response.interview_id = completed_interview.id
      )
  )`;
  const condition = and(
    eq(applications.userId, userId),
    dueTiming,
    sql`NOT ${hasActiveDraft}`,
    sql`NOT ${hasLatestReplyableResponse}`,
    sql`(${applications.status} <> 'interview' OR (
      NOT ${hasUnconsumedInvite}
      AND (${hasActiveInterviewSchedule} OR (
        NOT ${hasCancelledInterviewSchedule}
        AND ${hasCompletedInterviewSchedule}
      ))
      AND NOT ${hasMissingInterviewOutcome}
    ))`
  );
  const dueCondition = and(eq(applications.userId, userId), dueTiming);
  const selection = {
    applicationId: applications.id,
    jobId: applications.jobId,
    status: applications.status,
    daysSinceActivity,
    job: { id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location },
  };
  const [rows, countRows, candidateCountRows] = await Promise.all([
    db
      .select(selection)
      .from(applications)
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .where(condition)
      .orderBy(desc(daysSinceActivity), asc(applications.id))
      .limit(limit),
    db.select({ count: sql<number>`COUNT(*)` }).from(applications).where(condition),
    db.select({ count: sql<number>`COUNT(*)` }).from(applications).where(dueCondition),
  ]);
  const items = rows.map((row) => ({
    ...row,
    ...followUpDraftingCopy(row.status, Number(row.daysSinceActivity)),
    daysSinceActivity: Number(row.daysSinceActivity),
  }));
  const total = Number(countRows[0]?.count ?? 0);
  const candidateTotal = Number(candidateCountRows[0]?.count ?? 0);
  return {
    items,
    total,
    candidateTotal,
    blockedTotal: Math.max(0, candidateTotal - total),
    limit,
    hasMore: total > items.length,
  };
}

async function getMemoryUpcomingInterviewContexts(
  userId: number,
  now: Date,
  requestedLimit = Number.MAX_SAFE_INTEGER
) {
  const candidates = memoryInterviewSchedules
    .filter((interview) =>
      (interview.status === "scheduled" || interview.status === "rescheduled") &&
      interview.scheduledAt >= now
    )
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const applicationsById = new Map<number, Awaited<ReturnType<typeof getUserApplicationsByIds>>[number]>();
  const ownedUpcoming: typeof candidates = [];
  for (let offset = 0; offset < candidates.length && ownedUpcoming.length < requestedLimit; offset += 500) {
    const chunk = candidates.slice(offset, offset + 500);
    const ownedApplications = await getUserApplicationsByIds(
      userId,
      chunk.map((interview) => interview.applicationId)
    );
    for (const application of ownedApplications) applicationsById.set(application.id, application);
    for (const interview of chunk) {
      if (applicationsById.has(interview.applicationId)) ownedUpcoming.push(interview);
      if (ownedUpcoming.length === requestedLimit) break;
    }
  }
  return await Promise.all(ownedUpcoming.map(async (interview) => {
    const application = applicationsById.get(interview.applicationId)!;
    const job = await getJobById(application.jobId);
    return {
      interview,
      application: {
        id: application.id,
        jobId: application.jobId,
      },
      job: job ? {
        id: job.id,
        title: job.title,
        company: job.company,
      } : null,
    };
  }));
}

export async function getUpcomingInterviews(userId: number) {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    return await getMemoryUpcomingInterviewContexts(userId, now, 10);
  }
  const condition = and(
    eq(applications.userId, userId),
    sql`${interviewSchedules.status} IN ('scheduled', 'rescheduled')`,
    sql`${interviewSchedules.scheduledAt} >= ${now}`
  );
  return await db
    .select({
      interview: interviewSchedules,
      application: { id: applications.id, jobId: applications.jobId },
      job: { id: jobs.id, title: jobs.title, company: jobs.company },
    })
    .from(interviewSchedules)
    .innerJoin(applications, eq(interviewSchedules.applicationId, applications.id))
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(condition)
    .orderBy(asc(interviewSchedules.scheduledAt))
    .limit(10);
}

export async function getUpcomingInterviewPreparationPage(userId: number, requestedLimit = 10) {
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 50);
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const upcoming = await getMemoryUpcomingInterviewContexts(userId, now);
    const preparations = await getInterviewPreparationsForJobs(
      userId,
      upcoming.map((item) => item.application.jobId)
    );
    const preparedJobIds = new Set(preparations.map((preparation) => preparation.jobId));
    const items = upcoming.filter((item) => !preparedJobIds.has(item.application.jobId));
    return {
      items: items.slice(0, limit),
      total: items.length,
      limit,
      hasMore: items.length > limit,
    };
  }
  const condition = and(
    eq(applications.userId, userId),
    sql`${interviewSchedules.status} IN ('scheduled', 'rescheduled')`,
    sql`${interviewSchedules.scheduledAt} >= ${now}`,
    isNull(interviewPreparation.id)
  );
  const preparationJoin = and(
    eq(interviewPreparation.userId, userId),
    eq(interviewPreparation.jobId, applications.jobId)
  );
  const [items, totalRows] = await Promise.all([
    db
      .select({
        interview: interviewSchedules,
        application: { id: applications.id, jobId: applications.jobId },
        job: { id: jobs.id, title: jobs.title, company: jobs.company },
      })
      .from(interviewSchedules)
      .innerJoin(applications, eq(interviewSchedules.applicationId, applications.id))
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(interviewPreparation, preparationJoin)
      .where(condition)
      .orderBy(asc(interviewSchedules.scheduledAt))
      .limit(limit),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(interviewSchedules)
      .innerJoin(applications, eq(interviewSchedules.applicationId, applications.id))
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(interviewPreparation, preparationJoin)
      .where(condition),
  ]);
  const total = Number(totalRows[0]?.count ?? 0);
  return { items, total, limit, hasMore: total > items.length };
}

function parsePreparationList(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item).trim()).filter(Boolean)
      : [];
  } catch {
    return value
      .split(/\n+/)
      .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
      .filter(Boolean);
  }
}

function buildFallbackInterviewPreparation(job: {
  title?: string | null;
  company?: string | null;
  description?: string | null;
  requirements?: string | null;
}) {
  const role = job.title || "the role";
  const company = job.company || "the company";
  const roleContext = [job.description, job.requirements].filter(Boolean).join(" ").slice(0, 320);
  return {
    questions: [
      `How would you explain your most relevant experience for ${role} at ${company}?`,
      `Which project best demonstrates the skills this ${role} interview is likely to test?`,
      `What questions should you ask about the team, success metrics, and remote collaboration model?`,
      `How will you handle compensation, availability, and next-step questions if they come up?`,
    ],
    tips: [
      "Anchor answers in verified resume evidence and avoid adding claims that are not in the profile ledger.",
      "Prepare a concise opening summary, two STAR examples, and one thoughtful question for each interviewer.",
      "Confirm interview logistics, timezone, channel, and follow-up owner before the call ends.",
    ],
    companyInsights: roleContext
      ? `Use the job evidence to connect your examples to ${company}'s stated needs: ${roleContext}`
      : `Review ${company}'s public role description and prepare evidence-backed examples for ${role}.`,
  };
}

export async function getOwnedUpcomingInterviewContext(applicationId: number, userId: number) {
  const now = new Date();
  const db = await getDb();
  if (!db) {
    const application = await getInterviewApplication(applicationId, userId);
    const interview = memoryInterviewSchedules
      .filter((candidate) =>
        candidate.applicationId === applicationId &&
        ["scheduled", "rescheduled"].includes(candidate.status || "scheduled") &&
        candidate.scheduledAt >= now
      )
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime())[0];
    if (!interview) {
      throw new Error("Interview must be scheduled before interview preparation can be used.");
    }
    return { application, interview };
  }

  const rows = await db
    .select({ application: applications, interview: interviewSchedules })
    .from(applications)
    .innerJoin(interviewSchedules, eq(interviewSchedules.applicationId, applications.id))
    .where(and(
      eq(applications.id, applicationId),
      eq(applications.userId, userId),
      inArray(interviewSchedules.status, ["scheduled", "rescheduled"]),
      sql`${interviewSchedules.scheduledAt} >= ${now}`
    ))
    .orderBy(asc(interviewSchedules.scheduledAt))
    .limit(1);
  if (rows.length === 0) {
    const application = await getUserApplicationById(userId, applicationId);
    if (!application) throw new Error("Application not found.");
    throw new Error("Interview must be scheduled before interview preparation can be used.");
  }
  return rows[0];
}

export async function generateInterviewPreparationForApplication(applicationId: number, userId: number) {
  const { application, interview: activeInterview } = await getOwnedUpcomingInterviewContext(applicationId, userId);

  const existing = await getInterviewPreparationForJob(userId, application.jobId);
  if (existing) {
    return {
      preparationId: existing.id,
      existing: true,
      questions: parsePreparationList(existing.questions),
      tips: parsePreparationList(existing.coachingTips),
      companyInsights: existing.companyInsights || "",
    };
  }

  const job = await getJobById(application.jobId);
  if (!job) {
    throw new Error("Job not found.");
  }

  const fallback = buildFallbackInterviewPreparation(job);
  let generated = fallback;
  if (process.env.OPENAI_API_KEY?.trim()) {
    try {
      const aiGenerated = await generateAiInterviewPreparation(job);
      generated = {
        questions: aiGenerated.questions.length > 0 ? aiGenerated.questions : fallback.questions,
        tips: aiGenerated.tips.length > 0 ? aiGenerated.tips : fallback.tips,
        companyInsights: aiGenerated.companyInsights &&
          !aiGenerated.companyInsights.toLowerCase().startsWith("unable to generate insights")
          ? aiGenerated.companyInsights
          : fallback.companyInsights,
      };
    } catch {
      generated = fallback;
    }
  }

  const write = await upsertInterviewPreparation({
    userId,
    jobId: application.jobId,
    questions: JSON.stringify(generated.questions),
    coachingTips: JSON.stringify(generated.tips),
    companyInsights: generated.companyInsights,
  });

  await createAuditEvent({
    userId,
    entityType: "application",
    entityId: applicationId,
    action: "interview_preparation_generated",
    actor: "system",
    source: "applications.generateInterviewPreparation",
    beforeState: JSON.stringify({ preparationExists: false }),
    afterState: JSON.stringify({
      preparationId: Number(write.insertId),
      jobId: application.jobId,
      interviewId: activeInterview.id,
      questionCount: generated.questions.length,
      tipCount: generated.tips.length,
    }),
    riskLevel: "low",
  });

  return {
    preparationId: Number(write.insertId),
    existing: false,
    questions: generated.questions,
    tips: generated.tips,
    companyInsights: generated.companyInsights,
  };
}

export async function updateInterviewStatus(
  interviewId: number,
  status: "scheduled" | "completed" | "cancelled" | "rescheduled",
  userId: number
) {
  const db = await getDb();
  if (!db) {
    const interview = await findOwnedMemoryInterview(interviewId, userId);
    const currentStatus = interview.status || "scheduled";
    if (!canTransitionInterviewStatus(currentStatus, status)) {
      throw new Error(`Interview cannot move from ${currentStatus} to ${status}.`);
    }
    if (currentStatus === status) return { success: true };

    interview.status = status;
    interview.updatedAt = new Date();
    if (status === "completed") {
      await touchApplicationActivity(interview.applicationId, userId);
    }
    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: interview.applicationId,
      action: "interview_status_updated",
      actor: "user",
      source: "applications.updateInterviewStatus",
      beforeState: JSON.stringify({ status: currentStatus }),
      afterState: JSON.stringify({ status, interviewId }),
      riskLevel: status === "cancelled" ? "medium" : "low",
    });

    return { success: true };
  }

  const interview = await db
    .select({
      applicationId: interviewSchedules.applicationId,
      status: interviewSchedules.status,
    })
    .from(interviewSchedules)
    .innerJoin(applications, eq(interviewSchedules.applicationId, applications.id))
    .where(and(
      eq(interviewSchedules.id, interviewId),
      eq(applications.userId, userId)
    ))
    .limit(1);
  if (!interview[0]) throw new Error("Interview not found.");
  const currentStatus = interview[0].status || "scheduled";
  if (!canTransitionInterviewStatus(currentStatus, status)) {
    throw new Error(`Interview cannot move from ${currentStatus} to ${status}.`);
  }
  if (currentStatus === status) return { success: true };

  const result = await db
    .update(interviewSchedules)
    .set({ status })
    .where(
      and(
        eq(interviewSchedules.id, interviewId),
        eq(interviewSchedules.status, currentStatus),
        sql`EXISTS (
          SELECT 1 FROM applications
          WHERE applications.id = ${interviewSchedules.applicationId}
          AND applications.user_id = ${userId}
        )`
      )
    );
  if (Number(result[0].affectedRows) === 0) {
    throw new Error("Interview status changed concurrently. Refresh and try again.");
  }

  if (status === "completed") {
    await db
      .update(applications)
      .set({ lastActivity: new Date() })
      .where(and(
        eq(applications.id, interview[0].applicationId),
        eq(applications.userId, userId)
      ));
  }

  await db.insert(auditEvents).values({
    userId,
    entityType: "application",
    entityId: interview[0].applicationId,
    action: "interview_status_updated",
    actor: "user",
    source: "applications.updateInterviewStatus",
    beforeState: JSON.stringify({ status: currentStatus }),
    afterState: JSON.stringify({ status, interviewId }),
    riskLevel: status === "cancelled" ? "medium" : "low",
  });

  return { success: true };
}

export type InterviewOutcomeType = "next_round" | "offer" | "rejection" | "no_response" | "other";

export interface RecordInterviewOutcomeInput {
  interviewId: number;
  outcome: InterviewOutcomeType;
  source: EmployerResponseInput["source"];
  sourceReference?: string | null;
  summary: string;
  receivedAt?: Date;
}

const INTERVIEW_OUTCOME_LABELS: Record<InterviewOutcomeType, string> = {
  next_round: "next interview round",
  offer: "offer",
  rejection: "rejection",
  no_response: "no employer response yet",
  other: "other interview outcome",
};

function interviewOutcomeResponseType(outcome: InterviewOutcomeType): EmployerResponseInput["responseType"] {
  switch (outcome) {
    case "next_round":
      return "interview_invite";
    case "offer":
      return "offer";
    case "rejection":
      return "rejection";
    case "no_response":
      return "no_response";
    case "other":
      return "other";
  }
}

function interviewOutcomeSource(input: RecordInterviewOutcomeInput): EmployerResponseInput["source"] {
  return input.outcome === "no_response" ? "other" : input.source;
}

function interviewOutcomeSourceReference(input: RecordInterviewOutcomeInput) {
  return input.outcome === "no_response" ? null : input.sourceReference;
}

function interviewOutcomeSummary(input: RecordInterviewOutcomeInput) {
  return [
    `Interview outcome recorded: ${INTERVIEW_OUTCOME_LABELS[input.outcome]}.`,
    input.summary.trim(),
  ].join("\n");
}

export async function recordInterviewOutcome(input: RecordInterviewOutcomeInput, userId: number) {
  const db = await getDb();
  const receivedAt = input.receivedAt || new Date();

  if (!db) {
    const interview = await findOwnedMemoryInterview(input.interviewId, userId);
    const currentInterviewStatus = interview.status || "scheduled";
    if (currentInterviewStatus === "cancelled") {
      throw new Error("Cancelled interviews cannot receive outcomes.");
    }
    const application = await getInterviewApplication(interview.applicationId, userId);
    const responseInput = {
      applicationId: interview.applicationId,
      interviewId: input.interviewId,
      responseType: interviewOutcomeResponseType(input.outcome),
      source: interviewOutcomeSource(input),
      sourceReference: interviewOutcomeSourceReference(input),
      summary: interviewOutcomeSummary(input),
      receivedAt,
    };
    normalizeEmployerResponse(responseInput, application.status || "pending", receivedAt);

    if (currentInterviewStatus !== "completed") {
      await updateInterviewStatus(input.interviewId, "completed", userId);
    }
    const response = await recordEmployerResponse(responseInput, userId);

    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: interview.applicationId,
      action: "interview_outcome_recorded",
      actor: "user",
      source: "applications.recordInterviewOutcome",
      beforeState: JSON.stringify({ interviewStatus: currentInterviewStatus }),
      afterState: JSON.stringify({
        interviewId: input.interviewId,
        outcome: input.outcome,
        responseId: response.responseId,
        responseType: response.responseType,
      }),
      riskLevel: input.outcome === "offer" ? "high" : input.outcome === "rejection" ? "medium" : "low",
    });

    return { ...response, interviewStatus: "completed", outcome: input.outcome };
  }

  const interview = await db
    .select({
      applicationId: interviewSchedules.applicationId,
      status: interviewSchedules.status,
      applicationStatus: applications.status,
    })
    .from(interviewSchedules)
    .innerJoin(applications, eq(interviewSchedules.applicationId, applications.id))
    .where(and(
      eq(interviewSchedules.id, input.interviewId),
      eq(applications.userId, userId)
    ))
    .limit(1);
  if (!interview[0]) throw new Error("Interview not found.");

  const currentInterviewStatus = interview[0].status || "scheduled";
  if (currentInterviewStatus === "cancelled") {
    throw new Error("Cancelled interviews cannot receive outcomes.");
  }
  const responseInput = {
    applicationId: interview[0].applicationId,
    interviewId: input.interviewId,
    responseType: interviewOutcomeResponseType(input.outcome),
    source: interviewOutcomeSource(input),
    sourceReference: interviewOutcomeSourceReference(input),
    summary: interviewOutcomeSummary(input),
    receivedAt,
  };
  normalizeEmployerResponse(responseInput, interview[0].applicationStatus || "pending", receivedAt);

  if (currentInterviewStatus !== "completed") {
    await updateInterviewStatus(input.interviewId, "completed", userId);
  }
  const response = await recordEmployerResponse(responseInput, userId);

  await createAuditEvent({
    userId,
    entityType: "application",
    entityId: interview[0].applicationId,
    action: "interview_outcome_recorded",
    actor: "user",
    source: "applications.recordInterviewOutcome",
    beforeState: JSON.stringify({ interviewStatus: currentInterviewStatus }),
    afterState: JSON.stringify({
      interviewId: input.interviewId,
      outcome: input.outcome,
      responseId: response.responseId,
      responseType: response.responseType,
    }),
    riskLevel: input.outcome === "offer" ? "high" : input.outcome === "rejection" ? "medium" : "low",
  });

  return { ...response, interviewStatus: "completed", outcome: input.outcome };
}

export async function rescheduleInterview(interviewId: number, newDate: Date, userId: number) {
  const db = await getDb();
  if (newDate.getTime() <= Date.now()) {
    throw new Error("Interview must be rescheduled in the future.");
  }

  if (!db) {
    const interview = await findOwnedMemoryInterview(interviewId, userId);
    const currentStatus = interview.status || "scheduled";
    if (!canTransitionInterviewStatus(currentStatus, "rescheduled")) {
      throw new Error(`Interview cannot move from ${currentStatus} to rescheduled.`);
    }

    interview.scheduledAt = newDate;
    interview.status = "rescheduled";
    interview.updatedAt = new Date();
    const approval = await createApplicationApproval({
      userId,
      applicationId: interview.applicationId,
      entityType: "application",
      entityId: interview.applicationId,
      approvalType: "interview_schedule",
      status: "approved",
      riskLevel: "high",
      requestedBy: "user",
      decidedBy: "user",
      title: "Interview time rescheduled",
      description: `User rescheduled interview #${interviewId} for ${newDate.toISOString()}.`,
      payload: JSON.stringify({
        interviewId,
        previousStatus: currentStatus,
        scheduledAt: newDate.toISOString(),
      }),
      decisionNote: "User accepted the new interview time.",
      requestedAt: new Date(),
      decidedAt: new Date(),
    });
    const approvalId = Number(approval.insertId);

    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: interview.applicationId,
      action: "interview_rescheduled",
      actor: "user",
      source: "applications.rescheduleInterview",
      beforeState: JSON.stringify({ status: currentStatus }),
      afterState: JSON.stringify({
        status: "rescheduled",
        interviewId,
        scheduledAt: newDate.toISOString(),
      }),
      riskLevel: "high",
      approvalId,
    });

    return { success: true, approvalId };
  }

  const interview = await db
    .select({
      applicationId: interviewSchedules.applicationId,
      status: interviewSchedules.status,
    })
    .from(interviewSchedules)
    .innerJoin(applications, eq(interviewSchedules.applicationId, applications.id))
    .where(and(
      eq(interviewSchedules.id, interviewId),
      eq(applications.userId, userId)
    ))
    .limit(1);
  if (!interview[0]) throw new Error("Interview not found.");
  const currentStatus = interview[0].status || "scheduled";
  if (!canTransitionInterviewStatus(currentStatus, "rescheduled")) {
    throw new Error(`Interview cannot move from ${currentStatus} to rescheduled.`);
  }

  const result = await db
    .update(interviewSchedules)
    .set({
      scheduledAt: newDate,
      status: "rescheduled",
    })
    .where(
      and(
        eq(interviewSchedules.id, interviewId),
        eq(interviewSchedules.status, currentStatus),
        sql`EXISTS (
          SELECT 1 FROM applications
          WHERE applications.id = ${interviewSchedules.applicationId}
          AND applications.user_id = ${userId}
        )`
      )
    );
  if (Number(result[0].affectedRows) === 0) {
    throw new Error("Interview status changed concurrently. Refresh and try again.");
  }
  const approval = await db.insert(applicationApprovals).values({
    userId,
    applicationId: interview[0].applicationId,
    entityType: "application",
    entityId: interview[0].applicationId,
    approvalType: "interview_schedule",
    status: "approved",
    riskLevel: "high",
    requestedBy: "user",
    decidedBy: "user",
    title: "Interview time rescheduled",
    description: `User rescheduled interview #${interviewId} for ${newDate.toISOString()}.`,
    payload: JSON.stringify({
      interviewId,
      previousStatus: currentStatus,
      scheduledAt: newDate.toISOString(),
    }),
    decisionNote: "User accepted the new interview time.",
    requestedAt: new Date(),
    decidedAt: new Date(),
  });
  const approvalId = Number(approval[0].insertId);

  await db
    .update(applications)
    .set({ lastActivity: newDate })
    .where(and(
      eq(applications.id, interview[0].applicationId),
      eq(applications.userId, userId)
    ));

  await db.insert(auditEvents).values({
    userId,
    entityType: "application",
    entityId: interview[0].applicationId,
    action: "interview_rescheduled",
    actor: "user",
    source: "applications.rescheduleInterview",
    beforeState: JSON.stringify({ status: currentStatus }),
    afterState: JSON.stringify({
      status: "rescheduled",
      interviewId,
      scheduledAt: newDate.toISOString(),
    }),
    riskLevel: "high",
    approvalId,
  });

  return { success: true, approvalId };
}

// ==================== FOLLOW-UP EMAILS ====================

export interface FollowUpInput {
  applicationId: number;
  message: string;
  purpose?: "routine_follow_up" | "employer_reply";
  sourceResponseId?: number;
}

function normalizeFollowUpDeliveryConfirmation(value?: string): string {
  const confirmation = value?.trim().replace(/\r\n/g, "\n") || "";
  if (confirmation.length < 8) {
    throw new Error("A delivery confirmation is required before marking a follow-up sent.");
  }
  if (confirmation.length > 1000) {
    throw new Error("Follow-up delivery confirmation is too long.");
  }
  return confirmation;
}

const memoryFollowUps: (FollowUp & { id: number; createdAt: Date })[] = [];

function nextMemoryFollowUpId() {
  return (memoryFollowUps.reduce((max, item) => Math.max(max, item.id), 0) || 0) + 1;
}

async function getFollowUpApplication(applicationId: number, userId: number) {
  const application = await getUserApplicationById(userId, applicationId);
  if (!application) {
    throw new Error("Application not found.");
  }
  return application;
}

function assertFollowUpAllowed(status: string) {
  if (!["applied", "viewed", "interview"].includes(status)) {
    throw new Error("Follow-ups can only be created after an application has been submitted.");
  }
}

async function findOwnedMemoryFollowUp(followUpId: number, userId: number) {
  const followUp = memoryFollowUps.find((item) => item.id === followUpId);
  if (!followUp || !await getUserApplicationById(userId, followUp.applicationId)) {
    throw new Error("Follow-up not found.");
  }
  return followUp;
}

async function getEmployerResponseForReply(applicationId: number, userId: number, responseId?: number) {
  const response = await getEmployerResponseReplyTarget(applicationId, userId, responseId);

  if (!response) {
    throw new Error("Employer response not found.");
  }
  if (!["employer_question", "other"].includes(response.responseType)) {
    throw new Error("Reply drafts require an employer question or ambiguous response.");
  }

  return response;
}

function getFollowUpDraftMetadata(
  input: FollowUpInput,
  sourceResponse?: { id: number; responseType: string }
): {
  purpose: "routine_follow_up" | "employer_reply";
  sourceResponseId: number | null;
  responseType: string | null;
} {
  const purpose = input.purpose === "employer_reply" ? "employer_reply" : "routine_follow_up";
  return {
    purpose,
    sourceResponseId: sourceResponse?.id ?? input.sourceResponseId ?? null,
    responseType: sourceResponse?.responseType ?? null,
  };
}

function getFollowUpApprovalCopy(purpose: "routine_follow_up" | "employer_reply") {
  if (purpose === "employer_reply") {
    return {
      title: "Approve employer reply before sending",
      description: "Review and approve this employer reply draft before any external message is sent.",
      draftAction: "employer_reply_draft_created",
    };
  }

  return {
    title: "Approve follow-up before sending",
    description: "Review and approve this follow-up draft before any external message is sent.",
    draftAction: "follow_up_draft_created",
  };
}

export async function createFollowUp(input: FollowUpInput, userId: number) {
  // A draft is not delivery evidence. Keep recording a send behind the
  // explicit approval and post-delivery confirmation path in markFollowUpSent.
  if ("sendDate" in (input as unknown as Record<string, unknown>)) {
    throw new Error("Follow-up delivery cannot be recorded while creating a draft. Approve the draft, send it externally, then mark it sent.");
  }

  const db = await getDb();
  const message = sanitizeFollowUpMessage(input.message);
  const sourceResponse = input.purpose === "employer_reply"
    ? await getEmployerResponseForReply(input.applicationId, userId, input.sourceResponseId)
    : undefined;
  const metadata = getFollowUpDraftMetadata(input, sourceResponse);
  const approvalCopy = getFollowUpApprovalCopy(metadata.purpose);

  if (!db) {
    const application = await getFollowUpApplication(input.applicationId, userId);
    assertFollowUpAllowed(application.status || "pending");

    const record = {
      id: nextMemoryFollowUpId(),
      applicationId: input.applicationId,
      sourceResponseId: metadata.sourceResponseId,
      message,
      sentDate: null,
      deliveryConfirmation: null,
      deliveryProvider: null,
      deliveryState: "draft" as const,
      deliveryRecipient: null,
      deliverySubject: null,
      deliveryMessageId: null,
      deliveryAttemptKey: null,
      deliveryFailureMessage: null,
      responseReceived: 0,
      createdAt: new Date(),
    };
    memoryFollowUps.push(record);

    await createApplicationApproval({
      userId,
      applicationId: input.applicationId,
      entityType: "follow_up",
      entityId: record.id,
      approvalType: "follow_up_send",
      status: "pending",
      riskLevel: "medium",
      requestedBy: "system",
      decidedBy: null,
      title: approvalCopy.title,
      description: approvalCopy.description,
      payload: JSON.stringify({ message, ...metadata }),
      decidedAt: null,
    });
    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: input.applicationId,
      action: approvalCopy.draftAction,
      actor: "user",
      source: "applications.createFollowUp",
      afterState: JSON.stringify({
        followUpId: record.id,
        approvalStatus: "pending",
        ...metadata,
      }),
      riskLevel: "medium",
    });

    return { id: record.id };
  }

  const application = await assertUserOwnsApplication(input.applicationId, userId);
  assertFollowUpAllowed(application.status);

  return await db.transaction(async (tx) => {
    const result = await tx.insert(followUps).values({
      applicationId: input.applicationId,
      sourceResponseId: metadata.sourceResponseId,
      message,
      sentDate: null,
      responseReceived: 0,
    });

    const followUpId = Number(result[0].insertId);
    await tx.insert(applicationApprovals).values({
      userId,
      applicationId: input.applicationId,
      entityType: "follow_up",
      entityId: followUpId,
      approvalType: "follow_up_send",
      status: "pending",
      riskLevel: "medium",
      requestedBy: "system",
      decidedBy: null,
      title: approvalCopy.title,
      description: approvalCopy.description,
      payload: JSON.stringify({ message, ...metadata }),
      decidedAt: null,
    });
    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: input.applicationId,
      action: approvalCopy.draftAction,
      actor: "user",
      source: "applications.createFollowUp",
      afterState: JSON.stringify({
        followUpId,
        approvalStatus: "pending",
        ...metadata,
      }),
      riskLevel: "medium",
    });

    return { id: followUpId };
  });
}

export async function getFollowUps(applicationId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    await getFollowUpApplication(applicationId, userId);
    return memoryFollowUps
      .filter((followUp) => followUp.applicationId === applicationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  await assertUserOwnsApplication(applicationId, userId);

  return await db
    .select()
    .from(followUps)
    .where(eq(followUps.applicationId, applicationId))
    .orderBy(desc(followUps.createdAt));
}

export async function getFollowUpPage(
  applicationId: number,
  userId: number,
  options: {
    limit?: number;
    cursor?: { createdAt: Date; id: number };
  } = {}
) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 10), 1), 50);
  const db = await getDb();
  if (!db) {
    await getFollowUpApplication(applicationId, userId);
    const rows = memoryFollowUps
      .filter((followUp) => followUp.applicationId === applicationId)
      .filter((followUp) => !options.cursor || (
        followUp.createdAt < options.cursor.createdAt ||
        (followUp.createdAt.getTime() === options.cursor.createdAt.getTime() && followUp.id < options.cursor.id)
      ))
      .sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id
      )
      .slice(0, limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }
  await assertUserOwnsApplication(applicationId, userId);

  const cursorCondition = options.cursor
    ? or(
      lt(followUps.createdAt, options.cursor.createdAt),
      and(eq(followUps.createdAt, options.cursor.createdAt), lt(followUps.id, options.cursor.id))
    )
    : undefined;
  const rows = await db
    .select()
    .from(followUps)
    .where(and(
      eq(followUps.applicationId, applicationId),
      cursorCondition
    ))
    .orderBy(desc(followUps.createdAt), desc(followUps.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export async function getUserFollowUpsForApplications(
  userId: number,
  applicationIds: number[]
) {
  const boundedApplicationIds = Array.from(new Set(
    applicationIds.filter((applicationId) => Number.isInteger(applicationId) && applicationId > 0)
  )).slice(0, 500);
  if (boundedApplicationIds.length === 0) return [] as FollowUp[];
  const requestedApplicationIds = new Set(boundedApplicationIds);

  const db = await getDb();
  if (!db) {
    const applicationsForUser = await getUserApplicationsByIds(userId, boundedApplicationIds);
    const ownedApplicationIds = new Set(
      applicationsForUser
        .filter((application) => requestedApplicationIds.has(application.id))
        .map((application) => application.id)
    );
    return memoryFollowUps
      .filter((followUp) => ownedApplicationIds.has(followUp.applicationId))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  const rows = await db
    .select({ followUp: followUps })
    .from(followUps)
    .innerJoin(applications, eq(followUps.applicationId, applications.id))
    .where(and(
      eq(applications.userId, userId),
      inArray(applications.id, boundedApplicationIds)
    ))
    .orderBy(desc(followUps.createdAt));
  return rows.map((row) => row.followUp);
}

const WITHDRAWAL_CANCELLATION_NOTE = "Application was withdrawn, so this unsent external action is no longer permitted.";
const OFFER_ACCEPTANCE_CANCELLATION_NOTE = "Offer acceptance ended this application campaign, so this unsent external action is no longer permitted.";

function isWithdrawalCancellableApproval(
  approval: { approvalType: string; entityId: number; status: string },
  unsentFollowUpIds: Set<number>,
  cancelOfferAttribution: boolean
) {
  if (!["pending", "approved"].includes(approval.status)) return false;
  if (approval.approvalType === "application_submission") return true;
  if (cancelOfferAttribution && approval.approvalType === "offer_attribution") return true;
  return approval.approvalType === "follow_up_send" && unsentFollowUpIds.has(approval.entityId);
}

export async function withdrawApplication(
  applicationId: number,
  userId: number,
  options: { cancelOfferAttribution?: boolean; dismissOfferAttributionReviews?: boolean } = {}
) {
  const db = await getDb();
  const cancelledAt = new Date();
  const cancelOfferAttribution = options.cancelOfferAttribution === true;
  const dismissOfferAttributionReviews = options.dismissOfferAttributionReviews === true;

  if (!db) {
    const application = await getUserApplicationById(userId, applicationId);
    if (!application) throw new Error("Application not found.");

    const followUpsForApplication = await getFollowUps(applicationId, userId);
    const unsentFollowUpIds = new Set(
      followUpsForApplication.filter((followUp) => !followUp.sentDate).map((followUp) => followUp.id)
    );
    const cancellableApprovals = (await listUserApplicationApprovalsForApplication(userId, applicationId)).filter((approval) =>
      approval.applicationId === applicationId &&
      isWithdrawalCancellableApproval(approval, unsentFollowUpIds, cancelOfferAttribution)
    );
    const cancelledInterviews = memoryInterviewSchedules.filter((interview) =>
      interview.applicationId === applicationId &&
      ["scheduled", "rescheduled"].includes(interview.status || "scheduled")
    );
    const cancelledInterviewIds = cancelledInterviews.map((interview) => interview.id);
    for (const interview of cancelledInterviews) {
      interview.status = "cancelled";
      interview.updatedAt = cancelledAt;
    }

    await updateApplicationStatus(applicationId, "withdrawn", userId);
    const retiredInterviewNotificationIds = await retireInterviewNotificationsAfterApplicationClosure(
      applicationId,
      userId,
      "withdrawn",
      "applications.withdraw"
    );
    for (const approval of cancellableApprovals) {
      if (approval.status === "pending") {
        await resolveApplicationApproval(
          approval.id,
          userId,
          "cancelled",
          WITHDRAWAL_CANCELLATION_NOTE,
          "user"
        );
      } else {
        approval.status = "cancelled";
        approval.decidedBy = "user";
        approval.decisionNote = WITHDRAWAL_CANCELLATION_NOTE;
        approval.decidedAt = cancelledAt;
        approval.updatedAt = cancelledAt;
      }
    }

    const cancelledSubmissionApprovalIds = cancellableApprovals
      .filter((approval) => approval.approvalType === "application_submission")
      .map((approval) => approval.id);
    const cancelledOfferAttributionApprovalIds = cancellableApprovals
      .filter((approval) => approval.approvalType === "offer_attribution")
      .map((approval) => approval.id);
    const dismissedOfferAttributionReviewIds = dismissOfferAttributionReviews
      ? (await dismissOfferAttributionAdminReviews(
        userId,
        applicationId,
        "Dismissed because the user explicitly declined this offer."
      )).dismissedReviewIds
      : [];
    for (const approvalId of cancelledSubmissionApprovalIds) {
      await createApplicationAttempt({
        applicationId,
        userId,
        jobId: application.jobId,
        platformId: application.job?.platformId ?? undefined,
        attemptType: "external_handoff",
        status: "cancelled",
        startedAt: cancelledAt,
        finishedAt: cancelledAt,
        confirmationText: `Submission approval ${approvalId} was cancelled because the application was withdrawn.`,
        retryCount: 0,
      });
    }

    if (cancellableApprovals.length > 0) {
      await createAuditEvent({
        userId,
        entityType: "application",
        entityId: applicationId,
        action: "application_external_actions_cancelled",
        actor: "user",
        source: "applications.withdraw",
        afterState: JSON.stringify({
          status: "withdrawn",
          cancelledApprovalIds: cancellableApprovals.map((approval) => approval.id),
          cancelledSubmissionApprovalIds,
          cancelledOfferAttributionApprovalIds,
          dismissedOfferAttributionReviewIds,
        }),
        riskLevel: "medium",
      });
    }
    if (cancelledInterviewIds.length > 0) {
      await createAuditEvent({
        userId,
        entityType: "application",
        entityId: applicationId,
        action: "interviews_cancelled_after_application_withdrawal",
        actor: "user",
        source: "applications.withdraw",
        afterState: JSON.stringify({
          status: "withdrawn",
          cancelledInterviewIds,
          externalCancellationSent: false,
        }),
        riskLevel: "medium",
      });
    }

    return {
      success: true,
      cancelledApprovalIds: cancellableApprovals.map((approval) => approval.id),
      cancelledSubmissionApprovalIds,
      cancelledOfferAttributionApprovalIds,
      dismissedOfferAttributionReviewIds,
      cancelledInterviewIds,
      retiredInterviewNotificationIds,
    };
  }

  return await db.transaction(async (tx) => {
    const application = await tx
      .select({ id: applications.id, status: applications.status, jobId: applications.jobId })
      .from(applications)
      .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
      .limit(1);
    if (!application[0]) throw new Error("Application not found.");
    if (!canTransitionApplicationStatus(application[0].status, "withdrawn")) {
      throw new Error(`Application cannot move from ${application[0].status} to withdrawn.`);
    }

    const unsentFollowUpRows = await tx
      .select({ id: followUps.id })
      .from(followUps)
      .where(and(eq(followUps.applicationId, applicationId), isNull(followUps.sentDate)));
    const unsentFollowUpIds = new Set(unsentFollowUpRows.map((followUp) => followUp.id));
    const activeApprovals = await tx
      .select({
        id: applicationApprovals.id,
        approvalType: applicationApprovals.approvalType,
        entityId: applicationApprovals.entityId,
        status: applicationApprovals.status,
      })
      .from(applicationApprovals)
      .where(and(
        eq(applicationApprovals.userId, userId),
        eq(applicationApprovals.applicationId, applicationId),
        inArray(applicationApprovals.status, ["pending", "approved"])
      ));
    const cancellableApprovals = activeApprovals.filter((approval) =>
      isWithdrawalCancellableApproval(approval, unsentFollowUpIds, cancelOfferAttribution)
    );
    const scheduledInterviews = await tx
      .select({ id: interviewSchedules.id })
      .from(interviewSchedules)
      .where(and(
        eq(interviewSchedules.applicationId, applicationId),
        inArray(interviewSchedules.status, ["scheduled", "rescheduled"])
      ));
    const cancelledInterviewIds = scheduledInterviews.map((interview) => interview.id);
    if (cancelledInterviewIds.length > 0) {
      await tx
        .update(interviewSchedules)
        .set({ status: "cancelled" })
        .where(and(
          inArray(interviewSchedules.id, cancelledInterviewIds),
          inArray(interviewSchedules.status, ["scheduled", "rescheduled"])
        ));
    }

    if (application[0].status !== "withdrawn") {
      const statusUpdate = await tx
        .update(applications)
        .set({ status: "withdrawn", lastActivity: cancelledAt })
        .where(and(
          eq(applications.id, applicationId),
          eq(applications.userId, userId),
          eq(applications.status, application[0].status)
        ));
      if (Number(statusUpdate[0].affectedRows) === 0) {
        throw new Error("Application status changed concurrently. Refresh and try again.");
      }
    }

    const unreadInterviewNotifications = await tx
      .select({ id: applicationNotifications.id })
      .from(applicationNotifications)
      .where(and(
        eq(applicationNotifications.applicationId, applicationId),
        eq(applicationNotifications.userId, userId),
        isNull(applicationNotifications.readAt)
      ));
    const retiredInterviewNotificationIds = unreadInterviewNotifications.map((notification) => notification.id);
    if (retiredInterviewNotificationIds.length > 0) {
      await tx
        .update(applicationNotifications)
        .set({ readAt: cancelledAt })
        .where(and(
          inArray(applicationNotifications.id, retiredInterviewNotificationIds),
          isNull(applicationNotifications.readAt)
        ));
      await tx.insert(auditEvents).values({
        userId,
        entityType: "application",
        entityId: applicationId,
        action: "interview_notifications_retired_after_application_closure",
        actor: "user",
        source: "applications.withdraw",
        afterState: JSON.stringify({ status: "withdrawn", notificationIds: retiredInterviewNotificationIds }),
        riskLevel: "low",
      });
    }

    if (cancellableApprovals.length > 0) {
      await tx
        .update(applicationApprovals)
        .set({
          status: "cancelled",
          decidedBy: "user",
          decisionNote: WITHDRAWAL_CANCELLATION_NOTE,
          decidedAt: cancelledAt,
        })
        .where(and(
          eq(applicationApprovals.userId, userId),
          inArray(applicationApprovals.id, cancellableApprovals.map((approval) => approval.id)),
          inArray(applicationApprovals.status, ["pending", "approved"])
        ));
    }

    const cancelledSubmissionApprovalIds = cancellableApprovals
      .filter((approval) => approval.approvalType === "application_submission")
      .map((approval) => approval.id);
    const cancelledOfferAttributionApprovalIds = cancellableApprovals
      .filter((approval) => approval.approvalType === "offer_attribution")
      .map((approval) => approval.id);
    const dismissibleOfferAttributionReviews = dismissOfferAttributionReviews
      ? await tx
        .select({ id: adminReviewItems.id })
        .from(adminReviewItems)
        .where(and(
          eq(adminReviewItems.userId, userId),
          eq(adminReviewItems.entityType, "application"),
          eq(adminReviewItems.entityId, applicationId),
          eq(adminReviewItems.category, "offer_attribution"),
          inArray(adminReviewItems.status, ["open", "in_progress"])
        ))
      : [];
    const dismissedOfferAttributionReviewIds = dismissibleOfferAttributionReviews.map((review) => review.id);
    if (dismissedOfferAttributionReviewIds.length > 0) {
      await tx
        .update(adminReviewItems)
        .set({
          status: "dismissed",
          resolution: "Dismissed because the user explicitly declined this offer.",
          resolvedAt: cancelledAt,
        })
        .where(inArray(adminReviewItems.id, dismissedOfferAttributionReviewIds));
    }
    if (cancelledSubmissionApprovalIds.length > 0) {
      const job = await tx
        .select({ platformId: jobs.platformId })
        .from(jobs)
        .where(eq(jobs.id, application[0].jobId))
        .limit(1);
      await tx.insert(applicationAttempts).values(cancelledSubmissionApprovalIds.map((approvalId) => ({
        applicationId,
        userId,
        jobId: application[0].jobId,
        platformId: job[0]?.platformId ?? null,
        attemptType: "external_handoff" as const,
        status: "cancelled" as const,
        startedAt: cancelledAt,
        finishedAt: cancelledAt,
        confirmationText: `Submission approval ${approvalId} was cancelled because the application was withdrawn.`,
        retryCount: 0,
      })));
    }

    if (cancellableApprovals.length > 0) {
      await tx.insert(auditEvents).values({
        userId,
        entityType: "application",
        entityId: applicationId,
        action: "application_external_actions_cancelled",
        actor: "user",
        source: "applications.withdraw",
        afterState: JSON.stringify({
          status: "withdrawn",
          cancelledApprovalIds: cancellableApprovals.map((approval) => approval.id),
          cancelledSubmissionApprovalIds,
          cancelledOfferAttributionApprovalIds,
          dismissedOfferAttributionReviewIds,
        }),
        riskLevel: "medium",
      });
    }
    if (cancelledInterviewIds.length > 0) {
      await tx.insert(auditEvents).values({
        userId,
        entityType: "application",
        entityId: applicationId,
        action: "interviews_cancelled_after_application_withdrawal",
        actor: "user",
        source: "applications.withdraw",
        afterState: JSON.stringify({
          status: "withdrawn",
          cancelledInterviewIds,
          externalCancellationSent: false,
        }),
        riskLevel: "medium",
      });
    }

    return {
      success: true,
      cancelledApprovalIds: cancellableApprovals.map((approval) => approval.id),
      cancelledSubmissionApprovalIds,
      cancelledOfferAttributionApprovalIds,
      dismissedOfferAttributionReviewIds,
      cancelledInterviewIds,
      retiredInterviewNotificationIds,
    };
  });
}

export async function acceptOfferApplication(applicationId: number, userId: number) {
  const db = await getDb();
  const acceptedAt = new Date();

  if (!db) {
    const application = await getUserApplicationById(userId, applicationId);
    if (!application) throw new Error("Application not found.");
    if (application.status !== "offer") {
      throw new Error("Only a recorded offer can be confirmed as accepted.");
    }

    const unsentFollowUpIds = new Set(
      (await getFollowUps(applicationId, userId))
        .filter((followUp) => !followUp.sentDate)
        .map((followUp) => followUp.id)
    );
    const cancelledFollowUpApprovals = (await listUserApplicationApprovalsForApplication(userId, applicationId)).filter((approval) =>
      approval.applicationId === applicationId &&
      approval.entityType === "follow_up" &&
      approval.approvalType === "follow_up_send" &&
      unsentFollowUpIds.has(approval.entityId) &&
      ["pending", "approved"].includes(approval.status)
    );
    for (const approval of cancelledFollowUpApprovals) {
      if (approval.status === "pending") {
        await resolveApplicationApproval(
          approval.id,
          userId,
          "cancelled",
          OFFER_ACCEPTANCE_CANCELLATION_NOTE,
          "user"
        );
      } else {
        approval.status = "cancelled";
        approval.decidedBy = "user";
        approval.decisionNote = OFFER_ACCEPTANCE_CANCELLATION_NOTE;
        approval.decidedAt = acceptedAt;
        approval.updatedAt = acceptedAt;
      }
    }

    const cancelledInterviews = memoryInterviewSchedules.filter((interview) =>
      interview.applicationId === applicationId &&
      ["scheduled", "rescheduled"].includes(interview.status || "scheduled")
    );
    const cancelledInterviewIds = cancelledInterviews.map((interview) => interview.id);
    for (const interview of cancelledInterviews) {
      interview.status = "cancelled";
      interview.updatedAt = acceptedAt;
    }

    await updateApplicationStatus(applicationId, "accepted", userId);
    const retiredInterviewNotificationIds = await retireInterviewNotificationsAfterApplicationClosure(
      applicationId,
      userId,
      "accepted",
      "applications.confirmOfferAcceptance"
    );
    if (cancelledFollowUpApprovals.length > 0 || cancelledInterviewIds.length > 0) {
      await createAuditEvent({
        userId,
        entityType: "application",
        entityId: applicationId,
        action: "application_actions_retired_after_offer_acceptance",
        actor: "user",
        source: "applications.confirmOfferAcceptance",
        afterState: JSON.stringify({
          status: "accepted",
          cancelledFollowUpApprovalIds: cancelledFollowUpApprovals.map((approval) => approval.id),
          cancelledInterviewIds,
          externalFollowUpSent: false,
          externalInterviewCancellationSent: false,
        }),
        riskLevel: "high",
      });
    }

    return {
      cancelledFollowUpApprovalIds: cancelledFollowUpApprovals.map((approval) => approval.id),
      cancelledInterviewIds,
      retiredInterviewNotificationIds,
    };
  }

  return await db.transaction(async (tx) => {
    const application = await tx
      .select({ id: applications.id, status: applications.status })
      .from(applications)
      .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
      .limit(1);
    if (!application[0]) throw new Error("Application not found.");
    if (application[0].status !== "offer") {
      throw new Error("Only a recorded offer can be confirmed as accepted.");
    }

    const unsentFollowUps = await tx
      .select({ id: followUps.id })
      .from(followUps)
      .where(and(eq(followUps.applicationId, applicationId), isNull(followUps.sentDate)));
    const unsentFollowUpIds = unsentFollowUps.map((followUp) => followUp.id);
    const cancelledFollowUpApprovals = unsentFollowUpIds.length > 0
      ? await tx
        .select({ id: applicationApprovals.id })
        .from(applicationApprovals)
        .where(and(
          eq(applicationApprovals.userId, userId),
          eq(applicationApprovals.applicationId, applicationId),
          eq(applicationApprovals.entityType, "follow_up"),
          eq(applicationApprovals.approvalType, "follow_up_send"),
          inArray(applicationApprovals.entityId, unsentFollowUpIds),
          inArray(applicationApprovals.status, ["pending", "approved"])
        ))
      : [];
    const cancelledFollowUpApprovalIds = cancelledFollowUpApprovals.map((approval) => approval.id);
    if (cancelledFollowUpApprovalIds.length > 0) {
      await tx
        .update(applicationApprovals)
        .set({
          status: "cancelled",
          decidedBy: "user",
          decisionNote: OFFER_ACCEPTANCE_CANCELLATION_NOTE,
          decidedAt: acceptedAt,
        })
        .where(and(
          inArray(applicationApprovals.id, cancelledFollowUpApprovalIds),
          inArray(applicationApprovals.status, ["pending", "approved"])
        ));
    }

    const scheduledInterviews = await tx
      .select({ id: interviewSchedules.id })
      .from(interviewSchedules)
      .where(and(
        eq(interviewSchedules.applicationId, applicationId),
        inArray(interviewSchedules.status, ["scheduled", "rescheduled"])
      ));
    const cancelledInterviewIds = scheduledInterviews.map((interview) => interview.id);
    if (cancelledInterviewIds.length > 0) {
      await tx
        .update(interviewSchedules)
        .set({ status: "cancelled" })
        .where(and(
          inArray(interviewSchedules.id, cancelledInterviewIds),
          inArray(interviewSchedules.status, ["scheduled", "rescheduled"])
        ));
    }

    const statusUpdate = await tx
      .update(applications)
      .set({ status: "accepted", lastActivity: acceptedAt })
      .where(and(
        eq(applications.id, applicationId),
        eq(applications.userId, userId),
        eq(applications.status, "offer")
      ));
    if (Number(statusUpdate[0].affectedRows) === 0) {
      throw new Error("Application status changed concurrently. Refresh and try again.");
    }

    const unreadInterviewNotifications = await tx
      .select({ id: applicationNotifications.id })
      .from(applicationNotifications)
      .where(and(
        eq(applicationNotifications.applicationId, applicationId),
        eq(applicationNotifications.userId, userId),
        isNull(applicationNotifications.readAt)
      ));
    const retiredInterviewNotificationIds = unreadInterviewNotifications.map((notification) => notification.id);
    if (retiredInterviewNotificationIds.length > 0) {
      await tx
        .update(applicationNotifications)
        .set({ readAt: acceptedAt })
        .where(and(
          inArray(applicationNotifications.id, retiredInterviewNotificationIds),
          isNull(applicationNotifications.readAt)
        ));
      await tx.insert(auditEvents).values({
        userId,
        entityType: "application",
        entityId: applicationId,
        action: "interview_notifications_retired_after_application_closure",
        actor: "user",
        source: "applications.confirmOfferAcceptance",
        afterState: JSON.stringify({ status: "accepted", notificationIds: retiredInterviewNotificationIds }),
        riskLevel: "low",
      });
    }

    if (cancelledFollowUpApprovalIds.length > 0 || cancelledInterviewIds.length > 0) {
      await tx.insert(auditEvents).values({
        userId,
        entityType: "application",
        entityId: applicationId,
        action: "application_actions_retired_after_offer_acceptance",
        actor: "user",
        source: "applications.confirmOfferAcceptance",
        afterState: JSON.stringify({
          status: "accepted",
          cancelledFollowUpApprovalIds,
          cancelledInterviewIds,
          externalFollowUpSent: false,
          externalInterviewCancellationSent: false,
        }),
        riskLevel: "high",
      });
    }

    return { cancelledFollowUpApprovalIds, cancelledInterviewIds, retiredInterviewNotificationIds };
  });
}

export async function markFollowUpSent(followUpId: number, userId: number, deliveryConfirmation?: string) {
  const db = await getDb();
  if (!db) {
    const followUp = await findOwnedMemoryFollowUp(followUpId, userId);
    if (followUp.sentDate) return { success: true };
    const application = await getFollowUpApplication(followUp.applicationId, userId);
    assertFollowUpAllowed(application.status || "pending");

    const approvals = await listUserApplicationApprovalsForApplication(userId, followUp.applicationId);
    const approval = approvals.find((item) =>
      item.entityType === "follow_up" &&
      item.entityId === followUpId &&
      item.approvalType === "follow_up_send"
    );
    if (!approval) {
      throw new Error("Follow-up must be approved before it can be marked sent.");
    }
    if (approval.status !== "approved") {
      throw new Error("Follow-up approval is required before marking it sent.");
    }

    const normalizedConfirmation = normalizeFollowUpDeliveryConfirmation(deliveryConfirmation);
    const sentAt = new Date();
    followUp.sentDate = sentAt;
    followUp.deliveryConfirmation = normalizedConfirmation;
    followUp.deliveryState = "sent";
    followUp.deliveryFailureMessage = null;
    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: followUp.applicationId,
      action: "follow_up_marked_sent",
      actor: "user",
      source: "applications.markFollowUpSent",
      afterState: JSON.stringify({
        followUpId,
        sentAt: sentAt.toISOString(),
        deliveryConfirmation: normalizedConfirmation,
      }),
      riskLevel: "medium",
      approvalId: approval.id,
    });

    return { success: true };
  }

  return await db.transaction(async (tx) => {
    const followUp = await tx
      .select({
        id: followUps.id,
        applicationId: followUps.applicationId,
        sentDate: followUps.sentDate,
        applicationStatus: applications.status,
      })
      .from(followUps)
      .innerJoin(applications, eq(followUps.applicationId, applications.id))
      .where(and(eq(followUps.id, followUpId), eq(applications.userId, userId)))
      .limit(1);
    if (!followUp[0]) throw new Error("Follow-up not found.");
    if (followUp[0].sentDate) return { success: true };
    assertFollowUpAllowed(followUp[0].applicationStatus);

    const approval = await tx
      .select({ id: applicationApprovals.id, status: applicationApprovals.status })
      .from(applicationApprovals)
      .where(and(
        eq(applicationApprovals.userId, userId),
        eq(applicationApprovals.entityType, "follow_up"),
        eq(applicationApprovals.entityId, followUpId),
        eq(applicationApprovals.approvalType, "follow_up_send")
      ))
      .orderBy(desc(applicationApprovals.createdAt))
      .limit(1);
    if (!approval[0]) {
      throw new Error("Follow-up must be approved before it can be marked sent.");
    }
    if (approval[0].status !== "approved") {
      throw new Error("Follow-up approval is required before marking it sent.");
    }

    const normalizedConfirmation = normalizeFollowUpDeliveryConfirmation(deliveryConfirmation);
    const sentAt = new Date();
    await tx
      .update(followUps)
      .set({
        sentDate: sentAt,
        deliveryState: "sent",
        deliveryConfirmation: normalizedConfirmation,
        deliveryFailureMessage: null,
      })
      .where(eq(followUps.id, followUpId));
    await tx
      .update(applications)
      .set({ lastActivity: sentAt })
      .where(and(eq(applications.id, followUp[0].applicationId), eq(applications.userId, userId)));
    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: followUp[0].applicationId,
      action: "follow_up_marked_sent",
      actor: "user",
      source: "applications.markFollowUpSent",
      afterState: JSON.stringify({
        followUpId,
        sentAt: sentAt.toISOString(),
        deliveryConfirmation: normalizedConfirmation,
      }),
      riskLevel: "medium",
      approvalId: approval[0].id,
    });

    return { success: true };
  });
}

export async function markFollowUpResponseReceived(followUpId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const followUp = await findOwnedMemoryFollowUp(followUpId, userId);
    if (!followUp.sentDate) throw new Error("A draft cannot receive a response before it is sent.");
    if (followUp.responseReceived === 1) return { success: true };
    followUp.responseReceived = 1;
    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: followUp.applicationId,
      action: "follow_up_response_marked_received",
      actor: "user",
      source: "applications.markFollowUpResponse",
      afterState: JSON.stringify({ followUpId }),
      riskLevel: "low",
    });
    return { success: true };
  }

  return await db.transaction(async (tx) => {
    const followUp = await tx
      .select({
        applicationId: followUps.applicationId,
        sentDate: followUps.sentDate,
        responseReceived: followUps.responseReceived,
      })
      .from(followUps)
      .innerJoin(applications, eq(followUps.applicationId, applications.id))
      .where(and(eq(followUps.id, followUpId), eq(applications.userId, userId)))
      .limit(1);
    if (!followUp[0]) throw new Error("Follow-up not found.");
    if (!followUp[0].sentDate) throw new Error("A draft cannot receive a response before it is sent.");
    if (followUp[0].responseReceived === 1) return { success: true };

    const receivedAt = new Date();
    await tx.update(followUps).set({ responseReceived: 1 }).where(eq(followUps.id, followUpId));
    await tx
      .update(applications)
      .set({ lastActivity: receivedAt })
      .where(and(eq(applications.id, followUp[0].applicationId), eq(applications.userId, userId)));
    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: followUp[0].applicationId,
      action: "follow_up_response_marked_received",
      actor: "user",
      source: "applications.markFollowUpResponse",
      afterState: JSON.stringify({ followUpId, receivedAt: receivedAt.toISOString() }),
      riskLevel: "low",
    });

    return { success: true };
  });
}

// AI-Generated Follow-Up Email
export async function generateFollowUpEmail(
  applicationId: number,
  followUpType: "initial" | "reminder" | "thank_you" | "status_check",
  userId: number
): Promise<string> {
  const db = await getDb();
  if (!db) {
    const application = await getFollowUpApplication(applicationId, userId);
    assertFollowUpAllowed(application.status || "pending");
    const job = await getJobById(application.jobId);
    const title = job?.title || "the role";
    const company = job?.company || "the company";
    const intro = followUpType === "thank_you"
      ? `Thank you again for taking the time to discuss the ${title} opportunity at ${company}.`
      : `I wanted to follow up on my application for the ${title} role at ${company}.`;
    return sanitizeFollowUpMessage([
      "Hello,",
      "",
      intro,
      "I remain interested in the opportunity and would appreciate any update you can share on the process.",
      "",
      "Best regards,",
    ].join("\n"));
  }

  // Get application and job details
  const appResult = await db
    .select({
      application: applications,
      job: jobs,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);

  if (appResult.length === 0) {
    throw new Error("Application not found");
  }

  const { application, job } = appResult[0];
  if (!["applied", "viewed", "interview"].includes(application.status)) {
    throw new Error("Follow-ups can only be generated after an application has been submitted.");
  }

  const prompts: Record<string, string> = {
    initial: `Write a professional follow-up email for a job application. The candidate applied for ${job.title} at ${job.company}. This is the initial follow-up after submitting the application. Keep it brief, professional, and express continued interest.`,
    reminder: `Write a polite reminder email for a job application. The candidate applied for ${job.title} at ${job.company} and hasn't heard back. Keep it professional and not pushy.`,
    thank_you: `Write a thank-you email after an interview for the ${job.title} position at ${job.company}. Express gratitude and reiterate interest. Do not invent conversation details; use neutral wording because no interview notes were provided.`,
    status_check: `Write a professional email to check on the status of a job application for ${job.title} at ${job.company}. Be polite and express continued interest.`,
  };

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You are a professional career coach helping job seekers write concise follow-up emails. Never invent names, events, conversation details, qualifications, or contact information that were not provided.",
      },
      {
        role: "user",
        content: prompts[followUpType] || prompts.initial,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Unable to generate a follow-up draft.");
  }
  return sanitizeFollowUpMessage(content);
}

export async function generateEmployerReplyEmail(
  applicationId: number,
  userId: number,
  responseId?: number
): Promise<{ email: string; responseId: number }> {
  const application = await getFollowUpApplication(applicationId, userId);
  assertFollowUpAllowed(application.status || "pending");
  const response = await getEmployerResponseForReply(applicationId, userId, responseId);
  const job = application.job || await getJobById(application.jobId);
  const title = job?.title || "the role";
  const company = job?.company || "the company";
  const responseContext = response.summary.length > 700
    ? `${response.summary.slice(0, 697)}...`
    : response.summary;

  const email = sanitizeFollowUpMessage([
    "Hello,",
    "",
    `Thank you for reaching out about the ${title} role at ${company}.`,
    "",
    `I saw your note: "${responseContext}"`,
    "",
    "[Add your exact answer here. Keep availability, eligibility, salary, and experience claims aligned with your resume and profile evidence.]",
    "",
    "Please let me know if there is anything else I can clarify.",
    "",
    "Best regards,",
  ].join("\n"));

  return { email, responseId: response.id };
}

// ==================== JOB ALERTS ====================

export interface CreateAlertInput {
  userId: number;
  name: string;
  keywords?: string;
  locations?: string;
  platforms?: string;
  minSalary?: number;
  jobTypes?: string;
  frequency: "instant" | "daily" | "weekly";
}

const memoryJobAlerts: JobAlertConfig[] = [];

function nextMemoryJobAlertId() {
  return (memoryJobAlerts.reduce((max, alert) => Math.max(max, alert.id), 0) || 0) + 1;
}

function isJobAlertDue(alert: Pick<JobAlertConfig, "frequency" | "lastTriggered">, now = new Date()) {
  if (!alert.lastTriggered) return true;

  const hoursSince = (now.getTime() - new Date(alert.lastTriggered).getTime()) / (1000 * 60 * 60);
  switch (alert.frequency) {
    case "instant":
      return hoursSince >= 1;
    case "daily":
      return hoursSince >= 24;
    case "weekly":
      return hoursSince >= 168;
  }
}

export async function createJobAlert(input: CreateAlertInput) {
  const db = await getDb();
  if (!db) {
    const now = new Date();
    const alert: JobAlertConfig = {
      id: nextMemoryJobAlertId(),
      userId: input.userId,
      name: input.name,
      keywords: input.keywords || null,
      locations: input.locations || null,
      platforms: input.platforms || null,
      minSalary: input.minSalary || null,
      jobTypes: input.jobTypes || null,
      frequency: input.frequency,
      isActive: 1,
      lastTriggered: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryJobAlerts.push(alert);
    return { id: alert.id };
  }

  const result = await db.insert(jobAlerts).values({
    userId: input.userId,
    name: input.name,
    keywords: input.keywords || null,
    locations: input.locations || null,
    platforms: input.platforms || null,
    minSalary: input.minSalary || null,
    jobTypes: input.jobTypes || null,
    frequency: input.frequency,
    isActive: 1,
  });

  return { id: Number(result[0].insertId) };
}

export async function getJobAlerts(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryJobAlerts
      .filter((alert) => alert.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((alert) => ({ ...alert }));
  }

  return await db
    .select()
    .from(jobAlerts)
    .where(eq(jobAlerts.userId, userId))
    .orderBy(desc(jobAlerts.createdAt));
}

export async function getJobAlertPage(
  userId: number,
  options: {
    limit?: number;
    cursor?: { createdAt: Date; id: number };
  } = {}
) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
  const db = await getDb();
  if (!db) {
    const rows = memoryJobAlerts
      .filter((alert) => alert.userId === userId)
      .filter((alert) => !options.cursor || (
        alert.createdAt < options.cursor.createdAt ||
        (alert.createdAt.getTime() === options.cursor.createdAt.getTime() && alert.id < options.cursor.id)
      ))
      .sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id
      )
      .slice(0, limit + 1)
      .map((alert) => ({ ...alert }));
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  const cursorCondition = options.cursor ? or(
    lt(jobAlerts.createdAt, options.cursor.createdAt),
    and(eq(jobAlerts.createdAt, options.cursor.createdAt), lt(jobAlerts.id, options.cursor.id))
  ) : undefined;
  const rows = await db
    .select()
    .from(jobAlerts)
    .where(and(eq(jobAlerts.userId, userId), cursorCondition))
    .orderBy(desc(jobAlerts.createdAt), desc(jobAlerts.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export async function updateJobAlert(
  userId: number,
  alertId: number,
  updates: Partial<Omit<CreateAlertInput, "userId">>
) {
  const db = await getDb();
  if (!db) {
    const alert = memoryJobAlerts.find((item) => item.id === alertId && item.userId === userId);
    if (!alert) return { success: true };
    Object.assign(alert, Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)));
    alert.updatedAt = new Date();
    return { success: true };
  }

  await db
    .update(jobAlerts)
    .set(updates)
    .where(and(eq(jobAlerts.id, alertId), eq(jobAlerts.userId, userId)));

  return { success: true };
}

export async function toggleJobAlert(userId: number, alertId: number, isActive: boolean) {
  const db = await getDb();
  if (!db) {
    const alert = memoryJobAlerts.find((item) => item.id === alertId && item.userId === userId);
    if (alert) {
      alert.isActive = isActive ? 1 : 0;
      alert.updatedAt = new Date();
    }
    return { success: true };
  }

  await db
    .update(jobAlerts)
    .set({ isActive: isActive ? 1 : 0 })
    .where(and(eq(jobAlerts.id, alertId), eq(jobAlerts.userId, userId)));

  return { success: true };
}

export async function deleteJobAlert(userId: number, alertId: number) {
  const db = await getDb();
  if (!db) {
    const index = memoryJobAlerts.findIndex((item) => item.id === alertId && item.userId === userId);
    if (index >= 0) memoryJobAlerts.splice(index, 1);
    return { success: true };
  }

  await db.delete(jobAlerts).where(and(eq(jobAlerts.id, alertId), eq(jobAlerts.userId, userId)));
  return { success: true };
}

// Refresh job alerts without interrupting job seekers for ordinary job matches.
export async function processJobAlerts() {
  const db = await getDb();
  if (!db) {
    const { sampleJobDuplicateLinks, sampleJobs, samplePlatforms } = await import("./sampleData");
    const now = new Date();
    const duplicateJobIds = new Set(sampleJobDuplicateLinks.map((link) => link.duplicateJobId));
    const platformNamesById = new Map(samplePlatforms.map((platform) => [platform.id, platform.name]));
    const currentCanonicalJobs = sampleJobs.filter((job) =>
      !duplicateJobIds.has(job.id) && isJobListingCurrent(job, now)
    );
    let processed = 0;

    for (const alert of memoryJobAlerts.filter((item) => item.isActive === 1 && isJobAlertDue(item, now))) {
      const hasMatch = currentCanonicalJobs.some((job) => matchesJobAlert({
        ...job,
        platformName: platformNamesById.get(job.platformId),
      }, alert));
      if (!hasMatch) continue;

      alert.lastTriggered = now;
      alert.updatedAt = now;
      processed++;
    }

    return { processed, externalNotifications: 0 as const };
  }

  const now = new Date();
  const instantCutoff = new Date(now.getTime() - 60 * 60 * 1000);
  const dailyCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weeklyCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const alerts = await db
    .select()
    .from(jobAlerts)
    .where(and(
      eq(jobAlerts.isActive, 1),
      or(
        isNull(jobAlerts.lastTriggered),
        and(eq(jobAlerts.frequency, "instant"), lte(jobAlerts.lastTriggered, instantCutoff)),
        and(eq(jobAlerts.frequency, "daily"), lte(jobAlerts.lastTriggered, dailyCutoff)),
        and(eq(jobAlerts.frequency, "weekly"), lte(jobAlerts.lastTriggered, weeklyCutoff))
      )
    ));
  if (alerts.length === 0) {
    return { processed: 0, externalNotifications: 0 as const };
  }

  const jobPageSize = 250;
  const selectJobPage = (afterId: number) => db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      description: jobs.description,
      requirements: jobs.requirements,
      responsibilities: jobs.responsibilities,
      benefits: jobs.benefits,
      skills: jobs.skills,
      location: jobs.location,
      platformId: jobs.platformId,
      jobType: jobs.jobType,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      isActive: jobs.isActive,
      expiryDate: jobs.expiryDate,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(and(
      eq(jobs.isActive, 1),
      gt(jobs.id, afterId),
      sql`NOT EXISTS (
        SELECT 1 FROM ${jobDuplicates}
        WHERE ${jobDuplicates.duplicateJobId} = ${jobs.id}
      )`,
    ))
    .orderBy(asc(jobs.id))
    .limit(jobPageSize);
  let [activeJobs, platforms] = await Promise.all([
    selectJobPage(0),
    db.select({ id: jobPlatforms.id, name: jobPlatforms.name }).from(jobPlatforms),
  ]);
  const platformNamesById = new Map(platforms.map((platform) => [platform.id, platform.name]));
  const unmatchedAlerts = new Map(alerts.map((alert) => [alert.id, alert]));
  const matchedAlertIds: number[] = [];

  while (activeJobs.length > 0 && unmatchedAlerts.size > 0) {
    for (const job of activeJobs) {
      if (!isJobListingCurrent(job, now)) continue;
      for (const [alertId, alert] of Array.from(unmatchedAlerts.entries())) {
        if (matchesJobAlert({
          ...job,
          platformName: platformNamesById.get(job.platformId),
        }, {
          keywords: alert.keywords,
          locations: alert.locations,
          platforms: alert.platforms,
          minSalary: alert.minSalary,
          jobTypes: alert.jobTypes,
        })) {
          matchedAlertIds.push(alertId);
          unmatchedAlerts.delete(alertId);
        }
      }
    }

    if (activeJobs.length < jobPageSize || unmatchedAlerts.size === 0) break;
    activeJobs = await selectJobPage(activeJobs[activeJobs.length - 1].id);
  }

  if (matchedAlertIds.length > 0) {
    // Matching jobs remain available in the command center. External alerts are
    // reserved for deterministic interview-invite evidence.
    await db
      .update(jobAlerts)
      .set({ lastTriggered: now })
      .where(inArray(jobAlerts.id, matchedAlertIds));
  }

  return { processed: matchedAlertIds.length, externalNotifications: 0 as const };
}

// ==================== INTERVIEW PREPARATION ====================

export async function generateInterviewQuestions(jobId: number): Promise<{
  behavioral: string[];
  technical: string[];
  situational: string[];
  questions_to_ask: string[];
}> {
  const job = await getJobById(jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You are an expert interview coach. Generate comprehensive interview preparation questions.",
      },
      {
        role: "user",
        content: `Generate interview questions for a ${job.title} position at ${job.company}. 
        
Job Description: ${job.description || "Not available"}
Required Skills: ${job.skills || "Not specified"}

Provide questions in these categories:
1. Behavioral questions (5)
2. Technical questions (5)
3. Situational questions (3)
4. Questions the candidate should ask (3)

Format as JSON with keys: behavioral, technical, situational, questions_to_ask (each an array of strings)`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "interview_questions",
        strict: true,
        schema: {
          type: "object",
          properties: {
            behavioral: {
              type: "array",
              items: { type: "string" },
            },
            technical: {
              type: "array",
              items: { type: "string" },
            },
            situational: {
              type: "array",
              items: { type: "string" },
            },
            questions_to_ask: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["behavioral", "technical", "situational", "questions_to_ask"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (typeof content === "string") {
    return JSON.parse(content);
  }

  return {
    behavioral: [],
    technical: [],
    situational: [],
    questions_to_ask: [],
  };
}

// Mock interview simulation
export async function conductMockInterview(
  jobId: number,
  userResponse: string,
  questionIndex: number
): Promise<{
  feedback: string;
  score: number;
  suggestions: string[];
  nextQuestion?: string;
}> {
  const job = await getJobById(jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an expert interviewer conducting a mock interview for a ${job.title} position. Evaluate the candidate's response and provide constructive feedback.`,
      },
      {
        role: "user",
        content: `The candidate's response to interview question ${questionIndex + 1}:

"${userResponse}"

Evaluate this response and provide:
1. Detailed feedback on the response
2. A score from 1-10
3. 2-3 specific suggestions for improvement
4. A follow-up question if appropriate

Format as JSON with keys: feedback, score, suggestions (array), nextQuestion (optional string)`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "interview_feedback",
        strict: true,
        schema: {
          type: "object",
          properties: {
            feedback: { type: "string" },
            score: { type: "number" },
            suggestions: {
              type: "array",
              items: { type: "string" },
            },
            nextQuestion: { type: "string" },
          },
          required: ["feedback", "score", "suggestions"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (typeof content === "string") {
    return JSON.parse(content);
  }

  return {
    feedback: "Unable to evaluate response",
    score: 5,
    suggestions: ["Try to be more specific", "Use the STAR method"],
  };
}

// Video interview tips
export async function getVideoInterviewTips(jobTitle: string): Promise<{
  technical_setup: string[];
  presentation: string[];
  common_mistakes: string[];
  platform_specific: Record<string, string[]>;
}> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You are an expert career coach specializing in video interviews.",
      },
      {
        role: "user",
        content: `Provide comprehensive video interview tips for a ${jobTitle} position.

Include:
1. Technical setup tips (5)
2. Presentation/appearance tips (5)
3. Common mistakes to avoid (5)
4. Platform-specific tips for Zoom, Teams, and Google Meet (3 each)

Format as JSON with keys: technical_setup, presentation, common_mistakes, platform_specific (object with zoom, teams, google_meet arrays)`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "video_interview_tips",
        strict: true,
        schema: {
          type: "object",
          properties: {
            technical_setup: {
              type: "array",
              items: { type: "string" },
            },
            presentation: {
              type: "array",
              items: { type: "string" },
            },
            common_mistakes: {
              type: "array",
              items: { type: "string" },
            },
            platform_specific: {
              type: "object",
              properties: {
                zoom: { type: "array", items: { type: "string" } },
                teams: { type: "array", items: { type: "string" } },
                google_meet: { type: "array", items: { type: "string" } },
              },
              required: ["zoom", "teams", "google_meet"],
              additionalProperties: false,
            },
          },
          required: ["technical_setup", "presentation", "common_mistakes", "platform_specific"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (typeof content === "string") {
    return JSON.parse(content);
  }

  return {
    technical_setup: [],
    presentation: [],
    common_mistakes: [],
    platform_specific: { zoom: [], teams: [], google_meet: [] },
  };
}

export async function generateInterviewQuestionsForApplication(applicationId: number, userId: number) {
  const { application } = await getOwnedUpcomingInterviewContext(applicationId, userId);
  return await generateInterviewQuestions(application.jobId);
}

export async function conductMockInterviewForApplication(
  applicationId: number,
  userResponse: string,
  questionIndex: number,
  userId: number
) {
  const { application } = await getOwnedUpcomingInterviewContext(applicationId, userId);
  return await conductMockInterview(application.jobId, userResponse, questionIndex);
}

export async function getVideoInterviewTipsForApplication(applicationId: number, userId: number) {
  const { application } = await getOwnedUpcomingInterviewContext(applicationId, userId);
  const job = await getJobById(application.jobId);
  if (!job) {
    throw new Error("Job not found.");
  }
  return await getVideoInterviewTips(job.title);
}
