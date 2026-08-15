import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getActiveResume: vi.fn(),
}));

vi.mock("./resumeStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resumeStorage")>()),
  getActiveResume: mocks.getActiveResume,
}));
import {
  getApplicationLedgerArtifacts,
  getAuditEventsForEntity,
  getAuditEventsForUser,
  getUserApplicationDecisions,
  getUserApplications,
  listUserApplicationApprovals,
  upsertUserProfile,
} from "./db";
import { appRouter } from "./routers";
import { sampleJobs } from "./sampleData";

function createContext(userId: number, tosAcceptedAt: Date | null = new Date()): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `automation-user-${userId}`,
      name: "Automation User",
      email: `automation-${userId}@example.local`,
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("automation application preparation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveResume.mockResolvedValue({
      id: 73501,
      userId: 98401,
      fileName: "alex-resume.pdf",
      fileUrl: "https://storage.example.local/resumes/98401/alex-resume.pdf",
      fileKey: "resumes/98401/alex-resume.pdf",
      fileSize: 1234,
      mimeType: "application/pdf",
      version: 3,
      isActive: true,
      uploadedAt: new Date(),
    });
  });

  it("reports material preparation without advertising employer-portal form access", async () => {
    const caller = appRouter.createCaller(createContext(98400));

    const [support, greenhouse] = await Promise.all([
      caller.automation.getATSSupport(),
      caller.automation.detectATS({ url: "https://boards.greenhouse.io/example/jobs/1" }),
    ]);

    expect(support).toMatchObject({
      submissionSupported: [],
      preparationSupported: [],
      materialPreparationSupported: true,
      guarded: [
        "greenhouse",
        "lever",
        "workday",
        "taleo",
        "icims",
        "smartrecruiters",
        "bamboohr",
        "jobvite",
      ],
    });
    expect(support.notes).toContain("does not open, fill, upload to, or submit");
    expect(greenhouse).toMatchObject({
      atsType: "greenhouse",
      supported: false,
      preparationSupported: false,
    });
  });

  it("requires Terms acceptance before creating application-preparation artifacts", async () => {
    const userId = 98409;
    const caller = appRouter.createCaller(createContext(userId, null));

    await expect(caller.automation.applyToJob({ jobId: 1 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Accept the Terms of Service"),
    });
    await expect(caller.applications.create({ jobId: 1 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Accept the Terms of Service"),
    });
    expect(await getUserApplications(userId)).toHaveLength(0);
    expect(await listUserApplicationApprovals(userId, "all")).toHaveLength(0);
  });

  it("records a reviewable preparation rather than an applied submission", async () => {
    const userId = 98401;
    await upsertUserProfile({
      userId,
      resumeUrl: "https://example.com/resume.pdf",
      skills: "TypeScript, React, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote, worldwide",
    });
    const caller = appRouter.createCaller(createContext(userId));

    const result = await caller.automation.applyToJob({ jobId: 1 });
    const applications = await getUserApplications(userId);
    const application = applications.find(
      item => item.id === result.applicationRecordId
    );
    const artifacts = await getApplicationLedgerArtifacts(
      result.applicationRecordId,
      userId
    );
    const auditEvents = await getAuditEventsForEntity(
      userId,
      "application",
      result.applicationRecordId
    );
    const approvals = await listUserApplicationApprovals(userId, "pending");

    expect(result.success).toBe(false);
    expect(application).toMatchObject({
      status: "pending",
      appliedDate: undefined,
      isAutoApplied: 0,
    });
    expect(artifacts.attempts[0]).toMatchObject({
      attemptType: "prepare",
      status: "review_required",
    });
    expect(artifacts.material).toMatchObject({
      resumeId: 73501,
      coverLetter: expect.stringContaining("My profile lists TypeScript, React, Node.js"),
    });
    expect(JSON.parse(artifacts.material!.claimsMade!)).toMatchObject({
      supportedClaimsOnly: true,
      supportedSkills: expect.arrayContaining(["TypeScript", "React", "Node.js"]),
    });
    expect(JSON.parse(artifacts.material!.sourceProfileSnapshot!).profile).toMatchObject({
      skills: "TypeScript, React, Node.js",
    });
    expect(
      auditEvents.some(
        event => {
          if (event.action !== "application_prepared_by_automation" || !event.afterState) {
            return false;
          }
          const afterState = JSON.parse(event.afterState) as {
            externalSubmissionPerformed?: boolean;
            resume?: { id?: number };
          };
          return afterState.externalSubmissionPerformed === false && afterState.resume?.id === 73501;
        }
      )
    ).toBe(true);
    expect(
      auditEvents.some(
        event => event.action === "application_submitted_by_automation"
      )
    ).toBe(false);
    expect(
      approvals.some(
        approval =>
          approval.applicationId === result.applicationRecordId &&
          approval.approvalType === "application_submission"
      )
    ).toBe(true);
  });

  it("uses a grounded draft for direct preparation and records the source profile snapshot", async () => {
    const userId = 98406;
    await upsertUserProfile({
      userId,
      resumeUrl: "https://example.com/resume.pdf",
      skills: "TypeScript, React, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote, worldwide",
    });
    const caller = appRouter.createCaller(createContext(userId));

    const result = await caller.applications.create({ jobId: 2 });
    const artifacts = await getApplicationLedgerArtifacts(result.applicationRecordId, userId);

    expect(artifacts.material?.coverLetter).toContain("My profile lists");
    expect(JSON.parse(artifacts.material!.customAnswers!)).toMatchObject({
      source: "evidence_bound_application_draft",
      draftType: "profile_grounded",
    });
    expect(JSON.parse(artifacts.material!.claimsMade!)).toMatchObject({
      supportedClaimsOnly: true,
    });
    expect(JSON.parse(artifacts.material!.sourceProfileSnapshot!).profile).toMatchObject({
      skills: "TypeScript, React, Node.js",
      desiredJobTypes: "Frontend Engineer",
    });
  });

  it("retains a candidate-authored letter but marks its claims unverified", async () => {
    const userId = 98407;
    await upsertUserProfile({
      userId,
      resumeUrl: "https://example.com/resume.pdf",
      skills: "TypeScript, React, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote, worldwide",
    });
    const caller = appRouter.createCaller(createContext(userId));
    const coverLetter = "I have every certification required for this role.";

    const result = await caller.applications.create({ jobId: 3, coverLetter });
    const artifacts = await getApplicationLedgerArtifacts(result.applicationRecordId, userId);
    const claims = JSON.parse(artifacts.material!.claimsMade!);

    expect(artifacts.material?.coverLetter).toBe(coverLetter);
    expect(JSON.parse(artifacts.material!.customAnswers!)).toMatchObject({
      source: "user_provided_cover_letter",
      draftType: "user_authored",
    });
    expect(claims.supportedClaimsOnly).toBe(false);
    expect(claims.blockers).toContain(
      "Candidate-authored cover letter requires claim-by-claim review before external submission."
    );
  });

  it("does not replace existing candidate material when a job is re-queued", async () => {
    const userId = 98408;
    await upsertUserProfile({
      userId,
      resumeUrl: "https://example.com/resume.pdf",
      skills: "TypeScript, React, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote, worldwide",
    });
    const caller = appRouter.createCaller(createContext(userId));
    const coverLetter = "My candidate-authored letter must remain the source of truth.";
    const prepared = await caller.applications.create({ jobId: 4, coverLetter });

    await caller.applications.decide({
      jobId: 4,
      decision: "review",
      decisionReason: "Keep this application in the review queue.",
      reviewRequired: true,
    });
    const artifacts = await getApplicationLedgerArtifacts(prepared.applicationRecordId, userId);

    expect(artifacts.material?.coverLetter).toBe(coverLetter);
    expect(JSON.parse(artifacts.material!.customAnswers!)).toMatchObject({
      source: "user_provided_cover_letter",
    });
  });

  it("refuses preparation when the user has no active versioned resume", async () => {
    const userId = 98402;
    mocks.getActiveResume.mockResolvedValueOnce(null);
    await upsertUserProfile({
      userId,
      resumeUrl: "https://example.com/legacy-resume.pdf",
      resumeFileKey: "resumes/98402/legacy-resume.pdf",
    });

    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.automation.applyToJob({ jobId: 1 })).rejects.toThrow(
      "active versioned resume"
    );
    expect(await getUserApplications(userId)).toHaveLength(0);
  });

  it("refuses automation preparation for an expired listing before creating ledger artifacts", async () => {
    const userId = 98405;
    const caller = appRouter.createCaller(createContext(userId));
    const job = sampleJobs.find((item) => item.id === 1)!;
    const originalExpiry = job.expiryDate;
    job.expiryDate = new Date(Date.now() - 60_000);
    try {
      await expect(caller.automation.applyToJob({ jobId: job.id })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("no longer active"),
      });
    } finally {
      job.expiryDate = originalExpiry;
    }

    expect(await getUserApplications(userId)).toHaveLength(0);
    expect(await listUserApplicationApprovals(userId, "all")).toHaveLength(0);
  });

  it("refuses direct preparation when core profile evidence is incomplete", async () => {
    const userId = 98403;
    await upsertUserProfile({
      userId,
      resumeUrl: "https://example.com/resume.pdf",
    });
    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.automation.applyToJob({ jobId: 1 })).rejects.toThrow(
      "Core profile evidence is required"
    );
    await expect(caller.applications.create({ jobId: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Core profile evidence is required"),
    });
    expect(await getUserApplications(userId)).toHaveLength(0);
    expect(await listUserApplicationApprovals(userId, "all")).toHaveLength(0);
  });

  it("records a blocked decision without creating application materials", async () => {
    const userId = 98404;
    await upsertUserProfile({
      userId,
      resumeUrl: "https://example.com/resume.pdf",
    });
    const caller = appRouter.createCaller(createContext(userId));

    const result = await caller.applications.decide({
      jobId: 1,
      decision: "review",
      decisionReason: "This role should be considered once the candidate profile is complete.",
      reviewRequired: true,
    });
    const decisions = await getUserApplicationDecisions(userId);
    const auditEvents = await getAuditEventsForUser(userId, 10);

    expect(result).toMatchObject({
      success: true,
      applicationRecordId: null,
      preparationBlocked: true,
    });
    expect(decisions).toHaveLength(1);
    expect(await getUserApplications(userId)).toHaveLength(0);
    expect(await listUserApplicationApprovals(userId, "all")).toHaveLength(0);
    expect(auditEvents.some((event) =>
      event.action === "application_preparation_blocked_profile_readiness" &&
      event.afterState?.includes("Experience missing") &&
      event.afterState?.includes("Target roles missing")
    )).toBe(true);
  });
});
