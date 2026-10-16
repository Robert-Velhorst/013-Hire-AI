import { createHash } from "node:crypto";
import { isConnectorAuthorizationStale } from "@shared/profileEvidence";
import {
  decryptConnectorToken,
  getConnectorOAuthConfig,
  type OAuthConnectorProvider,
} from "./connectorOAuth";
import {
  ConnectorAccessTokenError,
  getUsableConnectorAccessToken,
} from "./connectorAccessToken";
import {
  createAuditEvent,
  getConnectorAuthorization,
  getUserConnectorAccount,
  upsertUserConnectorAccount,
} from "./db";
import { isAuthoritativeInvalidConnectorToken } from "./connectorAuthorization";
import { providerRequestInit, readProviderJson } from "./_core/providerRequest";
import {
  claimInterviewCalendarSync,
  finishInterviewCalendarSync,
  getInterviewCalendarDetails,
  getInterviewCalendarSync,
  listInterviewCalendarSyncs,
  type CalendarSyncAction,
  type InterviewCalendarDetails,
  type InterviewCalendarErrorCode,
  type InterviewCalendarProvider,
  type InterviewCalendarSyncRecord,
} from "./interviewCalendarSyncStore";

const CALENDAR_CONSENT_SCOPE = "calendar.events.write";
const PROVIDER_CALENDAR_SCOPE: Record<InterviewCalendarProvider, string> = {
  gmail: "https://www.googleapis.com/auth/calendar.events",
  outlook: "Calendars.ReadWrite",
};

export type CalendarSyncDependencies = {
  claimInterviewCalendarSync: typeof claimInterviewCalendarSync;
  createAuditEvent: typeof createAuditEvent;
  decryptConnectorToken: typeof decryptConnectorToken;
  finishInterviewCalendarSync: typeof finishInterviewCalendarSync;
  getConnectorAuthorization: typeof getConnectorAuthorization;
  getInterviewCalendarDetails: typeof getInterviewCalendarDetails;
  getInterviewCalendarSync: typeof getInterviewCalendarSync;
  getUserConnectorAccount: typeof getUserConnectorAccount;
  getUsableConnectorAccessToken: typeof getUsableConnectorAccessToken;
  isConnectorAuthorizationStale: typeof isConnectorAuthorizationStale;
  isAuthoritativeInvalidConnectorToken: typeof isAuthoritativeInvalidConnectorToken;
  listInterviewCalendarSyncs: typeof listInterviewCalendarSyncs;
  providerRequestInit: typeof providerRequestInit;
  readProviderJson: typeof readProviderJson;
  upsertUserConnectorAccount: typeof upsertUserConnectorAccount;
  fetcher: typeof fetch;
  now: () => Date;
};

const defaults: CalendarSyncDependencies = {
  claimInterviewCalendarSync,
  createAuditEvent,
  decryptConnectorToken,
  finishInterviewCalendarSync,
  getConnectorAuthorization,
  getInterviewCalendarDetails,
  getInterviewCalendarSync,
  getUserConnectorAccount,
  getUsableConnectorAccessToken,
  isConnectorAuthorizationStale,
  isAuthoritativeInvalidConnectorToken,
  listInterviewCalendarSyncs,
  providerRequestInit,
  readProviderJson,
  upsertUserConnectorAccount,
  fetcher: fetch,
  now: () => new Date(),
};

export class InterviewCalendarSyncError extends Error {
  constructor(
    readonly code:
      "NOT_FOUND" | "PRECONDITION" | "CONFLICT" | "PROVIDER" | "UNKNOWN",
    message: string
  ) {
    super(message);
    this.name = "InterviewCalendarSyncError";
  }
}

function parseScopes(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((scope): scope is string => typeof scope === "string")
      : [];
  } catch {
    return [];
  }
}

function providerEventId(idempotencyKey: string) {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}

