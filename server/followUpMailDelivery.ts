import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  applicationApprovals,
  applications,
  auditEvents,
  followUps,
  jobs,
} from "../drizzle/schema";
import { isConnectorAuthorizationStale } from "@shared/profileEvidence";
import { decryptConnectorToken, encryptConnectorToken, getConnectorOAuthConfig, refreshConnectorAccessToken } from "./connectorOAuth";
import { ConnectorAccessTokenError, getUsableConnectorAccessToken } from "./connectorAccessToken";
import { isAuthoritativeInvalidConnectorToken } from "./connectorAuthorization";
import {
  acquireConnectorRefreshLease,
  getConnectorAuthorization,
  getDb,
  getUserConnectorAccount,
  releaseConnectorRefreshLease,
  upsertConnectorAuthorization,
  upsertUserConnectorAccount,
} from "./db";
import { providerRequestInit, readProviderJson } from "./_core/providerRequest";

export type FollowUpMailProvider = "gmail" | "outlook";

export type SendApprovedFollowUpInput = {
  followUpId: number;
  userId: number;
  provider: FollowUpMailProvider;
  recipient: string;
};

type FollowUpMailDeliveryDependencies = {
  acquireConnectorRefreshLease: typeof acquireConnectorRefreshLease;
  decryptConnectorToken: typeof decryptConnectorToken;
  encryptConnectorToken: typeof encryptConnectorToken;
  getConnectorAuthorization: typeof getConnectorAuthorization;
  getConnectorOAuthConfig: typeof getConnectorOAuthConfig;
  getUserConnectorAccount: typeof getUserConnectorAccount;
  refreshConnectorAccessToken: typeof refreshConnectorAccessToken;
  releaseConnectorRefreshLease: typeof releaseConnectorRefreshLease;
  upsertConnectorAuthorization: typeof upsertConnectorAuthorization;
  upsertUserConnectorAccount: typeof upsertUserConnectorAccount;
};

export class FollowUpProviderRejectionError extends Error {
  constructor(message: string, readonly authorizationRejected: boolean, readonly statusCode = 0) {
    super(message);
    this.name = "FollowUpProviderRejectionError";
  }
}

const defaults: FollowUpMailDeliveryDependencies = {
  acquireConnectorRefreshLease,
  decryptConnectorToken,
  encryptConnectorToken,
  getConnectorAuthorization,
  getConnectorOAuthConfig,
  getUserConnectorAccount,
  refreshConnectorAccessToken,
  releaseConnectorRefreshLease,
  upsertConnectorAuthorization,
  upsertUserConnectorAccount,
};

const SEND_SCOPE: Record<FollowUpMailProvider, string> = {
  gmail: "email.messages.send",
  outlook: "mail.messages.send",
};

function providerLabel(provider: FollowUpMailProvider) {
  return provider === "gmail" ? "Gmail" : "Outlook";
}

function parseScopes(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
  } catch {
    return [];
  }
}

export function normalizeFollowUpRecipient(value: string) {
  const recipient = value.trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || /[\r\n]/.test(recipient)) {
    throw new Error("Enter one valid recipient email address before sending the follow-up.");
  }
  return recipient;
}

