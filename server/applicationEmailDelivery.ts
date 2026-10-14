import { randomUUID } from "node:crypto";
import { and, desc, eq, like } from "drizzle-orm";
import {
  applicationApprovals,
  applicationAttempts,
  applicationMaterials,
  applications,
  auditEvents,
  jobs,
  userResumes,
} from "../drizzle/schema";
import { assessListingSafety } from "@shared/listingSafety";
import {
  hasExplicitRemoteWorkSignal,
  hasNonRemoteWorkSignal,
} from "@shared/remoteEligibility";
import { isJobCurrentForAutonomousProcessing } from "./autonomousOrchestrator";
import { getDb } from "./db";
import { getAutonomousEvidenceContext } from "./autonomousEvidence";
import { fetchPublicHttpsUrl } from "./_core/publicUrl";
import {
  outboundRequestSignal,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseBytes,
} from "./_core/outboundRequest";
import { storageGet, normalizeOwnedStorageKey } from "./storage";
import { RESUME_MIME_TYPES, validateUploadedFile } from "./uploadValidation";
import {
  FollowUpProviderRejectionError,
  getMailAccess,
  markMailProviderNeedsReauth,
  sendFollowUpProviderMessage,
  type FollowUpMailProvider,
  type MailAttachment,
} from "./followUpMailDelivery";

const DELIVERY_MARKER = "Hire.AI email application delivery:";
const MAX_EMAIL_RESUME_BYTES = Math.floor(2.5 * 1024 * 1024);
const SAFE_DELIVERY_FAILURE = "Application email could not be sent.";

export class ApplicationEmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationEmailDeliveryError";
  }
}

export type SendApprovedApplicationByEmailInput = {
  approvalId: number;
  userId: number;
  provider: FollowUpMailProvider;
};

type ResumeRecord = typeof userResumes.$inferSelect;

export type ApplicationEmailDeliveryDependencies = {
  getDb: typeof getDb;
  getEvidenceContext: typeof getAutonomousEvidenceContext;
  getMailAccess: typeof getMailAccess;
  markProviderNeedsReauth: typeof markMailProviderNeedsReauth;
  sendMessage: typeof sendFollowUpProviderMessage;
  getResumeAttachment: (
    resume: ResumeRecord,
    userId: number
  ) => Promise<MailAttachment>;
};

const defaults: ApplicationEmailDeliveryDependencies = {
  getDb,
  getEvidenceContext: getAutonomousEvidenceContext,
  getMailAccess,
  markProviderNeedsReauth: markMailProviderNeedsReauth,
  sendMessage: sendFollowUpProviderMessage,
  getResumeAttachment,
};

function normalizeEmployerEmail(value: string | null | undefined) {
  const email = value?.trim() ?? "";
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || /[\r\n]/.test(email)) {
    throw new ApplicationEmailDeliveryError(
      "This listing does not contain a valid employer application email."
    );
  }
  return email;
}

