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
import {
  getConnectorAuthorization,
  getDb,
  getUserConnectorAccount,
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
  decryptConnectorToken: typeof decryptConnectorToken;
  encryptConnectorToken: typeof encryptConnectorToken;
  getConnectorAuthorization: typeof getConnectorAuthorization;
  getConnectorOAuthConfig: typeof getConnectorOAuthConfig;
  getUserConnectorAccount: typeof getUserConnectorAccount;
  refreshConnectorAccessToken: typeof refreshConnectorAccessToken;
  upsertConnectorAuthorization: typeof upsertConnectorAuthorization;
  upsertUserConnectorAccount: typeof upsertUserConnectorAccount;
};

const defaults: FollowUpMailDeliveryDependencies = {
  decryptConnectorToken,
  encryptConnectorToken,
  getConnectorAuthorization,
  getConnectorOAuthConfig,
  getUserConnectorAccount,
  refreshConnectorAccessToken,
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

export async function sendFollowUpProviderMessage(
  provider: FollowUpMailProvider,
  accessToken: string,
  recipient: string,
  subject: string,
  message: string,
  fetcher: typeof fetch
) {
  if (provider === "gmail") {
    const raw = Buffer.from([
      `To: ${recipient}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      message,
    ].join("\r\n"), "utf8").toString("base64url");
    const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", providerRequestInit({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }));
    if (!response.ok) throw new Error(`Gmail rejected the follow-up delivery (${response.status}).`);
    const payload = await readProviderJson<{ id?: unknown }>(response);
    if (typeof payload.id !== "string" || !payload.id) {
      throw new Error("Gmail accepted the request without a deterministic message identifier.");
    }
    return { messageId: payload.id, confirmation: `Gmail accepted the approved follow-up with message ID ${payload.id}.` };
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
      },
      saveToSentItems: true,
    }),
  }));
  if (!response.ok) throw new Error(`Outlook rejected the follow-up delivery (${response.status}).`);
  return { messageId: null, confirmation: "Outlook accepted the approved follow-up for delivery and saved it to Sent Items." };
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
    if (!["applied", "viewed", "interview"].includes(followUp.applicationStatus)) {
      throw new Error("This application is no longer eligible for an external follow-up.");
    }

    const approvals = await tx
      .select({ id: applicationApprovals.id, status: applicationApprovals.status })
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

    const subject = headerValue(`Follow-up regarding ${followUp.jobTitle} at ${followUp.company}`).slice(0, 500);
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
    providerResult = await sendFollowUpProviderMessage(input.provider, access.accessToken, recipient, reservation.subject, reservation.message, fetcher);
  } catch (error) {
    const reason = failureMessage(error);
    if (/rejected the follow-up delivery|accepted the request without/i.test(reason)) {
      if (/\((401|403)\)/.test(reason)) {
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
