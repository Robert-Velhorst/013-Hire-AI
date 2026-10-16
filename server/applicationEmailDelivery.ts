import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { hasExplicitRemoteWorkSignal, hasNonRemoteWorkSignal } from "../shared/remoteEligibility";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "../shared/documentUploads";
import {
  applicationApprovals,
  applicationAttempts,
  applicationEmailDeliveries,
  applicationMaterials,
  applications,
  users,
  auditEvents,
  jobs,
  userResumes,
} from "../drizzle/schema";
import { isJobCurrentForAutonomousProcessing } from "./autonomousOrchestrator";
import { getDb } from "./db";
import {
  FollowUpProviderRejectionError,
  getAuthorizedMailAccess,
  markAuthorizedMailAccessNeedsReauth,
  normalizeFollowUpRecipient,
  sendFollowUpProviderMessage,
  type FollowUpMailProvider,
} from "./followUpMailDelivery";
import {
  outboundRequestSignal,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseBytes,
} from "./_core/outboundRequest";
import { storageGet } from "./storage";

const RESUME_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/rtf",
  "application/rtf",
]);
const MAX_MESSAGE_CHARS = 50_000;
const STALE_SENDING_OUTCOME_MS = 5 * 60 * 1000;
const GENERIC_DELIVERY_FAILURE = "The application email could not be delivered.";
const GENERIC_UNCERTAIN_OUTCOME = "The email outcome is uncertain. Do not retry until the mailbox has been checked.";

export class ApplicationEmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationEmailDeliveryError";
  }
}

type ApplicationBundle = {
  application: typeof applications.$inferSelect;
  job: typeof jobs.$inferSelect;
  material: typeof applicationMaterials.$inferSelect;
  resume: typeof userResumes.$inferSelect;
};

type ResumeSnapshot = {
  bytes: Uint8Array;
  sha256: string;
};

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function buildSnapshotHash(input: {
  provider: FollowUpMailProvider;
  recipient: string;
  subject: string;
  message: string;
  resumeId: number;
  resumeVersion: number;
  resumeFileKey: string;
  resumeFileName: string;
  resumeMimeType: string;
  resumeSize: number;
  resumeSha256: string;
}) {
  return sha256(JSON.stringify([
    input.provider,
    input.recipient,
    input.subject,
    input.message,
    input.resumeId,
    input.resumeVersion,
    input.resumeFileKey,
    input.resumeFileName,
    input.resumeMimeType,
    input.resumeSize,
    input.resumeSha256,
  ]));
}

export function isEligibleEmailApplicationJob(job: typeof jobs.$inferSelect, now = new Date()) {
  const listingText = [
    job.location,
    job.title,
    job.description,
    job.requirements,
    job.responsibilities,
  ];
  return isJobCurrentForAutonomousProcessing(job, now) &&
    hasExplicitRemoteWorkSignal(...listingText) &&
    !hasNonRemoteWorkSignal(...listingText);
}

export type ApplicationEmailEligibilityReason =
  | "application_not_found"
  | "application_not_pending"
  | "listing_not_current"
  | "not_fully_remote"
  | "missing_application_email"
  | "invalid_application_email"
  | "storage_unavailable";

export function getApplicationEmailEligibility(
  applicationStatus: string,
  job: typeof jobs.$inferSelect | null,
  now = new Date(),
) {
  if (!job) return { eligible: false, reason: "application_not_found" as const };
  if (applicationStatus !== "pending") return { eligible: false, reason: "application_not_pending" as const };
  if (!isJobCurrentForAutonomousProcessing(job, now)) return { eligible: false, reason: "listing_not_current" as const };
  const listingText = [job.location, job.title, job.description, job.requirements, job.responsibilities];
  if (!hasExplicitRemoteWorkSignal(...listingText) || hasNonRemoteWorkSignal(...listingText)) {
    return { eligible: false, reason: "not_fully_remote" as const };
  }
  if (!job.applicationEmail?.trim()) return { eligible: false, reason: "missing_application_email" as const };
  try {
    normalizeFollowUpRecipient(job.applicationEmail);
  } catch {
    return { eligible: false, reason: "invalid_application_email" as const };
  }
  return { eligible: true, reason: null } as const;
}

