import { and, eq, inArray } from "drizzle-orm";
import {
  applications,
  interviewCalendarSyncs,
  interviewSchedules,
  jobs,
} from "../drizzle/schema";
import { getDb } from "./db";

export type InterviewCalendarProvider = "gmail" | "outlook";
export type InterviewCalendarStatus =
  "pending" | "synced" | "failed" | "unknown" | "cancelled";
export type InterviewCalendarErrorCode =
  "provider_rejected" | "network_failure" | "credential_unavailable";

export type InterviewCalendarDetails = {
  id: number;
  applicationId: number;
  interviewType: string;
  scheduledAt: Date;
  duration: number | null;
  location: string | null;
  meetingLink: string | null;
  interviewerName: string | null;
  interviewerTitle: string | null;
  status: string | null;
  jobTitle: string;
  company: string;
};

export type InterviewCalendarSyncRecord = {
  id: number;
  userId: number;
  interviewId: number;
  provider: InterviewCalendarProvider;
  status: InterviewCalendarStatus;
  providerEventId: string | null;
  idempotencyKey: string;
  lastErrorCode: InterviewCalendarErrorCode | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  syncedAt: Date | null;
  updatedAt: Date;
};

export type CalendarSyncAction = "upsert" | "cancel";
export type CalendarSyncClaim =
  | { kind: "claimed"; record: InterviewCalendarSyncRecord }
  | { kind: "noop"; record: InterviewCalendarSyncRecord | null }
  | { kind: "in_progress" }
  | { kind: "uncertain"; recovered?: boolean };

const PENDING_RECOVERY_WINDOW_MS = 2 * 60_000;

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new Error("Calendar sync requires persistent database storage.");
  return db;
}

export async function getInterviewCalendarDetails(
  userId: number,
  interviewId: number
) {
  const db = await requireDb();
  const rows = await db
    .select({
      id: interviewSchedules.id,
      applicationId: interviewSchedules.applicationId,
      interviewType: interviewSchedules.interviewType,
      scheduledAt: interviewSchedules.scheduledAt,
      duration: interviewSchedules.duration,
      location: interviewSchedules.location,
      meetingLink: interviewSchedules.meetingLink,
      interviewerName: interviewSchedules.interviewerName,
      interviewerTitle: interviewSchedules.interviewerTitle,
      status: interviewSchedules.status,
      jobTitle: jobs.title,
      company: jobs.company,
    })
    .from(interviewSchedules)
    .innerJoin(
      applications,
      eq(interviewSchedules.applicationId, applications.id)
    )
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(
      and(
        eq(interviewSchedules.id, interviewId),
        eq(applications.userId, userId)
      )
    )
    .limit(1);
  return rows[0] as InterviewCalendarDetails | undefined;
}

export async function getInterviewCalendarSync(
  userId: number,
  interviewId: number,
  provider: InterviewCalendarProvider
) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(interviewCalendarSyncs)
    .where(
      and(
        eq(interviewCalendarSyncs.userId, userId),
        eq(interviewCalendarSyncs.interviewId, interviewId),
        eq(interviewCalendarSyncs.provider, provider)
      )
    )
    .limit(1);
  return rows[0] as InterviewCalendarSyncRecord | undefined;
}

export async function listInterviewCalendarSyncs(
  userId: number,
  interviewIds: number[]
) {
  if (interviewIds.length === 0) return [];
  const db = await requireDb();
  return await db
    .select({
      interviewId: interviewCalendarSyncs.interviewId,
      provider: interviewCalendarSyncs.provider,
      status: interviewCalendarSyncs.status,
      lastErrorCode: interviewCalendarSyncs.lastErrorCode,
      attemptCount: interviewCalendarSyncs.attemptCount,
      lastAttemptAt: interviewCalendarSyncs.lastAttemptAt,
      syncedAt: interviewCalendarSyncs.syncedAt,
    })
    .from(interviewCalendarSyncs)
    .innerJoin(
      interviewSchedules,
      eq(interviewCalendarSyncs.interviewId, interviewSchedules.id)
    )
    .innerJoin(
      applications,
      eq(interviewSchedules.applicationId, applications.id)
    )
    .where(
      and(
        eq(interviewCalendarSyncs.userId, userId),
        eq(applications.userId, userId),
        inArray(interviewCalendarSyncs.interviewId, interviewIds)
      )
    );
}