function headerValue(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

const GENERIC_DELIVERY_FAILURE = "Mailbox delivery could not be completed.";

export type FollowUpDeliveryPurpose = "routine_follow_up" | "employer_reply" | "employer_clarification";

function getFollowUpDeliveryPurpose(payload: string | null | undefined): FollowUpDeliveryPurpose {
  try {
    const value = payload ? JSON.parse(payload)?.purpose : null;
    return value === "employer_reply" || value === "employer_clarification"
      ? value
      : "routine_follow_up";
  } catch {
    return "routine_follow_up";
  }
}

export function assertFollowUpApprovalMatchesDraft(message: string, approvalPayload: string | null | undefined) {
  let approvedMessage: unknown;
  try {
    approvedMessage = approvalPayload ? JSON.parse(approvalPayload)?.message : null;
  } catch {
    approvedMessage = null;
  }
  if (typeof approvedMessage !== "string" || approvedMessage !== message) {
    throw new Error("This follow-up changed after approval. Recreate the draft and request fresh approval before sending.");
  }
}

export function resolveFollowUpDeliveryDetails(input: {
  requestedRecipient: string;
  applicationStatus: string;
  jobIsActive: number;
  jobEmail: string | null;
  jobTitle: string;
  company: string;
  approvalPayload: string | null;
}) {
  const requestedRecipient = normalizeFollowUpRecipient(input.requestedRecipient);
  const purpose = getFollowUpDeliveryPurpose(input.approvalPayload);

  if (purpose === "employer_clarification") {
    if (input.applicationStatus !== "pending") {
      throw new Error("Compensation clarification can only be sent before an application is submitted.");
    }
    if (input.jobIsActive !== 1) {
      throw new Error("The job listing is no longer active; review it before contacting the employer.");
    }
    const listedRecipient = normalizeFollowUpRecipient(input.jobEmail || "");
    if (requestedRecipient !== listedRecipient) {
      throw new Error("The recipient must exactly match the email address listed on this job.");
    }
    return {
      purpose,
      recipient: listedRecipient,
      subject: headerValue(`Compensation question regarding ${input.jobTitle} at ${input.company}`).slice(0, 500),
    };
  }

  if (!["applied", "viewed", "interview"].includes(input.applicationStatus)) {
    throw new Error("This application is no longer eligible for an external follow-up.");
  }
  return {
    purpose,
    recipient: requestedRecipient,
    subject: headerValue(`Follow-up regarding ${input.jobTitle} at ${input.company}`).slice(0, 500),
  };
}

function failureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/[\r\n]+/g, " ").trim();

  // Only retain provider outcomes produced by this module. Transport, OAuth,
  // and persistence exceptions can include sensitive request details and must
  // never become ledger evidence or client-visible error text.
  if (/^(Gmail|Outlook) rejected the follow-up delivery \(\d{3}\)\.$/.test(normalized)) {
    return normalized;
  }
  if (/^(Gmail|Outlook) accepted the request without a deterministic message identifier\.$/.test(normalized)) {
    return normalized;
  }
  return GENERIC_DELIVERY_FAILURE;
}

async function getMailAccess(
  userId: number,
  provider: FollowUpMailProvider,
  now: Date,
  fetcher: typeof fetch,
  dependencies: FollowUpMailDeliveryDependencies
) {
  const account = await dependencies.getUserConnectorAccount(userId, provider);
  if (
    !account ||
    account.status !== "connected" ||
    !parseScopes(account.consentScopes).includes(SEND_SCOPE[provider]) ||
    isConnectorAuthorizationStale(account.lastVerifiedAt, now)
  ) {
    throw new Error(`${providerLabel(provider)} must be freshly authorized with explicit send consent before Hire.AI can deliver a follow-up.`);
  }
  const authorization = await dependencies.getConnectorAuthorization(userId, provider);
  if (!authorization) {
    await markMailAccessNeedsReauth(userId, account, dependencies);
    throw new Error(`${providerLabel(provider)} authorization is unavailable. Reauthorize before sending a follow-up.`);
  }
  try {
    const accessToken = await getUsableConnectorAccessToken({
      userId,
      provider,
      authorization,
      now,
      fetcher,
      consentScopes: [SEND_SCOPE[provider]],
      dependencies,
    });
    return { accessToken, account };
  } catch (error) {
    if (error instanceof ConnectorAccessTokenError && error.reason === "expired") {
      await markMailAccessNeedsReauth(userId, account, dependencies);
      throw new Error(`${providerLabel(provider)} authorization has expired. Reauthorize before sending a follow-up.`);
    }
    if (error instanceof ConnectorAccessTokenError && error.reason === "renewal_not_configured") {
      throw new Error(`${providerLabel(provider)} token renewal is not configured in this deployment.`);
    }
    throw error;
  }
}

export async function getAuthorizedMailAccess(
  userId: number,
  provider: FollowUpMailProvider,
  options: { now?: Date; fetcher?: typeof fetch } = {}
) {
  return await getMailAccess(
    userId,
    provider,
    options.now ?? new Date(),
    options.fetcher ?? fetch,
    defaults
  );
}

async function markMailAccessNeedsReauth(
  userId: number,
  account: NonNullable<Awaited<ReturnType<typeof getUserConnectorAccount>>>,
  dependencies: FollowUpMailDeliveryDependencies
) {
  await dependencies.upsertUserConnectorAccount({
    userId,
    provider: account.provider,
    status: "needs_reauth",
    consentScopes: account.consentScopes,
    externalAccountLabel: account.externalAccountLabel,
    connectionRequestedAt: account.connectionRequestedAt,
    lastVerifiedAt: account.lastVerifiedAt,
    disconnectedAt: null,
  });
}