export async function getApplicationEmailSubmissionEligibility(userId: number, applicationId: number) {
  const db = await getDb();
  if (!db) return { eligible: false, reason: "storage_unavailable" as const };
  const rows = await db.select({ status: applications.status, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);
  const application = rows[0];
  return getApplicationEmailEligibility(application?.status ?? "missing", application?.job ?? null);
}

function assertEligibleJob(job: typeof jobs.$inferSelect, now = new Date()) {
  if (!isEligibleEmailApplicationJob(job, now)) {
    throw new ApplicationEmailDeliveryError("Only a current listing with clearly verified fully remote eligibility can use email submission.");
  }
  return normalizeFollowUpRecipient(job.applicationEmail || "");
}

async function loadApplicationBundle(userId: number, applicationId: number): Promise<ApplicationBundle> {
  const db = await getDb();
  if (!db) throw new ApplicationEmailDeliveryError("Application email delivery requires durable database storage.");
  const rows = await db
    .select({ application: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ApplicationEmailDeliveryError("Application not found.");
  const materials = await db
    .select()
    .from(applicationMaterials)
    .where(eq(applicationMaterials.applicationId, applicationId))
    .limit(1);
  const material = materials[0];
  if (!material?.resumeId) throw new ApplicationEmailDeliveryError("A versioned resume must be attached to the application before email submission.");
  const resumes = await db
    .select()
    .from(userResumes)
    .where(and(eq(userResumes.id, material.resumeId), eq(userResumes.userId, userId)))
    .limit(1);
  const resume = resumes[0];
  if (!resume) throw new ApplicationEmailDeliveryError("The application resume is unavailable or does not belong to this account.");
  return { ...row, material, resume };
}

async function downloadResumeSnapshot(fileKey: string, expectedSize: number): Promise<ResumeSnapshot> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_DOCUMENT_UPLOAD_BYTES) {
    throw new ApplicationEmailDeliveryError("The resume exceeds the supported attachment size.");
  }
  const { url } = await storageGet(fileKey);
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") throw new ApplicationEmailDeliveryError("Resume storage returned an insecure download address.");
  const response = await fetch(url, {
    signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApplicationEmailDeliveryError("The stored resume could not be retrieved.");
  }
  const bytes = await readBoundedResponseBytes(response, MAX_DOCUMENT_UPLOAD_BYTES);
  if (bytes.byteLength !== expectedSize) throw new ApplicationEmailDeliveryError("The stored resume changed size; prepare the application again.");
  return { bytes, sha256: sha256(bytes) };
}

function assertResumeIsAttachable(resume: typeof userResumes.$inferSelect) {
  if (!RESUME_MIME_TYPES.has(resume.mimeType)) throw new ApplicationEmailDeliveryError("This resume file type cannot be sent as an application attachment.");
  if (!resume.fileName || /[\r\n\0]/.test(resume.fileName)) throw new ApplicationEmailDeliveryError("The resume filename is not safe to attach.");
  if (!Number.isSafeInteger(resume.fileSize) || resume.fileSize < 1 || resume.fileSize > MAX_DOCUMENT_UPLOAD_BYTES) {
    throw new ApplicationEmailDeliveryError("The resume exceeds the supported attachment size.");
  }
}

async function readDelivery(userId: number, applicationId: number) {
  const db = await getDb();
  if (!db) throw new ApplicationEmailDeliveryError("Application email delivery requires durable database storage.");
  const rows = await db
    .select()
    .from(applicationEmailDeliveries)
    .where(and(
      eq(applicationEmailDeliveries.userId, userId),
      eq(applicationEmailDeliveries.applicationId, applicationId)
    ))
    .limit(1);
  return rows[0] ?? null;
}

function toDeliveryView(row: typeof applicationEmailDeliveries.$inferSelect | null) {
  if (!row) return null;
  return {
    id: row.id,
    applicationId: row.applicationId,
    provider: row.provider,
    status: row.status,
    recipient: row.recipient,
    subject: row.subject,
    message: row.message,
    resumeFileName: row.resumeFileName,
    resumeSize: row.resumeSize,
    attemptCount: row.attemptCount,
    providerMessageId: row.providerMessageId,
    failureMessage: row.failureMessage,
    approvedAt: row.approvedAt,
    sentAt: row.sentAt,
    updatedAt: row.updatedAt,
  };
}

export async function getApplicationEmailSubmission(userId: number, applicationId: number) {
  const delivery = await readDelivery(userId, applicationId);
  if (!delivery || delivery.status !== "sending" || !isStaleApplicationEmailSending(delivery.updatedAt)) {
    return toDeliveryView(delivery);
  }

  const db = await getDb();
  if (!db) throw new ApplicationEmailDeliveryError("Application email delivery requires durable database storage.");
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(applicationEmailDeliveries)
      .where(and(
        eq(applicationEmailDeliveries.id, delivery.id),
        eq(applicationEmailDeliveries.userId, userId),
        eq(applicationEmailDeliveries.applicationId, applicationId),
        eq(applicationEmailDeliveries.status, "sending")
      ))
      .limit(1)
      .for("update");
    const current = rows[0];
    const now = new Date();
    if (!current || !isStaleApplicationEmailSending(current.updatedAt, now)) return;

    const cutoff = new Date(now.getTime() - STALE_SENDING_OUTCOME_MS);
    const updated = await tx.update(applicationEmailDeliveries).set({
      status: "unknown",
      failureMessage: GENERIC_UNCERTAIN_OUTCOME,
      updatedAt: now,
    }).where(and(
      eq(applicationEmailDeliveries.id, current.id),
      eq(applicationEmailDeliveries.status, "sending"),
      lte(applicationEmailDeliveries.updatedAt, cutoff)
    ));
    if (Number(updated[0].affectedRows) !== 1) return;

    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: applicationId,
      action: "application_email_stale_send_marked_unknown",
      actor: "system",
      source: "applications.getEmailSubmission",
      afterState: JSON.stringify({ attemptKey: current.attemptKey, externalMessageSent: "unknown", retryBlocked: true }),
      riskLevel: "high",
    });
  });
  return toDeliveryView(await readDelivery(userId, applicationId));
}