function parseApprovalPayload(value: string | null) {
  try {
    const payload = value ? JSON.parse(value) : null;
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function buildSubject(title: string, company: string) {
  return `Application: ${title} at ${company}`
    .replace(/[\r\n]+/g, " ")
    .slice(0, 250);
}

function isExplicitRemoteJob(job: typeof jobs.$inferSelect, now: Date) {
  const fields = [
    job.title,
    job.description,
    job.requirements,
    job.responsibilities,
    job.benefits,
    job.location,
  ];
  return (
    isJobCurrentForAutonomousProcessing(job, now) &&
    hasExplicitRemoteWorkSignal(...fields) &&
    !hasNonRemoteWorkSignal(...fields) &&
    assessListingSafety(job, now).status === "clear"
  );
}

function safeProviderFailure(error: unknown) {
  if (error instanceof FollowUpProviderRejectionError) {
    const safe = error.message.match(
      /^(Gmail|Outlook) rejected the application delivery \((\d{3})\)\.$/
    );
    if (safe) return `${safe[1]} rejected the application email (${safe[2]}).`;
  }
  return SAFE_DELIVERY_FAILURE;
}

function assertApprovalSnapshot(input: {
  approval: typeof applicationApprovals.$inferSelect;
  material: typeof applicationMaterials.$inferSelect;
  resume: ResumeRecord;
  now: Date;
}) {
  const { approval, material, resume, now } = input;
  const payload = parseApprovalPayload(approval.payload);
  if (
    !payload ||
    Number(payload.resumeId) !== resume.id ||
    Number(payload.resumeVersion) !== resume.version
  ) {
    throw new ApplicationEmailDeliveryError(
      "The approved resume version no longer matches this application. Review and approve the current materials again."
    );
  }
  if (
    !approval.decidedAt ||
    material.updatedAt.getTime() > approval.decidedAt.getTime()
  ) {
    throw new ApplicationEmailDeliveryError(
      "Application materials changed after approval. Review and approve the current materials again."
    );
  }
  if (!material.coverLetter?.trim()) {
    throw new ApplicationEmailDeliveryError(
      "A reviewed cover letter is required before sending an email application."
    );
  }
  if (material.coverLetter.length > 10_000) {
    throw new ApplicationEmailDeliveryError(
      "The reviewed cover letter exceeds the email delivery limit."
    );
  }
  if (approval.decidedAt.getTime() > now.getTime()) {
    throw new ApplicationEmailDeliveryError(
      "The application approval timestamp is invalid."
    );
  }
}

function materialSnapshot(material: typeof applicationMaterials.$inferSelect) {
  return JSON.stringify([
    material.resumeId,
    material.customResume,
    material.coverLetter,
    material.customAnswers,
    material.claimsMade,
    material.sourceProfileSnapshot,
    material.updatedAt.toISOString(),
  ]);
}

function resumeSnapshot(resume: ResumeRecord) {
  return JSON.stringify([
    resume.id,
    resume.fileName,
    resume.fileKey,
    resume.fileSize,
    resume.mimeType,
    resume.version,
  ]);
}

async function getResumeAttachment(
  resume: ResumeRecord,
  userId: number
): Promise<MailAttachment> {
  if (
    !RESUME_MIME_TYPES.has(resume.mimeType) ||
    resume.fileSize < 1 ||
    resume.fileSize > MAX_EMAIL_RESUME_BYTES
  ) {
    throw new ApplicationEmailDeliveryError(
      "The selected resume cannot be attached by email. Choose a supported file no larger than 2.5 MiB or use the employer portal manually."
    );
  }
  const fileKey = normalizeOwnedStorageKey(resume.fileKey, userId, "resumes");
  const { url } = await storageGet(fileKey);
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const signal = outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard);
  const response =
    parsedUrl.protocol === "http:" && localHosts.has(hostname)
      ? await fetch(parsedUrl, { method: "GET", redirect: "error", signal })
      : await fetchPublicHttpsUrl(url, { method: "GET", signal });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Resume download failed.");
  }
  const data = Buffer.from(
    await readBoundedResponseBytes(
      response,
      Math.min(MAX_EMAIL_RESUME_BYTES, resume.fileSize)
    )
  );
  if (data.byteLength !== resume.fileSize)
    throw new Error("Resume file size does not match its stored metadata.");
  const validated = validateUploadedFile({
    data,
    fileName: resume.fileName,
    mimeType: resume.mimeType,
    allowedMimeTypes: RESUME_MIME_TYPES,
    maxBytes: MAX_EMAIL_RESUME_BYTES,
  });
  return { fileName: validated.fileName, mimeType: resume.mimeType, data };
}