function providerTransactionId(idempotencyKey: string) {
  const hex = createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function safeMeetingUrl(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function getEventTimes(interview: InterviewCalendarDetails) {
  const start = interview.scheduledAt;
  const duration = interview.duration ?? 60;
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isInteger(duration) ||
    duration < 5 ||
    duration > 480
  ) {
    throw new InterviewCalendarSyncError(
      "PRECONDITION",
      "Interview time or duration is invalid. Update the interview before syncing it."
    );
  }
  return { start, end: new Date(start.getTime() + duration * 60_000) };
}

export function buildGoogleCalendarEvent(
  interview: InterviewCalendarDetails,
  idempotencyKey: string
) {
  const { start, end } = getEventTimes(interview);
  const interviewer = [interview.interviewerName, interview.interviewerTitle]
    .filter(Boolean)
    .join(", ");
  return {
    id: providerEventId(idempotencyKey),
    summary: ["Interview", interview.company, interview.jobTitle]
      .filter(Boolean)
      .join(" - "),
    description: [
      `Interview type: ${interview.interviewType}`,
      interviewer ? `Interviewer: ${interviewer}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    ...(interview.location ? { location: interview.location } : {}),
    ...(safeMeetingUrl(interview.meetingLink)
      ? {
          source: {
            title: "Meeting link",
            url: safeMeetingUrl(interview.meetingLink),
          },
        }
      : {}),
    visibility: "private",
    extendedProperties: { private: { hireAiIdempotencyKey: idempotencyKey } },
  };
}

export function buildOutlookCalendarEvent(
  interview: InterviewCalendarDetails,
  idempotencyKey: string
) {
  const { start, end } = getEventTimes(interview);
  const meetingUrl = safeMeetingUrl(interview.meetingLink);
  const interviewer = [interview.interviewerName, interview.interviewerTitle]
    .filter(Boolean)
    .join(", ");
  return {
    subject: ["Interview", interview.company, interview.jobTitle]
      .filter(Boolean)
      .join(" - "),
    body: {
      contentType: "Text",
      content: [
        `Interview type: ${interview.interviewType}`,
        interviewer ? `Interviewer: ${interviewer}` : "",
        meetingUrl ? `Meeting link: ${meetingUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    start: { dateTime: start.toISOString(), timeZone: "UTC" },
    end: { dateTime: end.toISOString(), timeZone: "UTC" },
    ...(interview.location
      ? { location: { displayName: interview.location } }
      : {}),
    sensitivity: "private",
    transactionId: providerTransactionId(idempotencyKey),
  };
}

function genericFailureMessage(provider: InterviewCalendarProvider) {
  return `${provider === "gmail" ? "Google Calendar" : "Outlook Calendar"} could not confirm the event update. Refresh the calendar status before trying again.`;
}

async function markNeedsReauth(
  userId: number,
  account: NonNullable<Awaited<ReturnType<typeof getUserConnectorAccount>>>,
  dependencies: CalendarSyncDependencies
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

async function getCalendarAccess(
  userId: number,
  provider: InterviewCalendarProvider,
  now: Date,
  dependencies: CalendarSyncDependencies
) {
  const account = await dependencies.getUserConnectorAccount(userId, provider);
  if (
    !account ||
    account.status !== "connected" ||
    !parseScopes(account.consentScopes).includes(CALENDAR_CONSENT_SCOPE) ||
    dependencies.isConnectorAuthorizationStale(account.lastVerifiedAt, now)
  ) {
    throw new InterviewCalendarSyncError(
      "PRECONDITION",
      `${provider === "gmail" ? "Gmail" : "Outlook"} must be connected and freshly authorized for calendar access in Profile.`
    );
  }
  const authorization = await dependencies.getConnectorAuthorization(
    userId,
    provider
  );
  if (!authorization) {
    await markNeedsReauth(userId, account, dependencies);
    throw new InterviewCalendarSyncError(
      "PRECONDITION",
      "Calendar authorization is unavailable. Reconnect the provider in Profile."
    );
  }
  if (
    !parseScopes(authorization.grantedScopes).includes(
      PROVIDER_CALENDAR_SCOPE[provider]
    )
  ) {
    await markNeedsReauth(userId, account, dependencies);
    throw new InterviewCalendarSyncError(
      "PRECONDITION",
      "The provider did not grant calendar-write access. Reconnect and approve calendar access in Profile."
    );
  }
  try {
    const accessToken = await dependencies.getUsableConnectorAccessToken({
      userId,
      provider: provider as OAuthConnectorProvider,
      authorization,
      now,
      fetcher: dependencies.fetcher,
      consentScopes: [CALENDAR_CONSENT_SCOPE],
    });
    return { accessToken, account };
  } catch (error) {
    if (
      error instanceof ConnectorAccessTokenError &&
      error.reason === "expired"
    ) {
      await markNeedsReauth(userId, account, dependencies);
    }
    throw new InterviewCalendarSyncError(
      "PRECONDITION",
      "Calendar access could not be renewed. Reconnect the provider in Profile."
    );
  }
}

async function requestCalendarProvider(
  input: {
    userId: number;
    provider: InterviewCalendarProvider;
    interview: InterviewCalendarDetails;
    sync: InterviewCalendarSyncRecord;
    accessToken: string;
    action: CalendarSyncAction;
  },
  dependencies: CalendarSyncDependencies
) {
  const { provider, interview, sync, accessToken, action } = input;
  if (provider === "gmail") {
    const id = sync.providerEventId ?? providerEventId(sync.idempotencyKey);
    const base = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`;
    const requestInit = dependencies.providerRequestInit({
      method:
        action === "cancel"
          ? "DELETE"
          : sync.providerEventId
            ? "PATCH"
            : "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      ...(action === "upsert"
        ? {
            body: JSON.stringify(
              buildGoogleCalendarEvent(interview, sync.idempotencyKey)
            ),
          }
        : {}),
    });
    let response = await dependencies.fetcher(
      action === "cancel"
        ? base
        : sync.providerEventId
          ? base
          : "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      requestInit
    );
    let recreatingMissingEvent = false;
    if (
      action === "upsert" &&
      sync.providerEventId &&
      response.status === 404
    ) {
      recreatingMissingEvent = true;
      response = await dependencies.fetcher(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        dependencies.providerRequestInit({
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildGoogleCalendarEvent(interview, sync.idempotencyKey)
          ),
        })
      );
    }
    if (action === "cancel" && response.status === 404)
      return { status: "cancelled" as const, providerEventId: null };
    if (
      action === "upsert" &&
      response.status === 409 &&
      (!sync.providerEventId || recreatingMissingEvent)
    ) {
      const existingResponse = await dependencies.fetcher(
        base,
        dependencies.providerRequestInit({
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      );
      if (!existingResponse.ok)
        throw new ProviderCalendarResponseError(
          provider,
          existingResponse,
          dependencies
        );
      const existing = await dependencies.readProviderJson<{
        id?: unknown;
        extendedProperties?: { private?: Record<string, string> };
      }>(existingResponse);
      if (
        existing.extendedProperties?.private?.hireAiIdempotencyKey !==
          sync.idempotencyKey ||
        typeof existing.id !== "string"
      ) {
        throw new InterviewCalendarSyncError(
          "PROVIDER",
          "Google Calendar returned an event ID that does not match this interview."
        );
      }
      return { status: "synced" as const, providerEventId: existing.id };
    }
    if (!response.ok && !(action === "cancel" && response.status === 404)) {
      throw new ProviderCalendarResponseError(provider, response, dependencies);
    }
    if (action === "cancel")
      return { status: "cancelled" as const, providerEventId: null };
    const result = await dependencies.readProviderJson<{ id?: unknown }>(
      response
    );
    if (typeof result.id !== "string" || !result.id) {
      throw new InterviewCalendarSyncError(
        "UNKNOWN",
        genericFailureMessage(provider)
      );
    }
    return { status: "synced" as const, providerEventId: result.id };
  }

  const base = "https://graph.microsoft.com/v1.0/me/events";
  if (action === "cancel") {
    const response = await dependencies.fetcher(
      `${base}/${encodeURIComponent(sync.providerEventId || "")}`,
      dependencies.providerRequestInit({
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    );
    if (!response.ok && response.status !== 404)
      throw new ProviderCalendarResponseError(provider, response, dependencies);
    return { status: "cancelled" as const, providerEventId: null };
  }
  let response = await dependencies.fetcher(
    sync.providerEventId
      ? `${base}/${encodeURIComponent(sync.providerEventId)}`
      : base,
    dependencies.providerRequestInit({
      method: sync.providerEventId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildOutlookCalendarEvent(interview, sync.idempotencyKey)
      ),
    })
  );
  if (sync.providerEventId && response.status === 404) {
    response = await dependencies.fetcher(
      base,
      dependencies.providerRequestInit({
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildOutlookCalendarEvent(interview, sync.idempotencyKey)
        ),
      })
    );
  }
  if (!response.ok)
    throw new ProviderCalendarResponseError(provider, response, dependencies);
  const result = await dependencies.readProviderJson<{ id?: unknown }>(
    response
  );
  if (typeof result.id !== "string" || !result.id) {
    throw new InterviewCalendarSyncError(
      "UNKNOWN",
      genericFailureMessage(provider)
    );
  }
  return { status: "synced" as const, providerEventId: result.id };
}

class ProviderCalendarResponseError extends Error {
  constructor(
    readonly provider: InterviewCalendarProvider,
    readonly response: Response,
    readonly dependencies: CalendarSyncDependencies
  ) {
    super("Calendar provider rejected the event request.");
    this.name = "ProviderCalendarResponseError";
  }
}

async function auditResult(
  userId: number,
  interview: InterviewCalendarDetails,
  provider: InterviewCalendarProvider,
  status: string,
  errorCode: InterviewCalendarErrorCode | null,
  dependencies: CalendarSyncDependencies
) {
  await dependencies.createAuditEvent({
    userId,
    entityType: "application",
    entityId: interview.applicationId,
    action: `interview_calendar_${status}`,
    actor: "user",
    source: `interviewCalendarSync.${provider}`,
    afterState: JSON.stringify({
      interviewId: interview.id,
      provider,
      status,
      errorCode,
    }),
    riskLevel: "medium",
  });
}

export async function syncInterviewCalendar(
  input: {
    userId: number;
    interviewId: number;
    provider: InterviewCalendarProvider;
    confirmedNoDuplicate?: boolean;
  },
  overrides: Partial<CalendarSyncDependencies> = {}
) {
  const dependencies = { ...defaults, ...overrides };
  const now = dependencies.now();
  const interview = await dependencies.getInterviewCalendarDetails(
    input.userId,
    input.interviewId
  );
  if (!interview)
    throw new InterviewCalendarSyncError("NOT_FOUND", "Interview not found.");
  const action: CalendarSyncAction =
    interview.status === "cancelled" ? "cancel" : "upsert";
  if (
    action === "upsert" &&
    !["scheduled", "rescheduled"].includes(interview.status || "")
  ) {
    throw new InterviewCalendarSyncError(
      "PRECONDITION",
      "Only active scheduled interviews can be added to a calendar."
    );
  }
  if (action === "upsert" && interview.scheduledAt.getTime() <= now.getTime()) {
    throw new InterviewCalendarSyncError(
      "PRECONDITION",
      "Past interviews cannot be added to a calendar."
    );
  }
  if (action === "upsert") getEventTimes(interview);

  const idempotencyKey = `hire-ai-calendar-${input.userId}-${input.interviewId}-${input.provider}`;
  const claim = await dependencies.claimInterviewCalendarSync({
    userId: input.userId,
    interviewId: input.interviewId,
    provider: input.provider,
    idempotencyKey,
    action,
    confirmedNoDuplicate: input.confirmedNoDuplicate === true,
    now,
  });
  if (claim.kind === "in_progress") {
    throw new InterviewCalendarSyncError(
      "CONFLICT",
      "Calendar synchronization is already in progress. Refresh the interview status shortly."
    );
  }
  if (claim.kind === "uncertain") {
    if (claim.recovered) {
      await dependencies.createAuditEvent({
        userId: input.userId,
        entityType: "application",
        entityId: interview.applicationId,
        action: "interview_calendar_unknown",
        actor: "system",
        source: "interviewCalendarSync.recovery",
        afterState: JSON.stringify({
          interviewId: interview.id,
          provider: input.provider,
          status: "unknown",
          errorCode: "network_failure",
          retryBlocked: true,
        }),
        riskLevel: "medium",
      });
    }
    throw new InterviewCalendarSyncError(
      "UNKNOWN",
      "The previous calendar request has an uncertain result. Check your calendar for this interview before confirming a retry."
    );
  }
  if (claim.kind === "noop") {
    const status = claim.record?.status ?? "cancelled";
    return { status, provider: input.provider, alreadyCurrent: true };
  }

  let access: Awaited<ReturnType<typeof getCalendarAccess>>;
  try {
    access = await getCalendarAccess(
      input.userId,
      input.provider,
      now,
      dependencies
    );
  } catch (error) {
    if (
      error instanceof InterviewCalendarSyncError &&
      error.code === "PRECONDITION"
    ) {
      await dependencies.finishInterviewCalendarSync({
        userId: input.userId,
        interviewId: input.interviewId,
        provider: input.provider,
        status: "failed",
        providerEventId: claim.record.providerEventId,
        lastErrorCode: "credential_unavailable",
        now,
      });
      await auditResult(
        input.userId,
        interview,
        input.provider,
        "failed",
        "credential_unavailable",
        dependencies
      );
    }
    throw error;
  }

  let result: Awaited<ReturnType<typeof requestCalendarProvider>>;
  try {
    result = await requestCalendarProvider(
      {
        userId: input.userId,
        provider: input.provider,
        interview,
        sync: claim.record,
        accessToken: access.accessToken,
        action,
      },
      dependencies
    );
  } catch (error) {
    const providerResponse = error instanceof ProviderCalendarResponseError;
    const errorCode: InterviewCalendarErrorCode =
      providerResponse ||
      (error instanceof InterviewCalendarSyncError && error.code === "PROVIDER")
        ? "provider_rejected"
        : "network_failure";
    const failureStatus =
      error instanceof InterviewCalendarSyncError && error.code === "PROVIDER"
        ? "failed"
        : providerResponse &&
            error.response.status < 500 &&
            error.response.status !== 408 &&
            error.response.status !== 429
          ? "failed"
          : "unknown";
    if (
      providerResponse &&
      dependencies.isAuthoritativeInvalidConnectorToken(error.response)
    ) {
      await markNeedsReauth(input.userId, access.account, dependencies);
    }
    await dependencies.finishInterviewCalendarSync({
      userId: input.userId,
      interviewId: input.interviewId,
      provider: input.provider,
      status: failureStatus,
      providerEventId: claim.record.providerEventId,
      lastErrorCode: errorCode,
      now,
    });
    await auditResult(
      input.userId,
      interview,
      input.provider,
      failureStatus,
      errorCode,
      dependencies
    );
    if (error instanceof InterviewCalendarSyncError) throw error;
    if (failureStatus === "failed") {
      throw new InterviewCalendarSyncError(
        "PROVIDER",
        `${input.provider === "gmail" ? "Google Calendar" : "Outlook Calendar"} rejected the event request. Check the connection and try again.`
      );
    }
    throw new InterviewCalendarSyncError(
      "UNKNOWN",
      genericFailureMessage(input.provider)
    );
  }

  try {
    await dependencies.finishInterviewCalendarSync({
      userId: input.userId,
      interviewId: input.interviewId,
      provider: input.provider,
      status: result.status,
      providerEventId: result.providerEventId,
      now,
    });
  } catch {
    throw new InterviewCalendarSyncError(
      "UNKNOWN",
      "The provider may have updated your event, but Hire.AI could not record the result. Check your calendar before retrying."
    );
  }
  try {
    await auditResult(
      input.userId,
      interview,
      input.provider,
      result.status,
      null,
      dependencies
    );
  } catch {
    throw new InterviewCalendarSyncError(
      "UNKNOWN",
      "The calendar event was updated, but the audit record could not be confirmed. Refresh the interview status."
    );
  }
  return {
    status: result.status,
    provider: input.provider,
    alreadyCurrent: false,
  };
}

export async function getInterviewCalendarStatuses(
  userId: number,
  interviewIds: number[]
) {
  return await listInterviewCalendarSyncs(
    userId,
    Array.from(new Set(interviewIds)).slice(0, 50)
  );
}