export function isStaleApplicationEmailSending(updatedAt: Date, now = new Date()) {
  return now.getTime() - updatedAt.getTime() >= STALE_SENDING_OUTCOME_MS;
}

export async function prepareApplicationEmailSubmission(
  userId: number,
  applicationId: number,
  provider: FollowUpMailProvider
) {
  const bundle = await loadApplicationBundle(userId, applicationId);
  if (bundle.application.status !== "pending") throw new ApplicationEmailDeliveryError("Only a pending application can be submitted by email.");
  const recipient = assertEligibleJob(bundle.job);
  assertResumeIsAttachable(bundle.resume);
  const message = (bundle.material.coverLetter || "").trim();
  if (!message || message.length > MAX_MESSAGE_CHARS) throw new ApplicationEmailDeliveryError("A complete cover letter is required before email submission.");
  const subject = normalizeHeader(`Application: ${bundle.job.title} at ${bundle.job.company}`).slice(0, 500);
  const resume = await downloadResumeSnapshot(bundle.resume.fileKey, bundle.resume.fileSize);
  const snapshot = {
    provider,
    recipient,
    subject,
    message,
    resumeId: bundle.resume.id,
    resumeVersion: bundle.resume.version ?? 1,
    resumeFileKey: bundle.resume.fileKey,
    resumeFileName: bundle.resume.fileName,
    resumeMimeType: bundle.resume.mimeType,
    resumeSize: resume.bytes.byteLength,
    resumeSha256: resume.sha256,
  };
  const snapshotHash = buildSnapshotHash(snapshot);
  const db = await getDb();
  if (!db) throw new ApplicationEmailDeliveryError("Application email delivery requires durable database storage.");

  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    await tx.select({ id: applications.id }).from(applications)
      .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
      .for("update");
    const current = await tx.select().from(applications)
      .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
      .limit(1);
    if (!current[0] || current[0].status !== "pending" || current[0].jobId !== bundle.job.id) {
      throw new ApplicationEmailDeliveryError("Application state changed. Refresh it before preparing an email submission.");
    }
    const currentResume = await tx.select({ id: userResumes.id })
      .from(userResumes)
      .where(and(
        eq(userResumes.id, bundle.resume.id),
        eq(userResumes.userId, userId),
        eq(userResumes.fileKey, bundle.resume.fileKey)
      ))
      .limit(1);
    if (!currentResume[0]) throw new ApplicationEmailDeliveryError("The resume was deleted while the email draft was being prepared.");
    const existingRows = await tx.select().from(applicationEmailDeliveries)
      .where(and(
        eq(applicationEmailDeliveries.userId, userId),
        eq(applicationEmailDeliveries.applicationId, applicationId)
      ))
      .limit(1)
      .for("update");
    const existing = existingRows[0];
    if (existing && ["ready", "sending", "sent", "unknown"].includes(existing.status)) {
      throw new ApplicationEmailDeliveryError("This application email is already approved, in progress, sent, or awaiting outcome review.");
    }
    if (existing?.status === "pending_approval") return;
    const values = {
      userId,
      applicationId,
      ...snapshot,
      messageSha256: snapshotHash,
      status: "draft" as const,
      attemptKey: null,
      providerMessageId: null,
      failureMessage: null,
      attemptCount: 0,
      approvedAt: null,
      sentAt: null,
    };
    if (existing) {
      await tx.update(applicationEmailDeliveries).set(values)
        .where(and(eq(applicationEmailDeliveries.id, existing.id), eq(applicationEmailDeliveries.status, existing.status)));
    } else {
      await tx.insert(applicationEmailDeliveries).values(values);
    }
    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: applicationId,
      action: "application_email_draft_prepared",
      actor: "user",
      source: "applications.prepareEmailSubmission",
      afterState: JSON.stringify({ provider, recipient, resumeVersion: bundle.resume.version, resumeSha256: resume.sha256, externalMessageSent: false }),
      riskLevel: "medium",
    });
  });
  return await getApplicationEmailSubmission(userId, applicationId);
}