export async function markAuthorizedMailAccessNeedsReauth(
  userId: number,
  account: NonNullable<Awaited<ReturnType<typeof getUserConnectorAccount>>>
) {
  await markMailAccessNeedsReauth(userId, account, defaults);
}

export async function sendFollowUpProviderMessage(
  provider: FollowUpMailProvider,
  accessToken: string,
  recipient: string,
  subject: string,
  message: string,
  fetcher: typeof fetch,
  attachment?: { fileName: string; mimeType: string; bytes: Uint8Array }
) {
  if (provider === "gmail") {
    const rawMessage = attachment
      ? buildMultipartMailMessage(recipient, subject, message, attachment)
      : [
          `To: ${recipient}`,
          `Subject: ${subject}`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=UTF-8",
          "",
          message,
        ].join("\r\n");
    const raw = Buffer.from(rawMessage, "utf8").toString("base64url");
    const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", providerRequestInit({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }));
    if (!response.ok) {
      throw new FollowUpProviderRejectionError(
        `Gmail rejected the follow-up delivery (${response.status}).`,
        isAuthoritativeInvalidConnectorToken(response),
        response.status
      );
    }
    const payload = await readProviderJson<{ id?: unknown }>(response);
    if (typeof payload.id !== "string" || !payload.id) {
      throw new Error("Gmail accepted the request without a deterministic message identifier.");
    }
    return { messageId: payload.id, confirmation: `Gmail accepted the approved email with message ID ${payload.id}.` };
  }

  const response = await fetcher("https://graph.microsoft.com/v1.0/me/sendMail", providerRequestInit({
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "Text", content: message },
        toRecipients: [{ emailAddress: { address: recipient } }],
        ...(attachment ? {
          attachments: [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.fileName,
            contentType: attachment.mimeType,
            contentBytes: Buffer.from(attachment.bytes).toString("base64"),
          }],
        } : {}),
      },
      saveToSentItems: true,
    }),
  }));
  if (!response.ok) {
    throw new FollowUpProviderRejectionError(
      `Outlook rejected the follow-up delivery (${response.status}).`,
      isAuthoritativeInvalidConnectorToken(response),
      response.status
    );
  }
  return { messageId: null, confirmation: "Outlook accepted the approved email for delivery and saved it to Sent Items." };
}