async function reserveApplicationDelivery(
  input: SendApprovedApplicationByEmailInput,
  attemptKey: string,
  now: Date,
  dependencies: ApplicationEmailDeliveryDependencies
) {
  const db = await dependencies.getDb();
  if (!db)
    throw new ApplicationEmailDeliveryError(
      "Application email delivery requires durable database storage."
    );

  return await db.transaction(async tx => {
    const approvalIdentityRows = await tx
      .select()
      .from(applicationApprovals)
      .where(
        and(
          eq(applicationApprovals.id, input.approvalId),
          eq(applicationApprovals.userId, input.userId)
        )
      )
      .limit(1);
    const applicationId = approvalIdentityRows[0]?.applicationId;
    if (!applicationId)
      throw new ApplicationEmailDeliveryError(
        "An approved application submission gate is required."
      );
    const lockedApplicationRows = await tx
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.userId, input.userId),
          eq(applications.id, applicationId)
        )
      )
      .limit(1)
      .for("update");
    const approvalRows = await tx
      .select()
      .from(applicationApprovals)
      .where(
        and(
          eq(applicationApprovals.id, input.approvalId),
          eq(applicationApprovals.userId, input.userId),
          eq(applicationApprovals.approvalType, "application_submission"),
          eq(applicationApprovals.status, "approved")
        )
      )
      .limit(1)
      .for("update");
    const approval = approvalRows[0];
    if (
      !approval ||
      !approval.applicationId ||
      approval.entityType !== "application" ||
      approval.entityId !== approval.applicationId
    ) {
      throw new Error("An approved application submission gate is required.");
    }
    const application = lockedApplicationRows[0];
    if (approval.applicationId !== applicationId)
      throw new Error(
        "The approved application changed while this action was opening."
      );
    if (!application) throw new Error("Application not found.");

    const existingRows = await tx
      .select()
      .from(applicationAttempts)
      .where(
        and(
          eq(applicationAttempts.applicationId, application.id),
          eq(applicationAttempts.userId, input.userId),
          eq(applicationAttempts.attemptType, "external_handoff"),
          like(applicationAttempts.confirmationText, `${DELIVERY_MARKER}%`)
        )
      )
      .orderBy(desc(applicationAttempts.id))
      .limit(1);
    const existing = existingRows[0];
    if (existing?.status === "submitted") {
      return { alreadySubmitted: true as const, applicationId: application.id };
    }
    if (
      existing?.status === "prepared" ||
      existing?.status === "review_required"
    ) {
      throw new ApplicationEmailDeliveryError(
        "An earlier application email may already have been sent. Check the connected mailbox before taking any further action; automatic retry is blocked."
      );
    }
    if (application.status !== "pending")
      throw new ApplicationEmailDeliveryError(
        "This application is no longer pending submission."
      );

    const jobRows = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, application.jobId))
      .limit(1);
    const job = jobRows[0];
    if (!job || !isExplicitRemoteJob(job, now)) {
      throw new ApplicationEmailDeliveryError(
        "Only current, explicitly remote, safety-cleared listings can be submitted by email."
      );
    }
    const recipient = normalizeEmployerEmail(job.applicationEmail);
    if (job.applicationUrl)
      throw new ApplicationEmailDeliveryError(
        "This listing directs applicants to an employer portal; submit there manually instead of emailing an application."
      );

    const materialRows = await tx
      .select()
      .from(applicationMaterials)
      .where(eq(applicationMaterials.applicationId, application.id))
      .limit(1);
    const material = materialRows[0];
    if (!material?.resumeId)
      throw new ApplicationEmailDeliveryError(
        "A versioned resume must be linked to the reviewed application materials."
      );
    const resumeRows = await tx
      .select()
      .from(userResumes)
      .where(
        and(
          eq(userResumes.id, material.resumeId),
          eq(userResumes.userId, input.userId)
        )
      )
      .limit(1);
    const resume = resumeRows[0];
    if (!resume)
      throw new ApplicationEmailDeliveryError(
        "The resume selected for this application is unavailable."
      );
    assertApprovalSnapshot({ approval, material, resume, now });
    const approvedMaterialSnapshot = materialSnapshot(material);
    const approvedResumeSnapshot = resumeSnapshot(resume);

    const attempt = await tx.insert(applicationAttempts).values({
      applicationId: application.id,
      userId: input.userId,
      jobId: application.jobId,
      platformId: job.platformId,
      attemptType: "external_handoff",
      status: "prepared",
      startedAt: now,
      confirmationText: `${DELIVERY_MARKER} ${attemptKey}; provider=${input.provider}; delivery is pending confirmation.`,
      retryCount: 0,
    });
    const attemptId = Number(attempt[0].insertId);
    await tx.insert(auditEvents).values({
      userId: input.userId,
      entityType: "application",
      entityId: application.id,
      action: "application_email_delivery_started",
      actor: "user",
      source: `applicationEmailDelivery.${input.provider}`,
      afterState: JSON.stringify({
        approvalId: approval.id,
        attemptId,
        provider: input.provider,
        recipient,
        resumeId: resume.id,
        resumeVersion: resume.version,
        externalSubmissionPerformed: false,
      }),
      riskLevel: "high",
      approvalId: approval.id,
    });
    return {
      alreadySubmitted: false as const,
      approvalId: approval.id,
      applicationId: application.id,
      attemptId,
      recipient,
      subject: buildSubject(job.title, job.company),
      message: material.coverLetter as string,
      resume,
      approvedMaterialSnapshot,
      approvedResumeSnapshot,
    };
  });
}

