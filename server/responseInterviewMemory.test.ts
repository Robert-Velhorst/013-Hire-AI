import { describe, expect, it } from "vitest";
import {
  createFollowUp,
  getInterviewSchedules,
  getUpcomingInterviews,
  getUserFollowUpsForApplications,
  getUserInterviewSchedulesForApplications,
  markFollowUpSent,
  recordEmployerResponse,
  recordInterviewOutcome,
  rescheduleInterview,
  scheduleInterview,
  updateInterviewStatus,
} from "./applicationFeatures";
import { getUserOperatingLedger } from "./applicationCampaigns";
import { OFFER_SOURCE_REFERENCE_REQUIRED_MESSAGE } from "./applicationResponses";
import {
  createApplication,
  createInterviewNotification,
  getApplicationLedgerArtifacts,
  getUserEmployerResponsesForApplications,
  getUserApplications,
  getUserOfferAttributionReviews,
  listAdminReviewItems,
  listUserApplicationApprovals,
  resolveApplicationApproval,
} from "./db";

async function recordInterviewInvite(applicationId: number, userId: number) {
  await recordEmployerResponse({
    applicationId,
    responseType: "interview_invite",
    source: "email",
    sourceReference: `gmail-memory-invite-${applicationId}`,
    summary: "Recruiter invited the candidate to a video interview.",
  }, userId);
}