function encodeMimeBase64(value: Uint8Array) {
  return Buffer.from(value).toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function encodeMimeFilename(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function buildMultipartMailMessage(
  recipient: string,
  subject: string,
  message: string,
  attachment: { fileName: string; mimeType: string; bytes: Uint8Array },
  boundary = `hire-ai-${randomUUID()}`
) {
  const safeRecipient = normalizeFollowUpRecipient(recipient);
  const safeSubject = headerValue(subject);
  const safeFileName = attachment.fileName.replace(/[\r\n\\/\0]/g, "_").slice(0, 255) || "resume";
  const safeMimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(attachment.mimeType)
    ? attachment.mimeType
    : "application/octet-stream";
  return [
    `To: ${safeRecipient}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message,
    `--${boundary}`,
    `Content-Type: ${safeMimeType}; name=\"${encodeMimeFilename(safeFileName)}\"`,
    `Content-Disposition: attachment; filename=\"${encodeMimeFilename(safeFileName)}\"`,
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBase64(attachment.bytes),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function reserveDelivery(
  input: SendApprovedFollowUpInput,
  recipient: string,
  attemptKey: string
) {
  const db = await getDb();
  if (!db) throw new Error("Connected mailbox delivery requires durable database storage.");

  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        followUpId: followUps.id,
        applicationId: followUps.applicationId,
        message: followUps.message,
        sentDate: followUps.sentDate,
        deliveryState: followUps.deliveryState,
        applicationStatus: applications.status,
        jobTitle: jobs.title,
        company: jobs.company,
        jobIsActive: jobs.isActive,
        jobEmail: jobs.applicationEmail,
      })
      .from(followUps)
      .innerJoin(applications, eq(followUps.applicationId, applications.id))
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(and(eq(followUps.id, input.followUpId), eq(applications.userId, input.userId)))
      .limit(1);
    const followUp = rows[0];
    if (!followUp) throw new Error("Follow-up not found.");
    if (followUp.sentDate || followUp.deliveryState === "sent") {
      return { alreadySent: true as const, applicationId: followUp.applicationId };
    }
    if (["sending", "unknown"].includes(followUp.deliveryState)) {
      throw new Error("This follow-up already has an in-progress or uncertain external delivery. Do not retry it; confirm delivery manually after checking the mailbox.");
    }
    if (!followUp.message?.trim()) throw new Error("This follow-up has no message to send.");

    const approvals = await tx
      .select({ id: applicationApprovals.id, status: applicationApprovals.status, payload: applicationApprovals.payload })
      .from(applicationApprovals)
      .where(and(
        eq(applicationApprovals.userId, input.userId),
        eq(applicationApprovals.entityType, "follow_up"),
        eq(applicationApprovals.entityId, input.followUpId),
        eq(applicationApprovals.approvalType, "follow_up_send")
      ))
      .orderBy(desc(applicationApprovals.createdAt))
      .limit(1);
    if (!approvals[0] || approvals[0].status !== "approved") {
      throw new Error("Approve this follow-up before asking Hire.AI to send it.");
    }
    assertFollowUpApprovalMatchesDraft(followUp.message, approvals[0].payload);

    const delivery = resolveFollowUpDeliveryDetails({
      requestedRecipient: recipient,
      applicationStatus: followUp.applicationStatus,
      jobIsActive: followUp.jobIsActive ?? 0,
      jobEmail: followUp.jobEmail,
      jobTitle: followUp.jobTitle,
      company: followUp.company,
      approvalPayload: approvals[0].payload,
    });
    const subject = delivery.subject;
    const claimed = await tx
      .update(followUps)
      .set({
        deliveryProvider: input.provider,
        deliveryState: "sending",
        deliveryRecipient: recipient,
        deliverySubject: subject,
        deliveryAttemptKey: attemptKey,
        deliveryFailureMessage: null,
      })
      .where(and(
        eq(followUps.id, input.followUpId),
        isNull(followUps.sentDate),
        inArray(followUps.deliveryState, ["draft", "failed"])
      ));
    if (Number(claimed[0].affectedRows) !== 1) {
      throw new Error("Follow-up delivery changed concurrently. Refresh the ledger before retrying.");
    }
    return {
      alreadySent: false as const,
      approvalId: approvals[0].id,
      applicationId: followUp.applicationId,
      message: followUp.message,
      subject,
      recipient: delivery.recipient,
    };
  });
}

async function recordKnownDeliveryFailure(
  input: SendApprovedFollowUpInput,
  attemptKey: string,
  reason: string
) {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ applicationId: followUps.applicationId })
      .from(followUps)
      .innerJoin(applications, eq(followUps.applicationId, applications.id))
      .where(and(eq(followUps.id, input.followUpId), eq(applications.userId, input.userId)))
      .limit(1);
    if (!rows[0]) return;
    await tx
      .update(followUps)
      .set({ deliveryState: "failed", deliveryFailureMessage: reason })
      .where(and(eq(followUps.id, input.followUpId), eq(followUps.deliveryAttemptKey, attemptKey), eq(followUps.deliveryState, "sending")));
    await tx.insert(auditEvents).values({
      userId: input.userId,
      entityType: "application",
      entityId: rows[0].applicationId,
      action: "follow_up_mail_delivery_failed",
      actor: "user",
      source: `followUpMailDelivery.${input.provider}`,
      afterState: JSON.stringify({ followUpId: input.followUpId, provider: input.provider, recipient: input.recipient, reason, externalMessageSent: false }),
      riskLevel: "high",
    });
  });
}

