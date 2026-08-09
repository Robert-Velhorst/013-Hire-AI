import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { recordEmployerResponse, scheduleInterview } from "./applicationFeatures";
import { INTERVIEW_INVITE_SOURCE_REFERENCE_REQUIRED_MESSAGE, OFFER_SOURCE_REFERENCE_REQUIRED_MESSAGE } from "./applicationResponses";
import { getAuditEventsForEntity, createApplication, getUnreadInterviewNotificationPage, getUserApplications, listUnreadInterviewNotifications, updateApplicationStatus } from "./db";
import { getUserOperatingLedger } from "./applicationCampaigns";
import { appRouter } from "./routers";

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `interview-notification-${userId}`,
      name: "Interview Notification User",
      email: `interview-notification-${userId}@example.local`,
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("interview notification ledger", () => {
  it("does not create an interview notification from an unreferenced manual invite", async () => {
    const userId = 99170;
    const application = await createApplication({ userId, jobId: 1, status: "applied" });
    const applicationId = Number(application.insertId);
    const owner = appRouter.createCaller(createContext(userId));

    await expect(owner.applications.recordResponse({
      applicationId,
      responseType: "interview_invite",
      source: "email",
      summary: "Recruiter invited the candidate to schedule a video interview.",
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: INTERVIEW_INVITE_SOURCE_REFERENCE_REQUIRED_MESSAGE,
    });

    expect(await listUnreadInterviewNotifications(userId)).toHaveLength(0);
  });

  it("does not create offer attribution work from an unreferenced manual offer", async () => {
    const userId = 99169;
    const application = await createApplication({ userId, jobId: 1, status: "applied" });
    const applicationId = Number(application.insertId);
    const owner = appRouter.createCaller(createContext(userId));

    await expect(owner.applications.recordResponse({
      applicationId,
      responseType: "offer",
      source: "email",
      summary: "Recruiter sent a written offer for the linked remote role.",
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: OFFER_SOURCE_REFERENCE_REQUIRED_MESSAGE,
    });

    expect((await getUserApplications(userId)).find((item) => item.id === applicationId)?.status).toBe("applied");
    expect((await getUserOperatingLedger(userId)).metrics.pendingOfferAttributions).toBe(0);
  });

  it("creates one unread in-app notification only for an evidence-backed interview invite", async () => {
    const userId = 99171;
    const application = await createApplication({
      userId,
      jobId: 1,
      status: "applied",
      notes: "Submission was confirmed by the applicant.",
    });
    const applicationId = Number(application.insertId);

    await recordEmployerResponse({
      applicationId,
      responseType: "employer_question",
      source: "email",
      sourceReference: "gmail-question-99171",
      summary: "Recruiter asked the candidate to clarify availability for the role.",
    }, userId);
    expect(await listUnreadInterviewNotifications(userId)).toHaveLength(0);

    const invite = {
      applicationId,
      responseType: "interview_invite" as const,
      source: "email" as const,
      sourceReference: "gmail-interview-99171",
      summary: "Recruiter invited the candidate to a video interview and requested availability.",
    };
    const first = await recordEmployerResponse(invite, userId);
    const retry = await recordEmployerResponse(invite, userId);
    const notifications = await listUnreadInterviewNotifications(userId);
    const ledger = await getUserOperatingLedger(userId);

    expect(first).toMatchObject({ success: true, existing: false, status: "interview" });
    expect(retry).toMatchObject({ success: true, existing: true, responseId: first.responseId });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      applicationId,
      employerResponseId: first.responseId,
      notificationType: "interview_invite",
      readAt: null,
    });
    expect(ledger.metrics.unreadInterviewNotifications).toBe(1);
    expect(ledger.queues.interviewNotifications).toEqual([
      expect.objectContaining({
        applicationId,
        employerResponseId: first.responseId,
        notificationType: "interview_invite",
      }),
    ]);
    expect(ledger.nextActions.some((action) => action.includes("verified interview invite"))).toBe(true);

    const auditEvents = await getAuditEventsForEntity(userId, "application", applicationId);
    expect(auditEvents.filter((event) => event.action === "interview_notification_queued")).toHaveLength(1);
  });

  it("acknowledges only the owning user's unread interview notification and records that acknowledgement", async () => {
    const userId = 99172;
    const application = await createApplication({ userId, jobId: 2, status: "applied" });
    const applicationId = Number(application.insertId);
    await recordEmployerResponse({
      applicationId,
      responseType: "interview_invite",
      source: "employer_portal",
      sourceReference: "portal-interview-99172",
      summary: "The employer portal confirmed an interview invitation for this application.",
    }, userId);
    const [notification] = await listUnreadInterviewNotifications(userId);
    const owner = appRouter.createCaller(createContext(userId));
    const otherUser = appRouter.createCaller(createContext(99173));

    await expect(otherUser.applications.markInterviewNotificationRead({ notificationId: notification.id }))
      .rejects.toThrow(/not found/i);

    const read = await owner.applications.markInterviewNotificationRead({ notificationId: notification.id });
    const retry = await owner.applications.markInterviewNotificationRead({ notificationId: notification.id });
    const auditEvents = await getAuditEventsForEntity(userId, "application", applicationId);

    expect(read).toMatchObject({ success: true, changed: true });
    expect(retry).toMatchObject({ success: true, changed: false });
    expect(await listUnreadInterviewNotifications(userId)).toHaveLength(0);
    expect(auditEvents.filter((event) => event.action === "interview_notification_read")).toHaveLength(1);
  });

  it("acknowledges pending interview invitations when the user schedules the interview", async () => {
    const userId = 99174;
    const application = await createApplication({ userId, jobId: 3, status: "applied" });
    const applicationId = Number(application.insertId);
    await recordEmployerResponse({
      applicationId,
      responseType: "interview_invite",
      source: "email",
      sourceReference: "gmail-interview-99174",
      summary: "The recruiter invited the candidate to a technical interview.",
    }, userId);
    const [notification] = await listUnreadInterviewNotifications(userId);

    await scheduleInterview({
      applicationId,
      interviewType: "technical",
      scheduledAt: new Date(Date.now() + 3 * 86_400_000),
    }, userId);

    expect(await listUnreadInterviewNotifications(userId)).toHaveLength(0);
    const auditEvents = await getAuditEventsForEntity(userId, "application", applicationId);
    expect(auditEvents.some((event) =>
      event.action === "interview_notifications_acknowledged_by_scheduling" &&
      event.afterState?.includes(String(notification.id))
    )).toBe(true);
  });

  it("retires a stale invite alert when a later employer response closes interview scheduling", async () => {
    const userId = 99175;
    const application = await createApplication({ userId, jobId: 1, status: "applied" });
    const applicationId = Number(application.insertId);
    const invite = await recordEmployerResponse({
      applicationId,
      responseType: "interview_invite",
      source: "email",
      sourceReference: "gmail-interview-99175",
      summary: "The recruiter invited the candidate to schedule a first-round interview.",
    }, userId);
    const [notification] = await listUnreadInterviewNotifications(userId);

    const rejection = await recordEmployerResponse({
      applicationId,
      responseType: "rejection",
      source: "email",
      sourceReference: "gmail-rejection-99175",
      summary: "The recruiter confirmed that the role has been filled and the process is closed.",
    }, userId);
    const ledger = await getUserOperatingLedger(userId);
    const auditEvents = await getAuditEventsForEntity(userId, "application", applicationId);

    expect(rejection).toMatchObject({
      status: "rejected",
      retiredInterviewNotificationIds: [notification.id],
    });
    expect(invite.status).toBe("interview");
    expect(await listUnreadInterviewNotifications(userId)).toHaveLength(0);
    expect(ledger.metrics.unreadInterviewNotifications).toBe(0);
    expect(ledger.queues.interviewNotifications).toEqual([]);
    expect(auditEvents.some((event) =>
      event.action === "interview_notifications_retired_after_response" &&
      event.afterState?.includes(String(notification.id)) &&
      event.afterState?.includes('"responseType":"rejection"')
    )).toBe(true);
  });

  it("keeps a verified invite visible when newer legacy alerts are stale", async () => {
    const userId = 99176;
    const activeApplication = await createApplication({ userId, jobId: 1, status: "applied" });
    const activeApplicationId = Number(activeApplication.insertId);
    const activeInvite = await recordEmployerResponse({
      applicationId: activeApplicationId,
      responseType: "interview_invite",
      source: "email",
      sourceReference: "gmail-interview-active-99176",
      summary: "Recruiter invited the candidate to a current technical interview.",
    }, userId);

    // Simulate stale records created before closure-triggered alert retirement existed.
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let index = 0; index < 5; index += 1) {
      const staleApplication = await createApplication({ userId, jobId: 20 + index, status: "applied" });
      const staleApplicationId = Number(staleApplication.insertId);
      await recordEmployerResponse({
        applicationId: staleApplicationId,
        responseType: "interview_invite",
        source: "email",
        sourceReference: `gmail-interview-stale-99176-${index}`,
        summary: "An older interview invitation was later closed by the candidate.",
      }, userId);
      await updateApplicationStatus(staleApplicationId, "withdrawn", userId);
    }

    const ledger = await getUserOperatingLedger(userId);
    expect(await listUnreadInterviewNotifications(userId)).toHaveLength(6);
    expect(ledger.queues.interviewNotifications).toEqual([
      expect.objectContaining({
        applicationId: activeApplicationId,
        employerResponseId: activeInvite.responseId,
      }),
    ]);
    expect(ledger.metrics.unreadInterviewNotifications).toBe(1);
  });

  it("keeps an exact owner-scoped total while bounding verified interview alerts", async () => {
    const userId = 99177;
    for (let index = 0; index < 7; index += 1) {
      const application = await createApplication({ userId, jobId: 100 + index, status: "applied" });
      await recordEmployerResponse({
        applicationId: Number(application.insertId),
        responseType: "interview_invite",
        source: "email",
        sourceReference: `gmail-interview-scale-99177-${index}`,
        summary: `Verified interview invitation ${index + 1}.`,
      }, userId);
    }
    const otherApplication = await createApplication({ userId: 99178, jobId: 200, status: "applied" });
    await recordEmployerResponse({
      applicationId: Number(otherApplication.insertId),
      responseType: "interview_invite",
      source: "email",
      sourceReference: "gmail-interview-other-owner-99178",
      summary: "Another user's verified interview invitation.",
    }, 99178);

    const page = await getUnreadInterviewNotificationPage(userId);
    const ledger = await getUserOperatingLedger(userId, { persistCampaign: false });

    expect(page).toMatchObject({ total: 7, limit: 5, hasMore: true });
    expect(page.items).toHaveLength(5);
    expect(page.items.every((item) => item.applicationId !== Number(otherApplication.insertId))).toBe(true);
    expect(ledger.metrics.unreadInterviewNotifications).toBe(7);
    expect(ledger.queues.interviewNotifications).toHaveLength(5);
    expect(ledger.interviewNotificationScope).toEqual({ loaded: 5, limit: 5, hasMore: true });
    expect(ledger.nextActions).toContain("Review 7 verified interview invites.");
  });
});