async function revalidateApplicationDelivery(
  input: SendApprovedApplicationByEmailInput,
  reservation: Exclude<
    Awaited<ReturnType<typeof reserveApplicationDelivery>>,
    { alreadySubmitted: true }
  >,
  now: Date,
  dependencies: ApplicationEmailDeliveryDependencies
) {
  const db = await dependencies.getDb();
  if (!db)
    throw new ApplicationEmailDeliveryError(
      "Application email delivery requires durable database storage."
    );
  await db.transaction(async tx => {
    const applicationRows = await tx
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.id, reservation.applicationId),
          eq(applications.userId, input.userId)
        )
      )
      .limit(1)
      .for("update");
    const application = applicationRows[0];
    const approvalRows = await tx
      .select()
      .from(applicationApprovals)
      .where(
        and(
          eq(applicationApprovals.id, input.approvalId),
          eq(applicationApprovals.userId, input.userId),
          eq(applicationApprovals.applicationId, reservation.applicationId),
          eq(applicationApprovals.approvalType, "application_submission"),
          eq(applicationApprovals.status, "approved")
        )
      )
      .limit(1)
      .for("update");
    const approval = approvalRows[0];
    if (!application || application.status !== "pending" || !approval) {
      throw new ApplicationEmailDeliveryError(
        "The application or its approval changed before the email could be sent."
      );
    }

    const [jobRows, materialRows] = await Promise.all([
      tx.select().from(jobs).where(eq(jobs.id, application.jobId)).limit(1),
      tx
        .select()
        .from(applicationMaterials)
        .where(eq(applicationMaterials.applicationId, application.id))
        .limit(1),
    ]);
    const job = jobRows[0];
    const material = materialRows[0];
    if (
      !job ||
      !isExplicitRemoteJob(job, now) ||
      job.applicationUrl ||
      normalizeEmployerEmail(job.applicationEmail) !== reservation.recipient
    ) {
      throw new ApplicationEmailDeliveryError(
        "The job destination or listing eligibility changed before the email could be sent."
      );
    }
    if (
      !material?.resumeId ||
      materialSnapshot(material) !== reservation.approvedMaterialSnapshot
    ) {
      throw new ApplicationEmailDeliveryError(
        "Application materials changed before the email could be sent. Review and approve the current materials again."
      );
    }
    const resumeRows = await tx
      .select()
      .from(userResumes)
      .where(
        and(
          eq(userResumes.id, material.resumeId),
          eq(userResumes.userId, input.userId)
        )
      )
      .limit(1);
    const resume = resumeRows[0];
    if (
      !resume ||
      resumeSnapshot(resume) !== reservation.approvedResumeSnapshot
    ) {
      throw new ApplicationEmailDeliveryError(
        "The selected resume changed before the email could be sent. Review the current resume and try again."
      );
    }
    assertApprovalSnapshot({ approval, material, resume, now });
  });
}

async function recordPreflightBlock(
  input: SendApprovedApplicationByEmailInput,
  error: ApplicationEmailDeliveryError,
  now: Date,
  dependencies: ApplicationEmailDeliveryDependencies
) {
  const db = await dependencies.getDb();
  if (!db) return;
  const approvalRows = await db
    .select()
    .from(applicationApprovals)
    .where(
      and(
        eq(applicationApprovals.id, input.approvalId),
        eq(applicationApprovals.userId, input.userId)
      )
    )
    .limit(1);
  const approval = approvalRows[0];
  if (!approval?.applicationId) return;
  await db.insert(auditEvents).values({
    userId: input.userId,
    entityType: "application",
    entityId: approval.applicationId,
    action: "application_email_delivery_blocked",
    actor: "user",
    source: `applicationEmailDelivery.${input.provider}`,
    afterState: JSON.stringify({
      approvalId: approval.id,
      provider: input.provider,
      reason: error.message,
      externalSubmissionPerformed: false,
      occurredAt: now.toISOString(),
    }),
    riskLevel: "high",
    approvalId: approval.id,
  });
}