async function recordUncertainDeliveryOutcome(
  input: SendApprovedFollowUpInput,
  attemptKey: string,
  reason: string
) {
  const db = await getDb();
  if (!db) return;

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ applicationId: followUps.applicationId })
      .from(followUps)
      .innerJoin(applications, eq(followUps.applicationId, applications.id))
      .where(and(eq(followUps.id, input.followUpId), eq(applications.userId, input.userId)))
      .limit(1);
    if (!rows[0]) return;

    const updated = await tx
      .update(followUps)
      .set({ deliveryState: "unknown", deliveryFailureMessage: reason })
      .where(and(
        eq(followUps.id, input.followUpId),
        eq(followUps.deliveryAttemptKey, attemptKey),
        eq(followUps.deliveryState, "sending")
      ));
    if (Number(updated[0].affectedRows) !== 1) return;
    await tx.insert(auditEvents).values({
      userId: input.userId,
      entityType: "application",
      entityId: rows[0].applicationId,
      action: "follow_up_mail_delivery_uncertain",
      actor: "user",
      source: `followUpMailDelivery.${input.provider}`,
      afterState: JSON.stringify({
        followUpId: input.followUpId,
        provider: input.provider,
        recipient: input.recipient,
        reason,
        externalMessageSent: "unknown",
        retryBlocked: true,
      }),
      riskLevel: "high",
    });
  });
}

export async function sendApprovedFollowUp(
  input: SendApprovedFollowUpInput,
  options: { fetcher?: typeof fetch; now?: Date; dependencies?: FollowUpMailDeliveryDependencies } = {}
) {
  const recipient = normalizeFollowUpRecipient(input.recipient);
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const dependencies = options.dependencies ?? defaults;
  const attemptKey = randomUUID();
  const reservation = await reserveDelivery(input, recipient, attemptKey);
  if (reservation.alreadySent) return { success: true, existing: true, applicationId: reservation.applicationId };

  let access: Awaited<ReturnType<typeof getMailAccess>>;
  try {
    access = await getMailAccess(input.userId, input.provider, now, fetcher, dependencies);
  } catch (error) {
    const reason = failureMessage(error);
    await recordKnownDeliveryFailure(input, attemptKey, reason);
    throw new Error(reason);
  }

  let providerResult: { messageId: string | null; confirmation: string };
  try {
    providerResult = await sendFollowUpProviderMessage(input.provider, access.accessToken, reservation.recipient, reservation.subject, reservation.message, fetcher);
  } catch (error) {
    const reason = failureMessage(error);
    // An accepted message without an identifier may already have been sent.
    // Only an explicit rejection is safe to classify as a known failure.
    if (error instanceof FollowUpProviderRejectionError) {
      if (error.authorizationRejected) {
        await markMailAccessNeedsReauth(input.userId, access.account, dependencies);
      }
      await recordKnownDeliveryFailure(input, attemptKey, reason);
      throw new Error(reason);
    }
    await recordUncertainDeliveryOutcome(input, attemptKey, reason);
    throw new Error(`Follow-up delivery outcome is uncertain. Do not retry. Check ${providerLabel(input.provider)} and confirm delivery manually. ${reason}`);
  }

  const db = await getDb();
  if (!db) throw new Error("Mailbox accepted the follow-up, but durable ledger storage is unavailable. Do not retry; confirm delivery manually.");
  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(followUps)
        .set({
          sentDate: now,
          deliveryState: "sent",
          deliveryMessageId: providerResult.messageId,
          deliveryConfirmation: providerResult.confirmation,
          deliveryFailureMessage: null,
        })
        .where(and(eq(followUps.id, input.followUpId), eq(followUps.deliveryAttemptKey, attemptKey), eq(followUps.deliveryState, "sending")));
      if (Number(updated[0].affectedRows) !== 1) {
        throw new Error("Mailbox accepted the follow-up, but the ledger delivery state changed concurrently.");
      }
      await tx.update(applications).set({ lastActivity: now }).where(eq(applications.id, reservation.applicationId));
      await tx.insert(auditEvents).values({
        userId: input.userId,
        entityType: "application",
        entityId: reservation.applicationId,
        action: "follow_up_sent_via_connected_mailbox",
        actor: "user",
        source: `followUpMailDelivery.${input.provider}`,
        afterState: JSON.stringify({
          followUpId: input.followUpId,
          provider: input.provider,
          recipient,
          messageId: providerResult.messageId,
          sentAt: now.toISOString(),
          externalMessageSent: true,
        }),
        riskLevel: "high",
        approvalId: reservation.approvalId,
      });
    });
  } catch (error) {
    await recordUncertainDeliveryOutcome(input, attemptKey, failureMessage(error));
    throw new Error(`Mailbox accepted the follow-up, but Hire.AI could not finalize its ledger. Do not retry; confirm delivery manually. ${failureMessage(error)}`);
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