export async function updateApplicationEmailSubmissionDraft(
  userId: number,
  applicationId: number,
  input: { subject: string; message: string }
) {
  const subject = normalizeHeader(input.subject);
  const message = input.message.trim();
  if (!subject || subject.length > 500) throw new ApplicationEmailDeliveryError("Enter an email subject of at most 500 characters.");
  if (!message || message.length > MAX_MESSAGE_CHARS) throw new ApplicationEmailDeliveryError("Enter a message of at most 50,000 characters.");
  const db = await getDb();
  if (!db) throw new ApplicationEmailDeliveryError("Application email delivery requires durable database storage.");
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const rows = await tx.select().from(applicationEmailDeliveries)
      .where(and(
        eq(applicationEmailDeliveries.userId, userId),
        eq(applicationEmailDeliveries.applicationId, applicationId)
      ))
      .limit(1)
      .for("update");
    const delivery = rows[0];
    if (!delivery || delivery.status !== "draft") throw new ApplicationEmailDeliveryError("Only an unapproved email draft can be edited.");
    const next = { ...delivery, subject, message };
    const messageSha256 = buildSnapshotHash(next);
    await tx.update(applicationEmailDeliveries)
      .set({ subject, message, messageSha256 })
      .where(and(eq(applicationEmailDeliveries.id, delivery.id), eq(applicationEmailDeliveries.status, "draft")));
    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: applicationId,
      action: "application_email_draft_updated",
      actor: "user",
      source: "applications.updateEmailSubmissionDraft",
      afterState: JSON.stringify({ subjectSha256: sha256(subject), messageSha256: sha256(message), externalMessageSent: false }),
      riskLevel: "medium",
    });
  });
  return await getApplicationEmailSubmission(userId, applicationId);
}

function approvalPayload(delivery: typeof applicationEmailDeliveries.$inferSelect) {
  return JSON.stringify({
    version: 1,
    provider: delivery.provider,
    recipient: delivery.recipient,
    subjectSha256: sha256(delivery.subject),
    messageSha256: sha256(delivery.message),
    resumeId: delivery.resumeId,
    resumeVersion: delivery.resumeVersion,
    resumeFileName: delivery.resumeFileName,
    resumeMimeType: delivery.resumeMimeType,
    resumeSize: delivery.resumeSize,
    resumeSha256: delivery.resumeSha256,
    snapshotHash: delivery.messageSha256,
  });
}