async function recordKnownFailure(
  input: SendApprovedApplicationByEmailInput,
  applicationId: number,
  attemptId: number,
  reason: string,
  now: Date,
  dependencies: ApplicationEmailDeliveryDependencies
) {
  const db = await dependencies.getDb();
  if (!db) return;
  await db.transaction(async tx => {
    await tx
      .update(applicationAttempts)
      .set({
        status: "failed",
        finishedAt: now,
        errorMessage: reason,
        confirmationText: `${DELIVERY_MARKER} known provider rejection or pre-send failure.`,
      })
      .where(
        and(
          eq(applicationAttempts.id, attemptId),
          eq(applicationAttempts.userId, input.userId),
          eq(applicationAttempts.status, "prepared")
        )
      );
    await tx.insert(auditEvents).values({
      userId: input.userId,
      entityType: "application",
      entityId: applicationId,
      action: "application_email_delivery_failed",
      actor: "user",
      source: `applicationEmailDelivery.${input.provider}`,
      afterState: JSON.stringify({
        approvalId: input.approvalId,
        attemptId,
        provider: input.provider,
        reason,
        externalSubmissionPerformed: false,
      }),
      riskLevel: "high",
      approvalId: input.approvalId,
    });
  });
}

async function recordUncertainOutcome(
  input: SendApprovedApplicationByEmailInput,
  attemptId: number,
  applicationId: number,
  reason: string,
  now: Date,
  dependencies: ApplicationEmailDeliveryDependencies
) {
  const db = await dependencies.getDb();
  if (!db) return;
  await db.transaction(async tx => {
    await tx
      .update(applicationAttempts)
      .set({
        confirmationText: `${DELIVERY_MARKER} outcome uncertain; automatic retry blocked.`,
      })
      .where(
        and(
          eq(applicationAttempts.id, attemptId),
          eq(applicationAttempts.userId, input.userId),
          eq(applicationAttempts.status, "prepared")
        )
      );
    await tx.insert(auditEvents).values({
      userId: input.userId,
      entityType: "application",
      entityId: applicationId,
      action: "application_email_delivery_uncertain",
      actor: "user",
      source: `applicationEmailDelivery.${input.provider}`,
      afterState: JSON.stringify({
        attemptId,
        provider: input.provider,
        reason,
        externalSubmissionPerformed: "unknown",
        retryBlocked: true,
        observedAt: now.toISOString(),
      }),
      riskLevel: "high",
      approvalId: input.approvalId,
    });
  });
}

