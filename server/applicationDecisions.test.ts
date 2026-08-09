import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getActiveResume: vi.fn(),
}));

vi.mock("./resumeStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resumeStorage")>()),
  getActiveResume: mocks.getActiveResume,
}));

import { appRouter } from "./routers";
import {
  createApplication,
  createApplicationDecision,
  getApplicationLedgerArtifacts,
  getAuditEventsForUser,
  getPendingUserApplicationForJob,
  getUserApplicationById,
  getUserApplicationDecisionForJob,
  getUserApplications,
  getUserApplicationDecisions,
  listAdminReviewItems,
  listUserApplicationApprovals,
  upsertUserProfile,
} from "./db";
import { getUserOperatingLedger } from "./applicationCampaigns";
import { sampleJobs } from "./sampleData";

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `decision-user-${userId}`,
      name: "Decision User",
      email: `decision-${userId}@example.local`,
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

async function makePreparationReady(userId: number) {
  await upsertUserProfile({
    userId,
    resumeUrl: `https://storage.example.local/resumes/${userId}/active-resume.pdf`,
    resumeFileKey: `resumes/${userId}/active-resume.pdf`,
    skills: "TypeScript, React, Node.js",
    experience: "Five years building production web applications.",
    desiredJobTypes: "Frontend Engineer",
    desiredLocations: "Remote, worldwide",
  });
}