export async function requestApplicationEmailApproval(userId: number, applicationId: number) {
  const db = await getDb();
  if (!db) throw new ApplicationEmailDeliveryError("Application email delivery requires durable database storage.");
  return await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const rows = await tx.select().from(applicationEmailDeliveries)
      .where(and(
        eq(applicationEmailDeliveries.userId, userId),
        eq(applicationEmailDeliveries.applicationId, applicationId)
      ))
      .limit(1)
      .for("update");
    const delivery = rows[0];
    if (!delivery || delivery.status !== "draft") throw new ApplicationEmailDeliveryError("Only an editable email draft can be submitted for approval.");
    if (delivery.messageSha256 !== buildSnapshotHash(delivery)) throw new ApplicationEmailDeliveryError("The draft changed unexpectedly. Prepare it again before requesting approval.");
    const applicationRows = await tx.select({ application: applications, job: jobs })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
      .limit(1);
    const application = applicationRows[0];
    if (!application || application.application.status !== "pending") throw new ApplicationEmailDeliveryError("Application is no longer pending.");
    const listedRecipient = assertEligibleJob(application.job);
    if (delivery.recipient !== listedRecipient) throw new ApplicationEmailDeliveryError("The job's listed email changed. Prepare the application again.");
    const payload = approvalPayload(delivery);
    await tx.insert(applicationApprovals).values({
      userId,
      applicationId,
      entityType: "application",
      entityId: applicationId,
      approvalType: "application_email_submission",
      status: "pending",
      riskLevel: "high",
      requestedBy: "user",
      title: "Send approved application email",
      description: `Review the message for ${delivery.recipient}. The address is taken from the job listing and is not independently verified.`,
      payload,
    }).onDuplicateKeyUpdate({
      set: {
        id: sql`LAST_INSERT_ID(id)`,
        applicationId,
        riskLevel: "high",
        requestedBy: "user",
        title: "Send approved application email",
        description: `Review the message for ${delivery.recipient}. The address is taken from the job listing and is not independently verified.`,
        payload,
        updatedAt: new Date(),
      },
    });
    const approvalRows = await tx.select({ id: applicationApprovals.id })
      .from(applicationApprovals)
      .where(and(
        eq(applicationApprovals.userId, userId),
        eq(applicationApprovals.entityType, "application"),
        eq(applicationApprovals.entityId, applicationId),
        eq(applicationApprovals.approvalType, "application_email_submission"),
        eq(applicationApprovals.status, "pending")
      ))
      .orderBy(desc(applicationApprovals.id))
      .limit(1);
    const approvalId = approvalRows[0]?.id;
    if (!approvalId) throw new ApplicationEmailDeliveryError("Could not create the application email approval.");
    await tx.update(applicationEmailDeliveries)
      .set({ status: "pending_approval", failureMessage: null })
      .where(and(eq(applicationEmailDeliveries.id, delivery.id), eq(applicationEmailDeliveries.status, "draft")));
    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: applicationId,
      action: "application_email_approval_requested",
      actor: "user",
      source: "applications.requestEmailSubmissionApproval",
      afterState: JSON.stringify({ approvalId, provider: delivery.provider, recipient: delivery.recipient, externalMessageSent: false }),
      riskLevel: "high",
      approvalId,
    });
    return { approvalId, status: "pending_approval" as const };
  });
}

function matchesApprovalSnapshot(delivery: typeof applicationEmailDeliveries.$inferSelect, approval: typeof applicationApprovals.$inferSelect) {
  try {
    const payload = approval.payload ? JSON.parse(approval.payload) : null;
    return payload?.version === 1 &&
      payload.provider === delivery.provider &&
      payload.recipient === delivery.recipient &&
      payload.subjectSha256 === sha256(delivery.subject) &&
      payload.messageSha256 === sha256(delivery.message) &&
      payload.resumeId === delivery.resumeId &&
      payload.resumeVersion === delivery.resumeVersion &&
      payload.resumeFileName === delivery.resumeFileName &&
      payload.resumeMimeType === delivery.resumeMimeType &&
      payload.resumeSize === delivery.resumeSize &&
      payload.resumeSha256 === delivery.resumeSha256 &&
      payload.snapshotHash === delivery.messageSha256 &&
      delivery.messageSha256 === buildSnapshotHash(delivery);
  } catch {
    return false;
  }
}