export async function sendApprovedApplicationByEmail(
  input: SendApprovedApplicationByEmailInput,
  options: {
    fetcher?: typeof fetch;
    now?: Date;
    dependencies?: ApplicationEmailDeliveryDependencies;
  } = {}
) {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const dependencies = options.dependencies ?? defaults;
  const attemptKey = randomUUID();
  let reservation: Awaited<ReturnType<typeof reserveApplicationDelivery>>;
  try {
    reservation = await reserveApplicationDelivery(
      input,
      attemptKey,
      now,
      dependencies
    );
  } catch (error) {
    if (error instanceof ApplicationEmailDeliveryError) {
      await recordPreflightBlock(input, error, now, dependencies);
    }
    throw error;
  }
  if (reservation.alreadySubmitted)
    return {
      success: true,
      existing: true,
      applicationId: reservation.applicationId,
    };

  let access: Awaited<ReturnType<typeof getMailAccess>>;
  let attachment: MailAttachment;
  try {
    const evidence = await dependencies.getEvidenceContext(input.userId);
    const blockingGates = evidence.evidenceGates.filter(gate =>
      gate.blocks.includes("external_application_submission")
    );
    if (blockingGates.length > 0) {
      throw new ApplicationEmailDeliveryError(
        "Resolve the current profile evidence gates before submitting this application."
      );
    }
    access = await dependencies.getMailAccess(
      input.userId,
      input.provider,
      now,
      fetcher
    );
    attachment = await dependencies.getResumeAttachment(
      reservation.resume,
      input.userId
    );
    await revalidateApplicationDelivery(input, reservation, now, dependencies);
  } catch (error) {
    const message =
      error instanceof ApplicationEmailDeliveryError
        ? error.message
        : error instanceof Error &&
            /^(Gmail|Outlook) (?:must be freshly authorized|authorization is unavailable|authorization has expired|token renewal is not configured)/.test(
              error.message
            )
          ? error.message
          : "A supported resume could not be prepared for the connected mailbox.";
    await recordKnownFailure(
      input,
      reservation.applicationId,
      reservation.attemptId,
      message,
      now,
      dependencies
    );
    throw new ApplicationEmailDeliveryError(message);
  }

  let providerResult: Awaited<ReturnType<typeof sendFollowUpProviderMessage>>;
  try {
    providerResult = await dependencies.sendMessage(
      input.provider,
      access.accessToken,
      reservation.recipient,
      reservation.subject,
      reservation.message,
      fetcher,
      [attachment],
      "application"
    );
  } catch (error) {
    if (error instanceof FollowUpProviderRejectionError) {
      if (error.authorizationRejected) {
        await dependencies.markProviderNeedsReauth(
          input.userId,
          access.account as never
        );
      }
      const reason = safeProviderFailure(error);
      await recordKnownFailure(
        input,
        reservation.applicationId,
        reservation.attemptId,
        reason,
        now,
        dependencies
      );
      throw new ApplicationEmailDeliveryError(reason);
    }
    const reason = "The mailbox response was not conclusive.";
    await recordUncertainOutcome(
      input,
      reservation.attemptId,
      reservation.applicationId,
      reason,
      now,
      dependencies
    );
    throw new ApplicationEmailDeliveryError(
      "Application email delivery is uncertain. Do not retry; check the connected mailbox and contact the employer manually if needed."
    );
  }

  const db = await dependencies.getDb();
  if (!db) {
    await recordUncertainOutcome(
      input,
      reservation.attemptId,
      reservation.applicationId,
      "Durable delivery evidence could not be finalized.",
      now,
      dependencies
    );
    throw new ApplicationEmailDeliveryError(
      "The mailbox accepted the application, but Hire.AI could not finalize its ledger. Do not retry; confirm delivery manually."
    );
  }
  try {
    await db.transaction(async tx => {
      const attemptUpdate = await tx
        .update(applicationAttempts)
        .set({
          status: "submitted",
          finishedAt: now,
          confirmationText: `${DELIVERY_MARKER} ${providerResult.confirmation}`,
        })
        .where(
          and(
            eq(applicationAttempts.id, reservation.attemptId),
            eq(applicationAttempts.userId, input.userId),
            eq(applicationAttempts.status, "prepared")
          )
        );
      if (Number(attemptUpdate[0].affectedRows) !== 1)
        throw new Error("Delivery attempt state changed.");
      const applicationUpdate = await tx
        .update(applications)
        .set({ status: "applied", appliedDate: now, lastActivity: now })
        .where(
          and(
            eq(applications.id, reservation.applicationId),
            eq(applications.userId, input.userId),
            eq(applications.status, "pending")
          )
        );
      if (Number(applicationUpdate[0].affectedRows) !== 1)
        throw new Error("Application state changed.");
      await tx.insert(auditEvents).values({
        userId: input.userId,
        entityType: "application",
        entityId: reservation.applicationId,
        action: "application_email_submitted",
        actor: "user",
        source: `applicationEmailDelivery.${input.provider}`,
        afterState: JSON.stringify({
          attemptId: reservation.attemptId,
          provider: input.provider,
          recipient: reservation.recipient,
          messageId: providerResult.messageId,
          submittedAt: now.toISOString(),
          externalSubmissionPerformed: true,
        }),
        riskLevel: "high",
        approvalId: reservation.approvalId,
      });
    });
  } catch {
    await recordUncertainOutcome(
      input,
      reservation.attemptId,
      reservation.applicationId,
      "Mailbox accepted the message, but ledger finalization failed.",
      now,
      dependencies
    );
    throw new ApplicationEmailDeliveryError(
      "The mailbox accepted the application, but Hire.AI could not finalize its ledger. Do not retry; confirm delivery manually."
    );
  }

  return {
    success: true,
    existing: false,
    applicationId: reservation.applicationId,
    provider: input.provider,
    messageId: providerResult.messageId,
    confirmation: providerResult.confirmation,
  };
}