describe("response and interview memory fallback", () => {
  it("does not complete an interview when an offer outcome lacks source evidence", async () => {
    const userId = 98200;
    const application = await createApplication({ userId, jobId: 1, status: "applied" });
    const applicationId = Number(application.insertId);
    await recordInterviewInvite(applicationId, userId);
    const scheduled = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 2 * 86_400_000),
    }, userId);

    await expect(recordInterviewOutcome({
      interviewId: scheduled.id,
      outcome: "offer",
      source: "email",
      summary: "Recruiter sent a written offer after the final interview.",
    }, userId)).rejects.toThrow(OFFER_SOURCE_REFERENCE_REQUIRED_MESSAGE);

    expect((await getInterviewSchedules(applicationId, userId)).find((item) => item.id === scheduled.id)?.status).toBe("scheduled");
    expect((await getUserApplications(userId)).find((item) => item.id === applicationId)?.status).toBe("interview");
    expect((await getUserOperatingLedger(userId)).metrics.pendingOfferAttributions).toBe(0);
  });

  it("records employer responses, status transitions, offer attribution approvals, and admin review work", async () => {
    const userId = 98201;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      notes: "Submitted application awaiting employer response.",
    });
    const applicationId = Number(application.insertId);

    const interviewResponse = await recordEmployerResponse({
      applicationId,
      responseType: "interview_invite",
      source: "email",
      sourceReference: `gmail-memory-direct-${applicationId}`,
      summary: "Recruiter emailed asking for interview availability next week.",
      receivedAt: new Date(),
    }, userId);

    expect(interviewResponse.status).toBe("interview");
    let userApplications = await getUserApplications(userId);
    expect(userApplications.find((item) => item.id === applicationId)?.status).toBe("interview");

    const ledgerAfterInvite = await getUserOperatingLedger(userId);
    expect(ledgerAfterInvite.metrics.unreadInterviewNotifications).toBe(1);
    expect(ledgerAfterInvite.queues.interviewNotifications).toMatchObject([
      {
        applicationId,
        employerResponseId: interviewResponse.responseId,
        notificationType: "interview_invite",
      },
    ]);
    await expect(createInterviewNotification({
      userId,
      applicationId,
      employerResponseId: interviewResponse.responseId,
    })).resolves.toMatchObject({ existing: true });

    const offerResponse = await recordEmployerResponse({
      applicationId,
      responseType: "offer",
      source: "email",
      sourceReference: `gmail-offer-${applicationId}`,
      summary: "Employer sent a written offer for the linked role.",
      receivedAt: new Date(),
    }, userId);

    expect(offerResponse.status).toBe("offer");
    userApplications = await getUserApplications(userId);
    expect(userApplications.find((item) => item.id === applicationId)?.status).toBe("offer");

    const ledgerAfterOffer = await getUserOperatingLedger(userId);
    expect(ledgerAfterOffer.metrics.unreadInterviewNotifications).toBe(0);
    expect(ledgerAfterOffer.queues.interviewNotifications).toHaveLength(0);
    await expect(createInterviewNotification({
      userId,
      applicationId,
      employerResponseId: offerResponse.responseId,
    })).rejects.toThrow("Interview notifications require a recorded interview invitation");

    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    expect(artifacts.employerResponses).toHaveLength(2);
    expect(artifacts.employerResponses[0].responseType).toBe("offer");
    expect(artifacts.auditEvents.some((event) =>
      event.action === "employer_response_recorded" &&
      event.afterState?.includes('"responseType":"offer"')
    )).toBe(true);

    const pendingApprovals = await listUserApplicationApprovals(userId, "pending");
    expect(pendingApprovals.some((approval) =>
      approval.approvalType === "offer_attribution" &&
      approval.entityId === applicationId &&
      approval.payload?.includes(String(offerResponse.responseId))
    )).toBe(true);

    const attributionReviews = await getUserOfferAttributionReviews(userId);
    expect(attributionReviews).toHaveLength(1);
    expect(attributionReviews[0].application?.id).toBe(applicationId);
    expect(attributionReviews[0].latestEmployerResponse?.summary).toContain("written offer");

    const adminReviews = await listAdminReviewItems("open");
    expect(adminReviews.some((review) =>
      review.userId === userId &&
      review.entityType === "application" &&
      review.entityId === applicationId &&
      review.category === "offer_attribution"
    )).toBe(true);
  });

  it("cancels stale pending follow-up send approvals when an employer response arrives", async () => {
    const userId = 98204;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      notes: "Submitted application with a pending follow-up draft.",
    });
    const applicationId = Number(application.insertId);

    const followUp = await createFollowUp({
      applicationId,
      message: "Hello, I wanted to check whether there is an update on my application.",
    }, userId);
    const beforeApprovals = await listUserApplicationApprovals(userId, "pending");
    const followUpApproval = beforeApprovals.find((approval) =>
      approval.entityType === "follow_up" &&
      approval.entityId === followUp.id &&
      approval.approvalType === "follow_up_send"
    );
    expect(followUpApproval).toBeTruthy();

    const response = await recordEmployerResponse({
      applicationId,
      responseType: "interview_invite",
      source: "email",
      sourceReference: `gmail-memory-followup-${applicationId}`,
      summary: "Recruiter replied with an interview invitation for next week.",
      receivedAt: new Date(),
    }, userId);

    expect(response.cancelledFollowUpApprovalIds).toContain(followUpApproval!.id);
    const pendingAfterResponse = await listUserApplicationApprovals(userId, "pending");
    expect(pendingAfterResponse.some((approval) =>
      approval.entityType === "follow_up" &&
      approval.entityId === followUp.id &&
      approval.approvalType === "follow_up_send"
    )).toBe(false);

    const allApprovals = await listUserApplicationApprovals(userId, "all");
    const cancelledApproval = allApprovals.find((approval) => approval.id === followUpApproval!.id);
    expect(cancelledApproval?.status).toBe("cancelled");
    expect(cancelledApproval?.decisionNote).toContain("made the unsent follow-up draft stale");

    await expect(markFollowUpSent(followUp.id, userId)).rejects.toThrow(
      "Follow-up approval is required before marking it sent."
    );

    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    expect(artifacts.auditEvents.some((event) =>
      event.action === "stale_follow_up_approvals_cancelled" &&
      event.afterState?.includes(String(followUpApproval!.id))
    )).toBe(true);

    const ledger = await getUserOperatingLedger(userId);
    expect(ledger.metrics.pendingApprovals).toBe(0);
    expect(ledger.metrics.employerResponses).toBe(1);
  });

  it("retires offer attribution work when an employer withdraws an offer", async () => {
    const userId = 98206;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      notes: "Submitted application that later received and lost an offer.",
    });
    const applicationId = Number(application.insertId);

    await recordEmployerResponse({
      applicationId,
      responseType: "offer",
      source: "email",
      sourceReference: `gmail-offer-withdrawal-${applicationId}`,
      summary: "Employer sent a written offer for the role.",
      receivedAt: new Date(),
    }, userId);

    const offerApproval = (await listUserApplicationApprovals(userId, "pending")).find((approval) =>
      approval.applicationId === applicationId && approval.approvalType === "offer_attribution"
    );
    const offerReview = (await listAdminReviewItems("open")).find((review) =>
      review.userId === userId &&
      review.entityType === "application" &&
      review.entityId === applicationId &&
      review.category === "offer_attribution"
    );
    expect(offerApproval).toBeTruthy();
    expect(offerReview).toBeTruthy();

    const retraction = await recordEmployerResponse({
      applicationId,
      responseType: "rejection",
      source: "email",
      summary: "Employer withdrew the written offer after internal changes.",
      receivedAt: new Date(),
    }, userId);

    expect(retraction.status).toBe("rejected");
    expect(retraction.cancelledOfferAttributionApprovalIds).toContain(offerApproval!.id);
    expect(retraction.dismissedOfferAttributionReviewIds).toContain(offerReview!.id);
    expect((await getUserApplications(userId)).find((item) => item.id === applicationId)?.status).toBe("rejected");
    expect((await listUserApplicationApprovals(userId, "all")).find((approval) => approval.id === offerApproval!.id)?.status).toBe("cancelled");
    expect((await listAdminReviewItems("all")).find((review) => review.id === offerReview!.id)?.status).toBe("dismissed");

    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    expect(artifacts.auditEvents.some((event) =>
      event.action === "stale_offer_attribution_retired" &&
      event.afterState?.includes(String(offerApproval!.id)) &&
      event.afterState?.includes(String(offerReview!.id))
    )).toBe(true);
    expect((await getUserOfferAttributionReviews(userId)).some((review) =>
      review.approval?.id === offerApproval!.id
    )).toBe(false);
  });

  it("cancels upcoming interview records when an employer rejects an interview-stage application", async () => {
    const userId = 98207;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      notes: "Interview was scheduled before the employer rejected the application.",
    });
    const applicationId = Number(application.insertId);
    await recordInterviewInvite(applicationId, userId);
    const scheduled = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      location: "Video call",
    }, userId);

    expect((await getUpcomingInterviews(userId)).some((item) => item.interview.id === scheduled.id)).toBe(true);

    const rejection = await recordEmployerResponse({
      applicationId,
      responseType: "rejection",
      source: "email",
      summary: "Employer cancelled the interview process after final review.",
      receivedAt: new Date(),
    }, userId);

    expect(rejection.status).toBe("rejected");
    expect(rejection.cancelledInterviewIds).toContain(scheduled.id);
    expect((await getInterviewSchedules(applicationId, userId)).find((interview) => interview.id === scheduled.id)?.status).toBe("cancelled");
    expect((await getUpcomingInterviews(userId)).some((item) => item.interview.id === scheduled.id)).toBe(false);

    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    expect(artifacts.auditEvents.some((event) =>
      event.action === "interviews_cancelled_after_employer_rejection" &&
      event.afterState?.includes(String(scheduled.id)) &&
      event.afterState?.includes("externalCancellationSent\":false")
    )).toBe(true);
  });

  it("keeps pending follow-up approval when only a view signal is recorded", async () => {
    const userId = 98205;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      notes: "Submitted application with only a view signal.",
    });
    const applicationId = Number(application.insertId);

    const followUp = await createFollowUp({
      applicationId,
      message: "Hello, I wanted to check whether there is an update on my application.",
    }, userId);
    const beforeApprovals = await listUserApplicationApprovals(userId, "pending");
    const followUpApproval = beforeApprovals.find((approval) =>
      approval.entityType === "follow_up" &&
      approval.entityId === followUp.id &&
      approval.approvalType === "follow_up_send"
    );
    expect(followUpApproval).toBeTruthy();

    const response = await recordEmployerResponse({
      applicationId,
      responseType: "viewed",
      source: "employer_portal",
      summary: "The employer portal indicates that the application was viewed.",
      receivedAt: new Date(),
    }, userId);

    expect(response.cancelledFollowUpApprovalIds).toEqual([]);
    const pendingAfterView = await listUserApplicationApprovals(userId, "pending");
    expect(pendingAfterView.some((approval) => approval.id === followUpApproval!.id)).toBe(true);
  });

  it("blocks employer responses before submission evidence status exists", async () => {
    const userId = 98202;
    const application = await createApplication({
      userId,
      jobId: 1,
      status: "pending",
      notes: "Prepared but not submitted.",
    });

    await expect(recordEmployerResponse({
      applicationId: Number(application.insertId),
      responseType: "offer",
      source: "email",
      summary: "Employer sent an offer even though the app was not submitted.",
    }, userId)).rejects.toThrow("after submission is confirmed");
  });

  it("records interview scheduling, rescheduling, upcoming queue state, and outcome audit events", async () => {
    const userId = 98203;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      notes: "Employer invited the candidate to interview.",
    });
    const applicationId = Number(application.insertId);
    const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await recordInterviewInvite(applicationId, userId);

    const scheduled = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt,
      duration: 45,
      meetingLink: "https://meet.example.local/designhub",
      interviewerName: "Hiring Manager",
      notes: "First-round screen.",
    }, userId);

    expect(scheduled.id).toBeTruthy();
    expect(scheduled.approvalId).toBeTruthy();

    let interviews = await getInterviewSchedules(applicationId, userId);
    expect(interviews).toHaveLength(1);
    expect(interviews[0].status).toBe("scheduled");
    expect(interviews[0].meetingLink).toContain("meet.example");

    let userApplications = await getUserApplications(userId);
    expect(userApplications.find((item) => item.id === applicationId)?.status).toBe("interview");

    let upcoming = await getUpcomingInterviews(userId);
    expect(upcoming.some((item) => item.interview.id === scheduled.id)).toBe(true);
    expect(upcoming.find((item) => item.interview.id === scheduled.id)?.job?.title).toBe("Frontend Engineer");

    const rescheduledAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const rescheduled = await rescheduleInterview(scheduled.id, rescheduledAt, userId);
    expect(rescheduled.approvalId).toBeTruthy();
    interviews = await getInterviewSchedules(applicationId, userId);
    expect(interviews[0].status).toBe("rescheduled");
    expect(interviews[0].scheduledAt.toISOString()).toBe(rescheduledAt.toISOString());

    await updateInterviewStatus(scheduled.id, "completed", userId);
    interviews = await getInterviewSchedules(applicationId, userId);
    expect(interviews[0].status).toBe("completed");
    upcoming = await getUpcomingInterviews(userId);
    expect(upcoming.some((item) => item.interview.id === scheduled.id)).toBe(false);

    const approvals = await listUserApplicationApprovals(userId, "all");
    expect(approvals.filter((approval) => approval.approvalType === "interview_schedule")).toHaveLength(2);

    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    expect(artifacts.auditEvents.some((event) => event.action === "interview_scheduled")).toBe(true);
    expect(artifacts.auditEvents.some((event) => event.action === "interview_rescheduled")).toBe(true);
    expect(artifacts.auditEvents.some((event) => event.action === "interview_status_updated")).toBe(true);

    await expect(rescheduleInterview(
      scheduled.id,
      new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      userId
    )).rejects.toThrow("Interview cannot move from completed to rescheduled");
  });

  it("records interview outcomes as employer responses and application ledger state", async () => {
    const userId = 98204;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      notes: "Employer invited the candidate to interview.",
    });
    const applicationId = Number(application.insertId);
    await recordInterviewInvite(applicationId, userId);
    const scheduled = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      duration: 45,
      meetingLink: "https://meet.example.local/designhub-outcome",
      interviewerName: "Hiring Manager",
    }, userId);

    const outcome = await recordInterviewOutcome({
      interviewId: scheduled.id,
      outcome: "rejection",
      source: "email",
      summary: "Recruiter emailed after the interview that the team chose another candidate.",
    }, userId);

    expect(outcome.success).toBe(true);
    expect(outcome.interviewStatus).toBe("completed");
    expect(outcome.responseType).toBe("rejection");
    expect(outcome.status).toBe("rejected");

    const interviews = await getInterviewSchedules(applicationId, userId);
    expect(interviews[0].status).toBe("completed");
    const userApplications = await getUserApplications(userId);
    expect(userApplications.find((item) => item.id === applicationId)?.status).toBe("rejected");

    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    expect(artifacts.employerResponses.find((response) => response.id === outcome.responseId)).toMatchObject({
      id: outcome.responseId,
      interviewId: scheduled.id,
      responseType: "rejection",
      statusAfter: "rejected",
    });
    expect(artifacts.employerResponses.find((response) => response.id === outcome.responseId)?.summary)
      .toContain("Interview outcome recorded: rejection.");
    expect(artifacts.auditEvents.some((event) =>
      event.action === "interview_outcome_recorded" &&
      event.afterState?.includes(`"responseId":${outcome.responseId}`)
    )).toBe(true);
  });

  it("records no-response outcomes as internal checks without retiring a follow-up handoff", async () => {
    const userId = 98215;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      notes: "Interview completed without a recruiter reply yet.",
    });
    const applicationId = Number(application.insertId);
    await recordInterviewInvite(applicationId, userId);
    const scheduled = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    }, userId);
    const followUp = await createFollowUp({
      applicationId,
      message: "Thank you for the interview. I remain very interested in the role.",
    }, userId);
    const approval = (await listUserApplicationApprovals(userId, "pending")).find((item) =>
      item.entityType === "follow_up" && item.entityId === followUp.id
    );
    expect(approval).toBeTruthy();
    await resolveApplicationApproval(
      approval!.id,
      userId,
      "approved",
      "Approved for the manual send handoff.",
      "user"
    );

    const outcome = await recordInterviewOutcome({
      interviewId: scheduled.id,
      outcome: "no_response",
      source: "email",
      summary: "Checked the application after the interview; no employer response has arrived yet.",
    }, userId);

    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    const approvals = await listUserApplicationApprovals(userId, "all");
    const ledger = await getUserOperatingLedger(userId);

    expect(outcome.responseType).toBe("no_response");
    expect(outcome.status).toBe("interview");
    expect(artifacts.employerResponses.find((response) => response.id === outcome.responseId)).toMatchObject({
      id: outcome.responseId,
      interviewId: scheduled.id,
      responseType: "no_response",
      source: "other",
      statusAfter: "interview",
    });
    expect(approvals.find((item) => item.id === approval!.id)?.status).toBe("approved");
    expect(ledger.metrics.employerResponsesNeedingReply).toBe(0);
    expect(ledger.metrics.approvedFollowUpsReadyToSend).toBe(1);
    expect(artifacts.auditEvents.some((event) => event.action === "stale_follow_up_approvals_cancelled")).toBe(false);
  });

  it("batch-loads operating evidence without crossing application ownership", async () => {
    const userId = 98216;
    const otherUserId = 98217;
    const application = await createApplication({ userId, jobId: 1, status: "applied" });
    const otherApplication = await createApplication({ userId: otherUserId, jobId: 3, status: "applied" });
    const applicationId = Number(application.insertId);
    const otherApplicationId = Number(otherApplication.insertId);

    expect(await getUserApplications(userId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: applicationId })])
    );
    expect(await getUserApplications(otherUserId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: otherApplicationId })])
    );

    await recordInterviewInvite(applicationId, userId);
    await recordInterviewInvite(otherApplicationId, otherUserId);
    const interview = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    }, userId);
    await scheduleInterview({
      applicationId: otherApplicationId,
      interviewType: "phone",
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    }, otherUserId);
    const followUp = await createFollowUp({
      applicationId,
      message: "Thank you for arranging the interview.",
    }, userId);
    await createFollowUp({
      applicationId: otherApplicationId,
      message: "This follow-up belongs to another user.",
    }, otherUserId);

    const requestedIds = [applicationId, otherApplicationId];
    const [responses, schedules, followUps] = await Promise.all([
      getUserEmployerResponsesForApplications(userId, requestedIds),
      getUserInterviewSchedulesForApplications(userId, requestedIds),
      getUserFollowUpsForApplications(userId, requestedIds),
    ]);

    expect(new Set(responses.map((response) => response.applicationId))).toEqual(new Set([applicationId]));
    expect(schedules.map((schedule) => schedule.id)).toEqual([interview.id]);
    expect(followUps.map((item) => item.id)).toEqual([followUp.id]);
  });
});