export async function resolveApplicationEmailApproval(
  userId: number,
  approvalId: number,
  status: "approved" | "rejected" | "cancelled",
  decisionNote?: string
) {
  const db = await getDb();
  if (!db) throw new ApplicationEmailDeliveryError("Application email delivery requires durable database storage.");
  const approvalRows = await db.select().from(applicationApprovals)
    .where(and(
      eq(applicationApprovals.id, approvalId),
      eq(applicationApprovals.userId, userId),
      eq(applicationApprovals.approvalType, "application_email_submission")
    ))
    .limit(1);
  const approval = approvalRows[0];
  if (!approval || approval.applicationId === null) throw new ApplicationEmailDeliveryError("Application email approval not found.");
  if (status === "approved") {
    const bundle = await loadApplicationBundle(userId, approval.applicationId);
    if (bundle.application.status !== "pending") throw new ApplicationEmailDeliveryError("Application is no longer pending.");
    const recipient = assertEligibleJob(bundle.job);
    const evidenceContext = await (await import("./autonomousEvidence")).getAutonomousEvidenceContext(userId);
    if (evidenceContext.evidenceGates.some(gate => gate.blocks.includes("external_application_submission"))) {
      await db.insert(auditEvents).values({
        userId,
        entityType: "application",
        entityId: approval.applicationId,
        action: "application_email_approval_blocked_evidence",
        actor: "user",
        source: "applications.resolveEmailSubmissionApproval",
        afterState: JSON.stringify({ approvalId, externalMessageSent: false, blockedGates: evidenceContext.evidenceGates.filter(gate => gate.blocks.includes("external_application_submission")).map(gate => gate.id) }),
        riskLevel: "high",
        approvalId,
      });
      throw new ApplicationEmailDeliveryError("Resolve profile evidence gates before approving an external application email.");
    }
    if (recipient !== normalizeFollowUpRecipient(bundle.job.applicationEmail || "")) {
      throw new ApplicationEmailDeliveryError("The listed employer email is no longer valid.");
    }
  }

  return await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const lockedApprovals = await tx.select().from(applicationApprovals)
      .where(and(
        eq(applicationApprovals.id, approvalId),
        eq(applicationApprovals.userId, userId),
        eq(applicationApprovals.status, "pending")
      ))
      .limit(1)
      .for("update");
    const lockedApproval = lockedApprovals[0];
    if (!lockedApproval || lockedApproval.applicationId === null) throw new ApplicationEmailDeliveryError("Application email approval has already been resolved.");
    const lockedDeliveries = await tx.select().from(applicationEmailDeliveries)
      .where(and(
        eq(applicationEmailDeliveries.userId, userId),
        eq(applicationEmailDeliveries.applicationId, lockedApproval.applicationId),
        eq(applicationEmailDeliveries.status, "pending_approval")
      ))
      .limit(1)
      .for("update");
    const delivery = lockedDeliveries[0];
    if (!delivery || !matchesApprovalSnapshot(delivery, lockedApproval)) throw new ApplicationEmailDeliveryError("The email or resume changed after approval was requested. Prepare a new approval.");
    await tx.update(applicationApprovals).set({
      status,
      decidedBy: "user",
      decisionNote: decisionNote?.slice(0, 5000) ?? null,
      decidedAt: new Date(),
    }).where(and(eq(applicationApprovals.id, approvalId), eq(applicationApprovals.status, "pending")));
    await tx.update(applicationEmailDeliveries).set({
      status: status === "approved" ? "ready" : "cancelled",
      approvedAt: status === "approved" ? new Date() : null,
    }).where(eq(applicationEmailDeliveries.id, delivery.id));
    await tx.insert(auditEvents).values({
      userId,
      entityType: "application",
      entityId: delivery.applicationId,
      action: `application_email_approval_${status}`,
      actor: "user",
      source: "applications.resolveEmailSubmissionApproval",
      afterState: JSON.stringify({ approvalId, status, provider: delivery.provider, externalMessageSent: false }),
      riskLevel: "high",
      approvalId,
    });
    return { success: true, status };
  });
}

async function updateDeliveryOutcome(input: {
  deliveryId: number;
  attemptKey: string;
  status: "failed" | "unknown";
  message: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    const deliveries = await tx.select().from(applicationEmailDeliveries)
      .where(and(
        eq(applicationEmailDeliveries.id, input.deliveryId),
        eq(applicationEmailDeliveries.attemptKey, input.attemptKey),
        eq(applicationEmailDeliveries.status, "sending")
      ))
      .limit(1)
      .for("update");
    const delivery = deliveries[0];
    if (!delivery) return;
    await tx.update(applicationEmailDeliveries).set({
      status: input.status,
      failureMessage: input.message,
    }).where(eq(applicationEmailDeliveries.id, delivery.id));
    await tx.insert(auditEvents).values({
      userId: delivery.userId,
      entityType: "application",
      entityId: delivery.applicationId,
      action: input.status === "failed" ? "application_email_delivery_failed" : "application_email_delivery_unknown",
      actor: "system",
      source: "applications.sendEmailSubmission",
      afterState: JSON.stringify({ provider: delivery.provider, attemptKey: input.attemptKey, retryBlocked: input.status === "unknown" }),
      riskLevel: "high",
    });
  });
}

