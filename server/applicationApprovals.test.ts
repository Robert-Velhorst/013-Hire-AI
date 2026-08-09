import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getActiveResume: vi.fn(),
}));

// This is an integration test. Other suites replace ./db with narrow mocks,
// so explicitly retain the real ledger implementation in shared test workers.
vi.unmock("./db");

vi.mock("./resumeStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resumeStorage")>()),
  getActiveResume: mocks.getActiveResume,
}));

import {
  createApplication,
  createApplicationApproval,
  createEmployerResponse,
  getApplicationLedgerArtifacts,
  getUserApplications,
  getUserOfferAttributionReviews,
  listUserApplicationApprovals,
  resolveApplicationApproval,
  upsertUserProfile,
} from "./db";
import { getFollowUps } from "./applicationFeatures";
import { appRouter } from "./routers";
import { sampleJobs } from "./sampleData";

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `approval-user-${userId}`,
      name: "Approval User",
      email: `approval-${userId}@example.local`,
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("application approval ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveResume.mockResolvedValue(null);
  });

  it("keeps one pending approval per action and resolves it", async () => {
    const userId = 98001;
    const applicationId = 43210;
    const followUpId = 54321;

    const first = await createApplicationApproval({
      userId,
      applicationId,
      entityType: "follow_up",
      entityId: followUpId,
      approvalType: "follow_up_send",
      status: "pending",
      riskLevel: "medium",
      requestedBy: "system",
      title: "Approve follow-up before sending",
      description: "A follow-up draft requires user approval before it can be marked sent.",
      payload: JSON.stringify({ message: "Initial follow-up draft." }),
    });
    const second = await createApplicationApproval({
      userId,
      applicationId,
      entityType: "follow_up",
      entityId: followUpId,
      approvalType: "follow_up_send",
      status: "pending",
      riskLevel: "medium",
      requestedBy: "system",
      title: "Approve updated follow-up before sending",
      description: "Updated follow-up copy requires approval.",
      payload: JSON.stringify({ message: "Updated follow-up draft." }),
    });

    const pendingBeforeResolution = await listUserApplicationApprovals(userId, "pending");

    expect(first.insertId).toBeTruthy();
    expect(second.existing).toBe(true);
    expect(pendingBeforeResolution).toHaveLength(1);
    expect(pendingBeforeResolution[0].title).toBe("Approve updated follow-up before sending");

    const resolved = await resolveApplicationApproval(
      Number(first.insertId),
      userId,
      "approved",
      "Approved for send confirmation.",
      "user"
    );
    const pendingAfterResolution = await listUserApplicationApprovals(userId, "pending");
    const allApprovals = await listUserApplicationApprovals(userId, "all");

    expect(resolved.approval.status).toBe("approved");
    expect(pendingAfterResolution).toHaveLength(0);
    expect(allApprovals).toHaveLength(1);
    expect(allApprovals[0].status).toBe("approved");
    expect(allApprovals[0].decisionNote).toBe("Approved for send confirmation.");
  });

  it("tracks offer attribution and billing action approvals", async () => {
    const userId = 98002;
    const applicationId = 65432;
    const successFeeId = 76543;

    const offerApproval = await createApplicationApproval({
      userId,
      applicationId,
      entityType: "application",
      entityId: applicationId,
      approvalType: "offer_attribution",
      status: "pending",
      riskLevel: "high",
      requestedBy: "system",
      title: "Confirm offer attribution",
      description: "Offer response should be attributed before success fee setup.",
    });
    await resolveApplicationApproval(
      Number(offerApproval.insertId),
      userId,
      "approved",
      "Offer came from Hire.AI activity.",
      "user"
    );
    await createApplicationApproval({
      userId,
      entityType: "billing",
      entityId: successFeeId,
      approvalType: "billing_action",
      status: "approved",
      riskLevel: "critical",
      requestedBy: "user",
      decidedBy: "user",
      title: "Success fee subscription setup approved",
      description: "User accepted success-fee terms before billing setup.",
      decisionNote: "Success fee terms accepted.",
      decidedAt: new Date(),
    });

    const approvals = await listUserApplicationApprovals(userId, "all");

    expect(approvals).toHaveLength(2);
    expect(approvals.some((approval) =>
      approval.approvalType === "offer_attribution" &&
      approval.status === "approved" &&
      approval.applicationId === applicationId
    )).toBe(true);
    expect(approvals.some((approval) =>
      approval.approvalType === "billing_action" &&
      approval.status === "approved" &&
      approval.riskLevel === "critical"
    )).toBe(true);
  });

  it("tracks approved interview scheduling decisions", async () => {
    const userId = 98003;
    const applicationId = 87654;
    const interviewId = 98765;

    await createApplicationApproval({
      userId,
      applicationId,
      entityType: "application",
      entityId: applicationId,
      approvalType: "interview_schedule",
      status: "approved",
      riskLevel: "high",
      requestedBy: "user",
      decidedBy: "user",
      title: "Interview time accepted",
      description: "User accepted an interview time.",
      payload: JSON.stringify({
        interviewId,
        scheduledAt: "2026-07-01T12:00:00.000Z",
      }),
      decisionNote: "User accepted this interview time.",
      decidedAt: new Date(),
    });

    const approvals = await listUserApplicationApprovals(userId, "all");

    expect(approvals).toHaveLength(1);
    expect(approvals[0].approvalType).toBe("interview_schedule");
    expect(approvals[0].status).toBe("approved");
    expect(approvals[0].riskLevel).toBe("high");
  });

  it("records a non-submission handoff attempt when approving an application submission gate", async () => {
    const userId = 98006;
    mocks.getActiveResume.mockResolvedValue({
      id: 980061,
      userId,
      fileName: "approved-handoff-resume.pdf",
      fileUrl: "private://resumes/98006/approved-handoff-resume.pdf",
      fileKey: "resumes/98006/approved-handoff-resume.pdf",
      fileSize: 2048,
      mimeType: "application/pdf",
      version: 1,
      isActive: true,
      uploadedAt: new Date(),
    });
    await upsertUserProfile({
      userId,
      skills: "TypeScript, React, Node.js",
      experience: "Built production web applications for five years.",
      education: "BSc Computer Science",
      desiredJobTypes: "Full Stack Engineer",
      desiredLocations: "Remote",
      salaryExpectationMin: 90000,
      salaryExpectationMax: 140000,
      resumeUrl: "private://resumes/98006/approved-handoff-resume.pdf",
      resumeFileKey: "resumes/98006/approved-handoff-resume.pdf",
    });
    const application = await createApplication({
      userId,
      jobId: 1,
      status: "pending",
      notes: "Prepared application needs approval.",
    });
    const applicationId = Number(application.insertId);
    const approval = await createApplicationApproval({
      userId,
      applicationId,
      entityType: "application",
      entityId: applicationId,
      approvalType: "application_submission",
      status: "pending",
      riskLevel: "high",
      requestedBy: "system",
      title: "Approve prepared external submission",
      description: "Prepared materials require explicit approval before external handoff.",
    });

    const caller = appRouter.createCaller(createContext(userId));
    await caller.applications.resolveApproval({
      approvalId: Number(approval.insertId),
      status: "approved",
      decisionNote: "Ready for manual submission.",
    });

    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    const handoffAttempt = artifacts.attempts.find((attempt) =>
      attempt.attemptType === "external_handoff"
    );

    expect(handoffAttempt).toBeTruthy();
    expect(handoffAttempt?.status).toBe("prepared");
    expect(handoffAttempt?.confirmationText).toContain(
      "No external submission was recorded by this approval."
    );
    expect(artifacts.auditEvents.some((event) =>
      event.action === "approval_resolved" &&
      event.afterState?.includes("handoffAttemptId")
    )).toBe(true);
  });

  it("keeps a submission approval pending when core evidence blocks external handoff", async () => {
    const userId = 98009;
    const application = await createApplication({
      userId,
      jobId: 1,
      status: "pending",
      notes: "Prepared application is missing the candidate evidence needed for handoff.",
    });
    const applicationId = Number(application.insertId);
    const approval = await createApplicationApproval({
      userId,
      applicationId,
      entityType: "application",
      entityId: applicationId,
      approvalType: "application_submission",
      status: "pending",
      riskLevel: "high",
      requestedBy: "system",
      title: "Approve prepared external submission",
      description: "Prepared materials require explicit approval before external handoff.",
    });

    const caller = appRouter.createCaller(createContext(userId));
    await expect(caller.applications.resolveApproval({
      approvalId: Number(approval.insertId),
      status: "approved",
      decisionNote: "Attempted approval without a versioned resume.",
    })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Resolve the profile evidence gates before approving an external application handoff.",
    });

    expect((await listUserApplicationApprovals(userId, "all")).find((item) => item.id === Number(approval.insertId))?.status)
      .toBe("pending");
    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    expect(artifacts.attempts).toHaveLength(0);
    expect(artifacts.auditEvents.some((event) =>
      event.action === "application_submission_approval_blocked_evidence" &&
      event.afterState?.includes("profile-core-evidence")
    )).toBe(true);
  });

  it("cancels a submission handoff when the job becomes unavailable after preparation", async () => {
    const userId = 98010;
    const job = sampleJobs[0];
    const original = { isActive: job.isActive, expiryDate: job.expiryDate };
    job.isActive = 1;
    job.expiryDate = new Date(Date.now() - 60_000);
    mocks.getActiveResume.mockResolvedValue({
      id: 980101,
      userId,
      fileName: "active-resume.pdf",
      fileUrl: "private://resumes/98010/active-resume.pdf",
      fileKey: "resumes/98010/active-resume.pdf",
      fileSize: 2048,
      mimeType: "application/pdf",
      version: 1,
      isActive: true,
      uploadedAt: new Date(),
    });
    await upsertUserProfile({
      userId,
      skills: "TypeScript, React, Node.js",
      experience: "Built production web applications for five years.",
      education: "BSc Computer Science",
      desiredJobTypes: "Full Stack Engineer",
      desiredLocations: "Remote",
      resumeUrl: "private://resumes/98010/active-resume.pdf",
      resumeFileKey: "resumes/98010/active-resume.pdf",
    });

    try {
      const application = await createApplication({
        userId,
        jobId: job.id,
        status: "pending",
        notes: "Prepared application whose job listing closed before handoff.",
      });
      const applicationId = Number(application.insertId);
      const approval = await createApplicationApproval({
        userId,
        applicationId,
        entityType: "application",
        entityId: applicationId,
        approvalType: "application_submission",
        status: "pending",
        riskLevel: "high",
        requestedBy: "system",
        title: "Approve external application handoff",
        description: "Prepared materials need confirmation before external handoff.",
      });

      const caller = appRouter.createCaller(createContext(userId));
      await expect(caller.applications.resolveApproval({
        approvalId: Number(approval.insertId),
        status: "approved",
        decisionNote: "Approve the external handoff.",
      })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "This job is no longer active. The external application handoff approval was cancelled.",
      });

      expect((await listUserApplicationApprovals(userId, "all")).find((item) => item.id === Number(approval.insertId))?.status)
        .toBe("cancelled");
      const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
      expect(artifacts.attempts.some((attempt) =>
        attempt.attemptType === "external_handoff" &&
        attempt.status === "cancelled" &&
        attempt.confirmationText?.includes("No external submission was recorded")
      )).toBe(true);
      expect(artifacts.auditEvents.some((event) =>
        event.action === "application_submission_approval_cancelled_stale_job" &&
        event.afterState?.includes('"externalSubmissionPerformed":false')
      )).toBe(true);
    } finally {
      job.isActive = original.isActive;
      job.expiryDate = original.expiryDate;
    }
  });

  it("rejects forged delivery timestamps from the public follow-up draft procedure", async () => {
    const userId = 98007;
    const application = await createApplication({
      userId,
      jobId: 4,
      status: "applied",
      notes: "A submitted application needs a reviewable follow-up draft.",
    });
    const applicationId = Number(application.insertId);
    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.applications.createFollowUp({
      applicationId,
      message: "Checking in on my submitted application.",
      sendDate: new Date().toISOString(),
    } as never)).rejects.toThrow();

    expect(await getFollowUps(applicationId, userId)).toHaveLength(0);
  });

  it("surfaces pending offer attribution reviews with linked application evidence", async () => {
    const userId = 98004;
    const otherUserId = 98005;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "offer",
      notes: "Offer needs success-fee attribution.",
    });
    const applicationId = Number(application.insertId);
    const otherApplication = await createApplication({
      userId: otherUserId,
      jobId: 1,
      status: "offer",
      notes: "Other user's offer must not leak.",
    });

    await createEmployerResponse({
      applicationId,
      userId,
      responseType: "offer",
      source: "email",
      summary: "Employer emailed a written offer for the linked role.",
      receivedAt: new Date("2026-06-29T10:00:00.000Z"),
      statusBefore: "interview",
      statusAfter: "offer",
    });
    await createEmployerResponse({
      applicationId: Number(otherApplication.insertId),
      userId: otherUserId,
      responseType: "offer",
      source: "email",
      summary: "Other user's offer response.",
      receivedAt: new Date("2026-06-29T11:00:00.000Z"),
      statusBefore: "interview",
      statusAfter: "offer",
    });
    await createApplicationApproval({
      userId,
      applicationId,
      entityType: "application",
      entityId: applicationId,
      approvalType: "offer_attribution",
      status: "pending",
      riskLevel: "high",
      requestedBy: "system",
      title: "Confirm offer attribution",
      description: "Offer response should be attributed before success fee setup.",
      payload: JSON.stringify({ responseType: "offer", source: "email" }),
    });
    await createApplicationApproval({
      userId: otherUserId,
      applicationId: Number(otherApplication.insertId),
      entityType: "application",
      entityId: Number(otherApplication.insertId),
      approvalType: "offer_attribution",
      status: "pending",
      riskLevel: "high",
      requestedBy: "system",
      title: "Other user's offer attribution",
      description: "This should not be returned.",
    });

    const reviews = await getUserOfferAttributionReviews(userId);

    expect(reviews).toHaveLength(1);
    expect(reviews[0].approval.approvalType).toBe("offer_attribution");
    expect(reviews[0].application?.id).toBe(applicationId);
    expect(reviews[0].application?.job?.title).toBe("Frontend Engineer");
    expect(reviews[0].latestEmployerResponse?.summary).toContain("written offer");
    expect(reviews[0].payload).toMatchObject({ responseType: "offer" });
    expect(reviews[0].recommendedAction).toBe("report_hire");
  });

  it("keeps an offer-attribution review linked to its recorded offer response after an amendment", async () => {
    const userId = 98009;
    const application = await createApplication({
      userId,
      jobId: 3,
      status: "offer",
      notes: "An offer was revised before the candidate reported a hire.",
    });
    const applicationId = Number(application.insertId);
    const originalOffer = await createEmployerResponse({
      applicationId,
      userId,
      responseType: "offer",
      source: "email",
      sourceReference: "gmail-offer-original-98009",
      summary: "Employer offered the original compensation package.",
      receivedAt: new Date("2026-06-29T10:00:00.000Z"),
      statusBefore: "interview",
      statusAfter: "offer",
    });
    await createEmployerResponse({
      applicationId,
      userId,
      responseType: "offer",
      source: "email",
      sourceReference: "gmail-offer-revised-98009",
      summary: "Employer revised the compensation package after negotiation.",
      receivedAt: new Date("2026-06-30T10:00:00.000Z"),
      statusBefore: "offer",
      statusAfter: "offer",
    });
    await createApplicationApproval({
      userId,
      applicationId,
      entityType: "application",
      entityId: applicationId,
      approvalType: "offer_attribution",
      status: "pending",
      riskLevel: "high",
      requestedBy: "system",
      title: "Confirm offer attribution",
      description: "Review the original offer record.",
      payload: JSON.stringify({
        responseId: Number(originalOffer.insertId),
        responseType: "offer",
      }),
    });

    const [review] = await getUserOfferAttributionReviews(userId);

    expect(review.latestEmployerResponse?.id).toBe(Number(originalOffer.insertId));
    expect(review.latestEmployerResponse?.summary).toContain("original compensation");
  });

  it("does not surface attribution reviews until the linked application has an offer", async () => {
    const userId = 98008;
    const application = await createApplication({
      userId,
      jobId: 1,
      status: "pending",
      notes: "This application does not have an offer.",
    });
    const applicationId = Number(application.insertId);

    await createApplicationApproval({
      userId,
      applicationId,
      entityType: "application",
      entityId: applicationId,
      approvalType: "offer_attribution",
      status: "pending",
      riskLevel: "high",
      requestedBy: "system",
      title: "Invalid early offer attribution",
      description: "This should remain hidden until an offer is recorded.",
    });

    await expect(getUserOfferAttributionReviews(userId)).resolves.toEqual([]);
  });

  it("filters supplied attribution evidence to the requested user", async () => {
    const userId = 98012;
    const otherUserId = 98013;
    const application = await createApplication({ userId, jobId: 1, status: "offer" });
    const otherApplication = await createApplication({ userId: otherUserId, jobId: 3, status: "offer" });
    const applicationId = Number(application.insertId);
    const otherApplicationId = Number(otherApplication.insertId);
    await createEmployerResponse({
      applicationId,
      userId,
      responseType: "offer",
      source: "email",
      sourceReference: "gmail-supplied-offer-98012",
      summary: "Offer for the requested user.",
      receivedAt: new Date("2026-07-01T09:00:00.000Z"),
      statusBefore: "interview",
      statusAfter: "offer",
    });
    await createEmployerResponse({
      applicationId: otherApplicationId,
      userId: otherUserId,
      responseType: "offer",
      source: "email",
      sourceReference: "gmail-supplied-offer-98013",
      summary: "Offer belonging to another user.",
      receivedAt: new Date("2026-07-01T10:00:00.000Z"),
      statusBefore: "interview",
      statusAfter: "offer",
    });
    for (const [approvalUserId, approvalApplicationId] of [
      [userId, applicationId],
      [otherUserId, otherApplicationId],
    ] as const) {
      await createApplicationApproval({
        userId: approvalUserId,
        applicationId: approvalApplicationId,
        entityType: "application",
        entityId: approvalApplicationId,
        approvalType: "offer_attribution",
        status: "pending",
        riskLevel: "high",
        requestedBy: "system",
        title: "Confirm supplied offer attribution",
      });
    }

    const [approvals, applications, userArtifacts, otherArtifacts] = await Promise.all([
      Promise.all([
        listUserApplicationApprovals(userId, "all"),
        listUserApplicationApprovals(otherUserId, "all"),
      ]).then((items) => items.flat()),
      Promise.all([
        getUserApplications(userId),
        getUserApplications(otherUserId),
      ]).then((items) => items.flat()),
      getApplicationLedgerArtifacts(applicationId, userId),
      getApplicationLedgerArtifacts(otherApplicationId, otherUserId),
    ]);
    const reviews = await getUserOfferAttributionReviews(userId, {
      approvals,
      applications,
      employerResponses: [
        ...userArtifacts.employerResponses,
        ...otherArtifacts.employerResponses,
      ],
    });

    expect(applications.find((item) => item.id === applicationId)?.status).toBe("offer");
    expect(approvals.some((item) =>
      item.userId === userId && item.applicationId === applicationId && item.status === "pending"
    )).toBe(true);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].approval.userId).toBe(userId);
    expect(reviews[0].application?.id).toBe(applicationId);
    expect(reviews[0].latestEmployerResponse?.summary).toContain("requested user");
  });
});