async function claimInterviewCalendarSyncOnce(input: {
  userId: number;
  interviewId: number;
  provider: InterviewCalendarProvider;
  idempotencyKey: string;
  action: CalendarSyncAction;
  confirmedNoDuplicate: boolean;
  now: Date;
}): Promise<CalendarSyncClaim> {
  const db = await requireDb();
  return await db.transaction(async tx => {
    let reservationCreated = false;
    if (input.action === "upsert") {
      const reservation = await tx
        .insert(interviewCalendarSyncs)
        .ignore()
        .values({
          userId: input.userId,
          interviewId: input.interviewId,
          provider: input.provider,
          status: "pending",
          idempotencyKey: input.idempotencyKey,
          attemptCount: 1,
          lastAttemptAt: input.now,
        });
      reservationCreated = Number(reservation[0].affectedRows) === 1;
    }

    const rows = await tx
      .select()
      .from(interviewCalendarSyncs)
      .where(
        and(
          eq(interviewCalendarSyncs.userId, input.userId),
          eq(interviewCalendarSyncs.interviewId, input.interviewId),
          eq(interviewCalendarSyncs.provider, input.provider)
        )
      )
      .limit(1)
      .for("update");
    let current = rows[0] as InterviewCalendarSyncRecord | undefined;

    if (!current) {
      if (input.action === "cancel") return { kind: "noop", record: null };
      throw new Error("Calendar sync reservation was not persisted.");
    }
    if (reservationCreated) return { kind: "claimed", record: current };

    if (current.status === "pending") {
      const staleBefore = new Date(
        input.now.getTime() - PENDING_RECOVERY_WINDOW_MS
      );
      if (!current.lastAttemptAt || current.lastAttemptAt > staleBefore)
        return { kind: "in_progress" };
      await tx
        .update(interviewCalendarSyncs)
        .set({ status: "unknown", lastErrorCode: "network_failure" })
        .where(eq(interviewCalendarSyncs.id, current.id));
      return { kind: "uncertain", recovered: true };
    }

    if (input.action === "cancel" && current.status === "cancelled") {
      return { kind: "noop", record: current };
    }
    if (
      input.action === "upsert" &&
      current.status === "unknown" &&
      !input.confirmedNoDuplicate
    ) {
      return { kind: "uncertain" };
    }
    if (
      input.action === "cancel" &&
      current.status === "unknown" &&
      !current.providerEventId &&
      input.provider === "outlook" &&
      !input.confirmedNoDuplicate
    ) {
      return { kind: "uncertain" };
    }
    if (input.action === "cancel" && !current.providerEventId) {
      if (
        current.status === "unknown" &&
        input.provider === "outlook" &&
        !input.confirmedNoDuplicate
      ) {
        return { kind: "uncertain" };
      }
      if (input.provider === "gmail" && current.status === "unknown") {
        await tx
          .update(interviewCalendarSyncs)
          .set({
            status: "pending",
            lastErrorCode: null,
            attemptCount: current.attemptCount + 1,
            lastAttemptAt: input.now,
          })
          .where(eq(interviewCalendarSyncs.id, current.id));
        return {
          kind: "claimed",
          record: {
            ...current,
            status: "pending",
            attemptCount: current.attemptCount + 1,
            lastAttemptAt: input.now,
          },
        };
      }
      await tx
        .update(interviewCalendarSyncs)
        .set({ status: "cancelled", lastErrorCode: null, syncedAt: null })
        .where(eq(interviewCalendarSyncs.id, current.id));
      return { kind: "noop", record: { ...current, status: "cancelled" } };
    }

    await tx
      .update(interviewCalendarSyncs)
      .set({
        status: "pending",
        lastErrorCode: null,
        attemptCount: current.attemptCount + 1,
        lastAttemptAt: input.now,
      })
      .where(eq(interviewCalendarSyncs.id, current.id));
    return {
      kind: "claimed",
      record: {
        ...current,
        status: "pending",
        attemptCount: current.attemptCount + 1,
        lastAttemptAt: input.now,
      },
    };
  });
}

function isCalendarClaimRace(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
    String(error.code)
  );
}

export async function claimInterviewCalendarSync(input: {
  userId: number;
  interviewId: number;
  provider: InterviewCalendarProvider;
  idempotencyKey: string;
  action: CalendarSyncAction;
  confirmedNoDuplicate: boolean;
  now: Date;
}): Promise<CalendarSyncClaim> {
  try {
    return await claimInterviewCalendarSyncOnce(input);
  } catch (error) {
    if (!isCalendarClaimRace(error)) throw error;
    // The failed transaction has released its locks. Retry once so the normal
    // row lock observes the winner or reserves the key if it rolled back.
    return await claimInterviewCalendarSyncOnce(input);
  }
}

export async function finishInterviewCalendarSync(input: {
  userId: number;
  interviewId: number;
  provider: InterviewCalendarProvider;
  status: Exclude<InterviewCalendarStatus, "pending">;
  providerEventId?: string | null;
  lastErrorCode?: InterviewCalendarErrorCode | null;
  now: Date;
}) {
  const db = await requireDb();
  const result = await db
    .update(interviewCalendarSyncs)
    .set({
      status: input.status,
      providerEventId: input.providerEventId,
      lastErrorCode: input.lastErrorCode ?? null,
      syncedAt: input.status === "synced" ? input.now : null,
    })
    .where(
      and(
        eq(interviewCalendarSyncs.userId, input.userId),
        eq(interviewCalendarSyncs.interviewId, input.interviewId),
        eq(interviewCalendarSyncs.provider, input.provider),
        eq(interviewCalendarSyncs.status, "pending")
      )
    );
  if (Number(result[0].affectedRows) !== 1) {
    throw new Error(
      "Calendar sync state changed before the provider result could be recorded."
    );
  }
}