describe("application decision ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveResume.mockImplementation(async (userId: number) => ({
      id: 97000 + userId,
      userId,
      fileName: "active-resume.pdf",
      fileUrl: `https://storage.example.local/resumes/${userId}/active-resume.pdf`,
      fileKey: `resumes/${userId}/active-resume.pdf`,
      fileSize: 1024,
      mimeType: "application/pdf",
      version: 1,
      isActive: true,
      uploadedAt: new Date(),
    }));
  });

  it("keeps one latest decision per user and job", async () => {
    const userId = 94001;
    const jobId = 1;

    const first = await createApplicationDecision({
      userId,
      jobId,
      decision: "review",
      decisionReason: "Review before applying.",
      matchScore: 83,
      riskLevel: "medium",
      reviewRequired: 1,
      reviewReason: "Human review required.",
      decidedBy: "system",
    });
    const second = await createApplicationDecision({
      userId,
      jobId,
      decision: "save",
      decisionReason: "Saved for later.",
      matchScore: 83,
      riskLevel: "low",
      reviewRequired: 1,
      reviewReason: "Saved from job search.",
      decidedBy: "user",
    });

    const decisions = await getUserApplicationDecisions(userId);

    expect(first.insertId).toBeTruthy();
    expect(second.existing).toBe(true);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe("save");
    expect(decisions[0].decidedBy).toBe("user");
  });

  it("requires an active versioned resume before direct or decision-based preparation", async () => {
    const userId = 94004;
    mocks.getActiveResume.mockResolvedValue(null);
    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.applications.create({ jobId: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("active versioned resume"),
    });
    await expect(caller.applications.decide({
      jobId: 1,
      decision: "review",
      decisionReason: "Queue this role for review once my current resume is linked.",
      reviewRequired: true,
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("active versioned resume"),
    });

    expect(await getUserApplications(userId)).toHaveLength(0);
  });

  it("returns only requested decisions owned by the authenticated user", async () => {
    const userId = 94020;
    const otherUserId = 94021;
    await Promise.all([
      createApplicationDecision({ userId, jobId: 1, decision: "save", decidedBy: "user" }),
      createApplicationDecision({ userId, jobId: 2, decision: "ignore", decidedBy: "user" }),
      createApplicationDecision({ userId, jobId: 3, decision: "review", decidedBy: "system" }),
      createApplicationDecision({ otherUserId, jobId: 1, decision: "apply", decidedBy: "user" }),
    ]);

    const caller = appRouter.createCaller(createContext(userId));
    const decisions = await caller.applications.listDecisions({ jobIds: [1, 3, 3] });

    expect(decisions.map((decision) => decision.jobId).sort((left, right) => left - right))
      .toEqual([1, 3]);
    expect(decisions.every((decision) => decision.userId === userId)).toBe(true);
  });

  it("loads one application and decision only for their owner", async () => {
    const userId = 94008;
    const otherUserId = 94009;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "pending",
    });
    const applicationId = Number(application.insertId);
    await createApplicationDecision({
      userId,
      jobId: 2,
      decision: "review",
      decisionReason: "Target decision.",
      decidedBy: "system",
    });
    await createApplicationDecision({
      userId: otherUserId,
      jobId: 2,
      decision: "ignore",
      decisionReason: "Different owner's decision.",
      decidedBy: "user",
    });

    await expect(getUserApplicationById(userId, applicationId)).resolves.toMatchObject({
      id: applicationId,
      userId,
      jobId: 2,
    });
    await expect(getUserApplicationById(otherUserId, applicationId)).resolves.toBeNull();
    await expect(getPendingUserApplicationForJob(userId, 2)).resolves.toMatchObject({
      id: applicationId,
      userId,
      jobId: 2,
      status: "pending",
    });
    await expect(getPendingUserApplicationForJob(otherUserId, 2)).resolves.toBeNull();
    await expect(getUserApplicationDecisionForJob(userId, 2)).resolves.toMatchObject({
      userId,
      jobId: 2,
      decision: "review",
    });
    await expect(getUserApplicationDecisionForJob(otherUserId, 2)).resolves.toMatchObject({
      userId: otherUserId,
      jobId: 2,
      decision: "ignore",
    });
  });

  it("refuses direct or decision preparation for missing and expired jobs", async () => {
    const userId = 94005;
    await makePreparationReady(userId);
    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.applications.create({ jobId: 999999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Job not found",
    });

    const job = sampleJobs.find((item) => item.id === 1)!;
    const originalExpiry = job.expiryDate;
    job.expiryDate = new Date(Date.now() - 60_000);
    try {
      await expect(caller.applications.create({ jobId: job.id })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("no longer active"),
      });
      await expect(caller.applications.decide({
        jobId: job.id,
        decision: "review",
        decisionReason: "Prepare this role after the listing refreshes.",
        reviewRequired: true,
      })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("no longer active"),
      });
    } finally {
      job.expiryDate = originalExpiry;
    }

    expect(await getUserApplications(userId)).toHaveLength(0);
  });

  it("does not duplicate generated review artifacts when the same job is queued again", async () => {
    const userId = 94002;
    await makePreparationReady(userId);
    const caller = appRouter.createCaller(createContext(userId));

    const first = await caller.applications.decide({
      jobId: 1,
      decision: "review",
      decisionReason: "Queue this application for controlled review.",
      matchScore: 84,
      riskLevel: "medium",
      reviewRequired: true,
      reviewReason: "First review pass.",
    });
    const second = await caller.applications.decide({
      jobId: 1,
      decision: "review",
      decisionReason: "Queue this application for controlled review again.",
      matchScore: 86,
      riskLevel: "medium",
      reviewRequired: true,
      reviewReason: "Updated review pass.",
    });

    const applicationId = first.applicationRecordId!;
    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    const approvals = await listUserApplicationApprovals(userId, "pending");
    const adminReviews = await listAdminReviewItems("all");
    const userAuditEvents = await getAuditEventsForUser(userId, 20);
    const queuedAuditEvents = userAuditEvents.filter((event) =>
      event.entityType === "application" &&
      event.entityId === applicationId &&
      event.action === "application_queued_for_review"
    );
    const decisionAuditEvents = userAuditEvents.filter((event) =>
      event.entityType === "job" &&
      event.entityId === 1 &&
      event.action === "application_decision_recorded"
    );

    expect(second.applicationRecordId).toBe(applicationId);
    expect(second.existing).toBe(true);
    expect(artifacts.attempts.filter((attempt) => attempt.attemptType === "prepare")).toHaveLength(1);
    expect(artifacts.material?.resumeId).toBe(97000 + userId);
    expect(queuedAuditEvents).toHaveLength(1);
    expect(decisionAuditEvents).toHaveLength(2);
    expect(approvals.filter((approval) =>
      approval.applicationId === applicationId &&
      approval.approvalType === "application_submission"
    )).toHaveLength(1);
    expect(adminReviews.filter((review) =>
      review.userId === userId &&
      review.entityType === "application" &&
      review.entityId === applicationId &&
      review.category === "application_review"
    )).toHaveLength(1);
  });

  it("uses one canonical application decision and preparation record across duplicate source listings", async () => {
    const userId = 94006;
    await makePreparationReady(userId);
    const caller = appRouter.createCaller(createContext(userId));

    const duplicateSource = await caller.applications.decide({
      jobId: 5,
      decision: "review",
      decisionReason: "Queue the role from a reposted source.",
      reviewRequired: true,
    });
    const canonicalSource = await caller.applications.decide({
      jobId: 1,
      decision: "review",
      decisionReason: "Update the same role from the canonical source.",
      reviewRequired: true,
    });

    const applications = await getUserApplications(userId);
    const decisions = await getUserApplicationDecisions(userId);

    expect(duplicateSource.applicationRecordId).toBe(canonicalSource.applicationRecordId);
    expect(applications).toHaveLength(1);
    expect(applications[0].jobId).toBe(1);
    expect(decisions).toMatchObject([{ jobId: 1, decision: "review" }]);
  });

  it("keeps direct preparation idempotent across duplicate source listings", async () => {
    const userId = 94007;
    await makePreparationReady(userId);
    const caller = appRouter.createCaller(createContext(userId));

    const duplicateSource = await caller.applications.create({ jobId: 5 });
    const canonicalSource = await caller.applications.create({ jobId: 1 });
    const artifacts = await getApplicationLedgerArtifacts(duplicateSource.applicationRecordId, userId);

    expect(canonicalSource).toMatchObject({
      success: true,
      applicationRecordId: duplicateSource.applicationRecordId,
      existing: true,
    });
    expect((await getUserApplications(userId))).toMatchObject([{ jobId: 1 }]);
    expect(artifacts.attempts.filter((attempt) => attempt.attemptType === "prepare")).toHaveLength(1);
    expect((await listUserApplicationApprovals(userId, "all")).filter((approval) =>
      approval.applicationId === duplicateSource.applicationRecordId && approval.approvalType === "application_submission"
    )).toHaveLength(1);
  });

  it("closes stale prepared application work when a review item is ignored", async () => {
    const userId = 94003;
    await makePreparationReady(userId);
    const caller = appRouter.createCaller(createContext(userId));

    const queued = await caller.applications.decide({
      jobId: 2,
      decision: "review",
      decisionReason: "Queue this job for review.",
      matchScore: 82,
      riskLevel: "medium",
      reviewRequired: true,
      reviewReason: "Needs user review before submission.",
    });
    const applicationId = queued.applicationRecordId!;

    await caller.applications.decide({
      jobId: 2,
      decision: "ignore",
      decisionReason: "Ignored from the review queue after user review.",
      matchScore: 82,
      riskLevel: "low",
      reviewRequired: false,
    });

    const applications = await getUserApplications(userId);
    const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
    const pendingApprovals = await listUserApplicationApprovals(userId, "pending");
    const allApprovals = await listUserApplicationApprovals(userId, "all");
    const ledger = await getUserOperatingLedger(userId);

    expect(applications.find((application) => application.id === applicationId)?.status).toBe("withdrawn");
    expect(pendingApprovals.filter((approval) => approval.applicationId === applicationId)).toHaveLength(0);
    expect(allApprovals.find((approval) => approval.applicationId === applicationId)?.status).toBe("cancelled");
    expect(artifacts.attempts.some((attempt) =>
      attempt.attemptType === "external_handoff" &&
      attempt.status === "cancelled" &&
      attempt.confirmationText?.includes("prepared submission gate cancelled")
    )).toBe(true);
    expect(artifacts.auditEvents.some((event) =>
      event.action === "application_review_closed" &&
      event.afterState?.includes("\"status\":\"withdrawn\"")
    )).toBe(true);
    expect(ledger.metrics.pendingApprovals).toBe(0);
    expect(ledger.metrics.reviewRequiredDecisions).toBe(0);
  });
});