export async function sendApprovedApplicationEmail(userId: number, applicationId: number) {
  const db = await getDb();
  if (!db) throw new ApplicationEmailDeliveryError("Application email delivery requires durable database storage.");
  const attemptKey = randomUUID();
  const reservation = await db.transaction(async (tx) => {
    const lockedUsers = await tx.select({ accountStatus: users.accountStatus }).from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (lockedUsers[0]?.accountStatus !== "active") {
      throw new ApplicationEmailDeliveryError("An active account is required to send an application email.");
    }
    const deliveryRows = await tx.select().from(applicationEmailDeliveries)
      .where(and(
        eq(applicationEmailDeliveries.userId, userId),
        eq(applicationEmailDeliveries.applicationId, applicationId)
      ))
      .limit(1)
      .for("update");
    const delivery = deliveryRows[0];
    if (!delivery) throw new ApplicationEmailDeliveryError("Application email draft not found.");
    if (delivery.status === "sending" || delivery.status === "unknown") throw new ApplicationEmailDeliveryError(GENERIC_UNCERTAIN_OUTCOME);
    if (delivery.status !== "ready") throw new ApplicationEmailDeliveryError("This application email does not have an active explicit approval.");
    const applicationRows = await tx.select({ application: applications, job: jobs })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
      .limit(1)
      .for("update");
    const appAndJob = applicationRows[0];
    if (!appAndJob || appAndJob.application.status !== "pending") throw new ApplicationEmailDeliveryError("Application is no longer pending.");
    const listedRecipient = assertEligibleJob(appAndJob.job);
    if (delivery.recipient !== listedRecipient) throw new ApplicationEmailDeliveryError("The job's listed email changed. Do not send this draft.");
    const approvals = await tx.select().from(applicationApprovals)
      .where(and(
        eq(applicationApprovals.userId, userId),
        eq(applicationApprovals.applicationId, applicationId),
        eq(applicationApprovals.approvalType, "application_email_submission"),
        eq(applicationApprovals.status, "approved")
      ))
      .orderBy(desc(applicationApprovals.id))
      .limit(1)
      .for("update");
    const approval = approvals[0];
    if (!approval || !matchesApprovalSnapshot(delivery, approval)) throw new ApplicationEmailDeliveryError("Approved email details do not match this draft. Request fresh approval.");
    const startedAt = new Date();
    const updated = await tx.update(applicationEmailDeliveries).set({
      status: "sending",
      attemptKey,
      attemptCount: delivery.attemptCount + 1,
      failureMessage: null,
      updatedAt: startedAt,
    }).where(and(eq(applicationEmailDeliveries.id, delivery.id), eq(applicationEmailDeliveries.status, "ready")));
    if (Number(updated[0].affectedRows) !== 1) throw new ApplicationEmailDeliveryError("Application email is already being processed.");
    return { delivery, job: appAndJob.job, approval, startedAt };
  });

  let resume: ResumeSnapshot;
  let access: Awaited<ReturnType<typeof getAuthorizedMailAccess>>;
  try {
    assertResumeIsAttachable({
      id: reservation.delivery.resumeId,
      userId,
      fileName: reservation.delivery.resumeFileName,
      fileKey: reservation.delivery.resumeFileKey,
      fileSize: reservation.delivery.resumeSize,
      mimeType: reservation.delivery.resumeMimeType,
      version: reservation.delivery.resumeVersion,
      isActive: 0,
      fileUrl: "",
      uploadedAt: new Date(),
      createdAt: new Date(),
    });
    access = await getAuthorizedMailAccess(userId, reservation.delivery.provider);
    resume = await downloadResumeSnapshot(reservation.delivery.resumeFileKey, reservation.delivery.resumeSize);
    if (resume.sha256 !== reservation.delivery.resumeSha256) throw new ApplicationEmailDeliveryError("The stored resume changed after approval. Do not send this draft.");
    const evidence = await (await import("./autonomousEvidence")).getAutonomousEvidenceContext(userId);
    if (evidence.evidenceGates.some(gate => gate.blocks.includes("external_application_submission"))) {
      throw new ApplicationEmailDeliveryError("Profile evidence gates changed after approval.");
    }
  } catch {
    await updateDeliveryOutcome({ deliveryId: reservation.delivery.id, attemptKey, status: "failed", message: GENERIC_DELIVERY_FAILURE });
    throw new ApplicationEmailDeliveryError(GENERIC_DELIVERY_FAILURE);
  }

  let providerResult: { messageId: string | null; confirmation: string };
  try {
    providerResult = await sendFollowUpProviderMessage(
      reservation.delivery.provider,
      access.accessToken,
      reservation.delivery.recipient,
      reservation.delivery.subject,
      reservation.delivery.message,
      fetch,
      { fileName: reservation.delivery.resumeFileName, mimeType: reservation.delivery.resumeMimeType, bytes: resume.bytes }
    );
  } catch (error) {
    if (error instanceof FollowUpProviderRejectionError && error.statusCode < 500) {
      if (error.authorizationRejected) {
        await markAuthorizedMailAccessNeedsReauth(userId, access.account).catch(() => undefined);
      }
      await updateDeliveryOutcome({ deliveryId: reservation.delivery.id, attemptKey, status: "failed", message: GENERIC_DELIVERY_FAILURE });
      throw new ApplicationEmailDeliveryError(GENERIC_DELIVERY_FAILURE);
    }
    await updateDeliveryOutcome({ deliveryId: reservation.delivery.id, attemptKey, status: "unknown", message: GENERIC_UNCERTAIN_OUTCOME });
    throw new ApplicationEmailDeliveryError(GENERIC_UNCERTAIN_OUTCOME);
  }

  try {
    await db.transaction(async (tx) => {
      const locked = await tx.select().from(applicationEmailDeliveries)
        .where(and(
          eq(applicationEmailDeliveries.id, reservation.delivery.id),
          eq(applicationEmailDeliveries.attemptKey, attemptKey),
          eq(applicationEmailDeliveries.status, "sending")
        ))
        .limit(1)
        .for("update");
      if (!locked[0]) throw new ApplicationEmailDeliveryError("The application email send reservation was lost.");
      const now = new Date();
      await tx.update(applicationEmailDeliveries).set({
        status: "sent",
        providerMessageId: providerResult.messageId,
        failureMessage: null,
        sentAt: now,
      }).where(eq(applicationEmailDeliveries.id, reservation.delivery.id));
      await tx.update(applications).set({ status: "applied", appliedDate: now, lastActivity: now })
        .where(and(eq(applications.id, applicationId), eq(applications.userId, userId), eq(applications.status, "pending")));
      await tx.insert(applicationAttempts).values({
        applicationId,
        userId,
        jobId: reservation.job.id,
        platformId: reservation.job.platformId,
        attemptType: "external_handoff",
        status: "submitted",
        startedAt: reservation.startedAt,
        finishedAt: now,
        confirmationText: "Mailbox provider accepted the explicitly approved application email. Delivery to the recipient is not guaranteed.",
        retryCount: Math.max(0, reservation.delivery.attemptCount),
      });
      await tx.insert(auditEvents).values({
        userId,
        entityType: "application",
        entityId: applicationId,
        action: "application_email_accepted_by_provider",
        actor: "user",
        source: "applications.sendEmailSubmission",
        afterState: JSON.stringify({ provider: reservation.delivery.provider, attemptKey, providerMessageId: providerResult.messageId, approvalId: reservation.approval.id, externalMessageSent: true, recipientDeliveryGuaranteed: false }),
        riskLevel: "high",
        approvalId: reservation.approval.id,
      });
    });
  } catch {
    await updateDeliveryOutcome({ deliveryId: reservation.delivery.id, attemptKey, status: "unknown", message: GENERIC_UNCERTAIN_OUTCOME });
    throw new ApplicationEmailDeliveryError(GENERIC_UNCERTAIN_OUTCOME);
  }

  return { success: true, provider: reservation.delivery.provider, providerMessageId: providerResult.messageId, confirmation: providerResult.confirmation };
}
