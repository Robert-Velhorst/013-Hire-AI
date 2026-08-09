import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveResume: vi.fn(),
}));

vi.mock("./resumeStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resumeStorage")>()),
  getActiveResume: mocks.getActiveResume,
}));
import {
  getActionReadyFollowUpNextActions,
  getLocationPolicyNextActions,
  getUserAutonomousPlanPreview,
  getUserOperatingLedger,
} from "./applicationCampaigns";
import { createFollowUp, getFollowUps, markFollowUpSent, recordEmployerResponse, recordInterviewOutcome, scheduleInterview, updateInterviewStatus } from "./applicationFeatures";
import {
  createAdminReviewItem,
  createApplication,
  createApplicationApproval,
  createApplicationDecision,
  createEmployerResponse,
  createSuccessFee,
  getAuditEventsForEntity,
  getApplicationCampaign,
  listUserApplicationApprovals,
  requestUserConnectorConnection,
  upsertUserConnectorAccount,
  resolveApplicationApproval,
  upsertInterviewPreparation,
  upsertUserProfile,
} from "./db";

async function recordInterviewInvite(applicationId: number, userId: number) {
  await recordEmployerResponse({
    applicationId,
    responseType: "interview_invite",
    source: "email",
    sourceReference: `gmail-campaign-interview-${applicationId}`,
    summary: "Recruiter invited the candidate to a video interview.",
  }, userId);
}

describe("application campaign operating ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveResume.mockResolvedValue(null);
  });

  it("can return a bounded dashboard snapshot without creating campaign state", async () => {
    const userId = 99000;
    expect(await getApplicationCampaign(userId)).toBeFalsy();

    const ledger = await getUserOperatingLedger(userId, { persistCampaign: false });

    expect(ledger.campaign.id).toBe(0);
    expect(ledger.applicationOverview).toMatchObject({
      total: 0,
      submitted: 0,
      active: 0,
      interviewing: 0,
      recent: [],
    });
    expect(ledger.plan).toMatchObject({
      mode: expect.any(String),
      summary: expect.any(Object),
      evidenceGates: expect.any(Array),
    });
    expect(await getApplicationCampaign(userId)).toBeFalsy();
  });

  it("keeps preview decisions owner-scoped to the current job set", async () => {
    const userId = 99021;
    const otherUserId = 99022;
    await Promise.all([
      createApplicationDecision({
        userId,
        jobId: 1,
        decision: "ignore",
        reviewRequired: 0,
        decidedBy: "user",
      }),
      createApplicationDecision({
        userId: otherUserId,
        jobId: 2,
        decision: "ignore",
        reviewRequired: 0,
        decidedBy: "user",
      }),
    ]);

    const preview = await getUserAutonomousPlanPreview(userId);

    expect(preview.decisions.find((decision) => decision.jobId === 1)?.userDecisionLocked).toBe(true);
    expect(preview.decisions.find((decision) => decision.jobId === 2)?.userDecisionLocked).toBe(false);
    expect(preview.operatingScope.jobsLoaded).toBeLessThanOrEqual(250);
    expect(preview.operatingScope.applicationLimit).toBe(250);
  });

  it("reports preview truncation instead of hydrating an oversized active history", async () => {
    const userId = 99023;
    for (let index = 0; index < 251; index += 1) {
      await createApplication({
        userId,
        jobId: 40_000 + index,
        status: "applied",
        notes: "Historical confirmed application.",
      });
    }

    const preview = await getUserAutonomousPlanPreview(userId);

    expect(preview.operatingScope).toMatchObject({
      applicationsLoaded: 250,
      applicationLimit: 250,
      applicationsTruncated: true,
    });
  });

  it("keeps exact totals while bounding a large active operating history", async () => {
    const userId = 99019;
    for (let index = 0; index < 260; index += 1) {
      await createApplication({
        userId,
        jobId: 20_000 + index,
        status: "applied",
        notes: "Historical confirmed application.",
      });
    }

    const ledger = await getUserOperatingLedger(userId, { persistCampaign: false });

    expect(ledger.applicationOverview).toMatchObject({
      total: 260,
      submitted: 260,
      active: 260,
      operatingWindow: {
        loaded: 250,
        limit: 250,
        hasMore: true,
      },
    });
    expect(ledger.applicationOverview.recent).toHaveLength(10);
    expect(ledger.metrics.trackedApplications).toBe(260);
    expect(ledger.nextActions).toContain(
      "Processing is safely limited to the 250 oldest active applications in this cycle."
    );
  });

  it("keeps exact approval and review totals beyond bounded operating queues", async () => {
    const userId = 99020;
    for (let index = 0; index < 105; index += 1) {
      const application = await createApplication({
        userId,
        jobId: 30_000 + index,
        status: "pending",
      });
      const applicationId = Number(application.insertId);
      await createApplicationApproval({
        userId,
        applicationId,
        entityType: "application",
        entityId: applicationId,
        approvalType: "application_submission",
        status: "pending",
        riskLevel: "high",
        requestedBy: "system",
        title: `Review application ${index + 1}`,
      });
    }
    for (let jobId = 1; jobId <= 4; jobId += 1) {
      await createApplicationDecision({
        userId,
        jobId,
        decision: "review",
        reviewRequired: 1,
        decidedBy: "system",
      });
    }

    const ledger = await getUserOperatingLedger(userId, { persistCampaign: false });

    expect(ledger.metrics.pendingApprovals).toBe(105);
    expect(ledger.metrics.reviewRequiredDecisions).toBe(4);
    expect(ledger.queues.pendingApprovals).toHaveLength(5);
    expect(ledger.queues.reviewDecisions).toHaveLength(4);
    expect(ledger.nextActions).toEqual(expect.arrayContaining([
      "Resolve 105 pending user approvals.",
      "Review 4 saved application decisions.",
    ]));
  });

  it("syncs durable campaign state from current operating queues", async () => {
    const userId = 99001;
    const oldDate = new Date(Date.now() - 8 * 86400000);
    mocks.getActiveResume.mockResolvedValue({
      id: 99001,
      userId,
      fileName: "campaign-resume.pdf",
      fileUrl: "https://storage.example.local/resumes/99001/campaign-resume.pdf",
      fileKey: "resumes/99001/campaign-resume.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
      version: 1,
      isActive: true,
      uploadedAt: new Date(),
    });

    await upsertUserProfile({
      userId,
      skills: "React, TypeScript, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      salaryExpectationMin: 100000,
      resumeUrl: "https://example.com/resume.pdf",
      resumeFileKey: "resumes/99001/resume.pdf",
      preferences: JSON.stringify({
        createFollowUps: true,
        dailyApplicationLimit: 4,
        minMatchScore: 60,
        mode: "review_first",
      }),
    });
    const preparedApplication = await createApplication({
      userId,
      jobId: 1,
      status: "pending",
      notes: "Prepared for review.",
    });
    const preparedApplicationId = Number(preparedApplication.insertId);
    const staleApplication = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      appliedDate: oldDate,
      lastActivity: oldDate,
      notes: "Submission confirmed.",
    });
    const questionApplication = await createApplication({
      userId,
      jobId: 4,
      status: "viewed",
      appliedDate: oldDate,
      lastActivity: oldDate,
      notes: "Employer asked a follow-up question.",
    });
    await createEmployerResponse({
      applicationId: Number(questionApplication.insertId),
      userId,
      responseType: "employer_question",
      source: "email",
      summary: "Recruiter asked for availability and clarification on remote collaboration experience.",
      receivedAt: new Date(),
      statusBefore: "applied",
      statusAfter: "viewed",
    });
    await createApplicationApproval({
      userId,
      applicationId: preparedApplicationId,
      entityType: "application",
      entityId: preparedApplicationId,
      approvalType: "application_submission",
      status: "pending",
      riskLevel: "high",
      requestedBy: "system",
      title: "Approve external submission",
      description: "External submission requires explicit approval.",
    });
    await createAdminReviewItem({
      userId,
      entityType: "application",
      entityId: preparedApplicationId,
      category: "application_review",
      priority: "high",
      title: "Review prepared application",
      description: "Prepared application needs review before submission.",
    });
    await createApplicationDecision({
      userId,
      jobId: 1,
      decision: "review",
      decisionReason: "Human review required before applying.",
      matchScore: 84,
      riskLevel: "medium",
      reviewRequired: 1,
      reviewReason: "Needs custom answer.",
      decidedBy: "system",
    });

    const ledger = await getUserOperatingLedger(userId);
    const adminLedger = await getUserOperatingLedger(userId, { includeAdminReviews: true });
    const syncedCampaign = await getApplicationCampaign(userId);
    const ledgerAfterResync = await getUserOperatingLedger(userId);

    expect(ledger.campaign.title).toBe("Frontend Engineer campaign");
    expect(ledger.metrics.preparedApplications).toBe(1);
    expect(ledger.metrics.submittedApplications).toBe(2);
    expect(ledger.applicationOverview.recent.length).toBeLessThanOrEqual(10);
    expect(ledger.applicationOverview.recent[0]).not.toHaveProperty("customResume");
    expect(ledger.applicationOverview.recent[0]).not.toHaveProperty("notes");
    expect(ledger.metrics.employerResponsesNeedingReply).toBe(1);
    expect(ledger.metrics.connectorReadiness).toBe(1);
    expect(ledger.metrics.evidenceGates).toBeGreaterThan(0);
    expect(ledger.queues.evidenceGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("connector-inbox-response-monitoring"),
          blocks: expect.arrayContaining(["reply_monitoring", "follow_up_send"]),
        }),
      ])
    );
    expect(ledger.queues.connectorReadiness).toHaveLength(1);
    expect(ledger.queues.connectorReadiness[0]).toMatchObject({
      id: "inbox-response-monitoring",
      providerIds: ["gmail", "outlook"],
      affectedApplications: 2,
    });
    expect(ledger.metrics.pendingApprovals).toBe(1);
    expect(ledger.metrics.openAdminReviews).toBe(0);
    expect(ledger.queues.adminReviews).toHaveLength(0);
    expect(ledger.canReviewAdminItems).toBe(false);
    expect(adminLedger.metrics.openAdminReviews).toBe(1);
    expect(adminLedger.queues.adminReviews).toHaveLength(1);
    expect(adminLedger.canReviewAdminItems).toBe(true);
    expect(ledger.metrics.reviewRequiredDecisions).toBe(1);
    expect(ledger.queues.reviewDecisions[0]).toMatchObject({
      jobId: 1,
      applicationId: preparedApplicationId,
      application: {
        id: preparedApplicationId,
        status: "pending",
      },
      job: {
        id: 1,
      },
    });
    expect(ledger.metrics.followUpsDue).toBe(1);
    expect(ledger.followUpReadiness).toEqual({
      candidateCount: 2,
      actionReadyCount: 1,
      blockedCount: 1,
    });
    expect(ledger.queues.followUpsDue).toHaveLength(1);
    expect(ledger.queues.followUpsDue[0]).toMatchObject({
      applicationId: Number(staleApplication.insertId),
      jobId: 2,
      messageType: "reminder",
    });
    expect(ledger.queues.employerResponsesNeedingReply).toHaveLength(1);
    expect(ledger.queues.employerResponsesNeedingReply[0]).toMatchObject({
      applicationId: Number(questionApplication.insertId),
      jobId: 4,
      responseType: "employer_question",
    });
    expect(ledger.readiness.autoApplyEligible).toBe(true);
    expect(syncedCampaign?.readinessScore).toBe(ledger.readiness.score);
    expect(syncedCampaign?.autoApplyEligible).toBe(1);
    expect(JSON.parse(syncedCampaign?.lastPlanSummary || "{}")).toMatchObject({
      followUpsDue: 2,
      followUpsActionReady: 1,
      followUpsBlocked: 1,
    });
    expect(ledger.nextActions.some((action) => action.includes("pending user approval"))).toBe(true);
    expect(ledger.nextActions).toContain("Draft 1 timely follow-up message.");
    expect(ledger.nextActions).not.toContain("Draft 2 timely follow-up messages.");
    expect(ledger.nextActions.some((action) => action.includes("Reply to 1 employer question"))).toBe(true);
    expect(ledger.nextActions.some((action) => action.includes("connector setup"))).toBe(true);
    expect(ledger.nextActions.some((action) => action.includes("autonomous evidence gate"))).toBe(true);
    expect(ledgerAfterResync.campaign.id).toBe(ledger.campaign.id);
  });

  it("replaces raw follow-up action counts with action-ready ledger state", () => {
    const plan = {
      summary: { followUpsDue: 3 },
      nextActions: [
        "Review 1 high-fit job before submission.",
        "Draft 3 timely follow-up messages.",
      ],
    } as any;

    expect(getActionReadyFollowUpNextActions(plan, {
      actionReadyCount: 0,
      blockedCount: 3,
    })).toEqual([
      "Review 1 high-fit job before submission.",
      "3 follow-up candidates are held by an existing draft, response, or interview workflow.",
    ]);
  });

  it("promotes remote-only policy actions into the persisted command-center ledger", () => {
    expect(getLocationPolicyNextActions({
      nextActions: [
        "Keep scouting and wait for stronger matches.",
        "Excluded 2 hybrid or on-site roles under the remote-only campaign policy.",
        "Review 1 role with unverified remote eligibility before preparation.",
      ],
    })).toEqual([
      "Excluded 2 hybrid or on-site roles under the remote-only campaign policy.",
      "Review 1 role with unverified remote eligibility before preparation.",
    ]);
  });

  it("surfaces requested connector OAuth completion without claiming external access", async () => {
    const userId = 99009;
    mocks.getActiveResume.mockResolvedValueOnce({
      id: 99009,
      userId,
      fileName: "resume.pdf",
      fileUrl: "https://storage.example.local/resumes/99009/resume.pdf",
      fileKey: "resumes/99009/resume.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
      version: 1,
      isActive: true,
      uploadedAt: new Date(),
    });
    await upsertUserProfile({
      userId,
      skills: "TypeScript, React, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/resume.pdf",
      resumeFileKey: "resumes/99009/resume.pdf",
    });
    await requestUserConnectorConnection({
      userId,
      provider: "gmail",
      consentScopes: ["email.metadata.read", "email.messages.read_recruiting"],
    });
    await requestUserConnectorConnection({
      userId,
      provider: "linkedin",
      consentScopes: ["profile.basic.read"],
    });

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.connectorReadiness).toBe(1);
    expect(ledger.metrics.evidenceGates).toBeGreaterThan(0);
    expect(ledger.queues.evidenceGates.map((gate) => gate.id)).toContain("connector-gmail");
    expect(ledger.queues.connectorReadiness[0]).toMatchObject({
      id: "gmail",
      label: "Gmail setup",
      status: "connection_requested",
      providerIds: ["gmail"],
    });
    expect(ledger.profileEvidence.providers.find((provider) => provider.id === "linkedin")).toMatchObject({
      status: "consent_required",
      connectionStatus: "connection_requested",
      consentScopes: ["profile.basic.read"],
    });
    expect(JSON.stringify(ledger)).not.toContain("accessToken");
  });

  it("keeps cloud resume discovery visible until an active resume artifact exists", async () => {
    const userId = 99011;
    await upsertUserProfile({
      userId,
      skills: "TypeScript, React, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://stale.example.com/resume.pdf",
      resumeFileKey: "resumes/99011/stale-resume.pdf",
    });

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.profileEvidence.providers.find((provider) => provider.id === "resume")?.status).toBe("missing");
    expect(ledger.queues.connectorReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cloud-resume-discovery",
          providerIds: ["google_drive", "dropbox"],
          status: "not_connected",
        }),
      ])
    );
    expect(ledger.queues.evidenceGates.map((gate) => gate.id)).toContain("connector-cloud-resume-discovery");
  });

  it("keeps inbox response monitoring blocked until a requested connector is actually connected", async () => {
    const userId = 99010;
    await upsertUserProfile({
      userId,
      skills: "TypeScript, React, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/resume.pdf",
      resumeFileKey: "resumes/99010/resume.pdf",
    });
    await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      notes: "Submitted application awaiting an employer response.",
    });
    await requestUserConnectorConnection({
      userId,
      provider: "gmail",
      consentScopes: ["email.metadata.read", "email.messages.read_recruiting"],
    });

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.queues.connectorReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "gmail",
          status: "connection_requested",
        }),
        expect.objectContaining({
          id: "inbox-response-monitoring",
          providerIds: ["gmail", "outlook"],
          affectedApplications: 1,
        }),
      ])
    );
    expect(ledger.queues.evidenceGates.map((gate) => gate.id)).toEqual(
      expect.arrayContaining(["connector-gmail", "connector-inbox-response-monitoring"])
    );
  });

  it("keeps inbox response monitoring gated when a connected connector lacks recruiting-message consent", async () => {
    const userId = 99012;
    mocks.getActiveResume.mockResolvedValueOnce({
      id: userId,
      userId,
      fileName: "resume.pdf",
      fileUrl: "https://storage.example.local/resumes/99012/resume.pdf",
      fileKey: "resumes/99012/resume.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
      version: 1,
      isActive: true,
      uploadedAt: new Date(),
    });
    await upsertUserProfile({
      userId,
      skills: "TypeScript, React, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/resume.pdf",
      resumeFileKey: "resumes/99012/resume.pdf",
    });
    await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      notes: "Submitted application awaiting an employer response.",
    });
    await upsertUserConnectorAccount({
      userId,
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify(["email.metadata.read"]),
      externalAccountLabel: "candidate@example.com",
      lastVerifiedAt: new Date(),
    });

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.profileEvidence.providers.find((provider) => provider.id === "gmail")).toMatchObject({
      status: "consent_required",
      connectionStatus: "connected",
      authorizationIncomplete: true,
    });
    expect(ledger.queues.connectorReadiness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "gmail",
        status: "connected",
        providerIds: ["gmail"],
      }),
      expect.objectContaining({
        id: "inbox-response-monitoring",
        providerIds: ["gmail", "outlook"],
        affectedApplications: 1,
      }),
    ]));
    expect(ledger.queues.evidenceGates.map((gate) => gate.id)).toEqual(
      expect.arrayContaining(["connector-gmail", "connector-inbox-response-monitoring"])
    );
  });

  it("surfaces success-fee compliance obligations in the operating ledger", async () => {
    const userId = 99008;
    const overdueDate = new Date(Date.now() - 2 * 86400000);
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "offer",
      notes: "Offer received and needs attribution review.",
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
      title: "Confirm offer attribution",
      description: "Confirm whether this offer came from Hire.AI activity.",
    });
    await createSuccessFee({
      userId,
      applicationId,
      employerName: "Remote Ledger Co",
      jobTitle: "Frontend Engineer",
      monthlySalary: 9000,
      monthlyFeeAmount: 45000,
      status: "active",
      startDate: new Date(Date.now() - 95 * 86400000),
      nextVerificationDue: overdueDate,
      verificationGraceExpiry: new Date(Date.now() + 12 * 86400000),
      termsAcceptedAt: new Date(Date.now() - 95 * 86400000),
    });

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.successFeeCompliance.status).toBe("needs_attention");
    expect(ledger.metrics.activeSuccessFees).toBe(1);
    expect(ledger.metrics.pendingOfferAttributions).toBe(1);
    expect(ledger.metrics.overdueSuccessFeeVerifications).toBe(1);
    expect(ledger.queues.successFeeCompliance.map((item) => item.type)).toEqual(
      expect.arrayContaining(["offer_attribution", "verification_overdue"])
    );
    expect(ledger.nextActions).toContain("Review offer attribution and report hires that came through Hire.AI.");
    expect(ledger.blockers).toContain("Success-fee compliance needs attention");
  });

  it("queues upcoming scheduled interviews until preparation is persisted", async () => {
    const userId = 99006;
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
      scheduledAt: new Date(Date.now() + 3 * 86400000),
      duration: 45,
      meetingLink: "https://meet.example.com/hire-ai",
      interviewerName: "Recruiter",
    }, userId);
    await upsertInterviewPreparation({
      userId: 99007,
      jobId: 2,
      questions: JSON.stringify(["Other user's preparation must not suppress this queue."]),
    });

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.interviewSchedulingNeeded).toBe(0);
    expect(ledger.metrics.interviewPreparationNeeded).toBe(1);
    expect(ledger.queues.interviewPreparationNeeded).toHaveLength(1);
    expect(ledger.queues.interviewPreparationNeeded[0]).toMatchObject({
      interviewId: scheduled.id,
      applicationId,
      jobId: 2,
      interviewType: "video",
    });
    expect(ledger.nextActions).toContain("Prepare for 1 upcoming interview.");

    await upsertInterviewPreparation({
      userId,
      jobId: 2,
      questions: JSON.stringify(["How would you summarize your relevant experience?"]),
      coachingTips: JSON.stringify(["Use verified resume evidence."]),
      companyInsights: "Prepare against the saved job evidence.",
    });

    const updatedLedger = await getUserOperatingLedger(userId);

    expect(updatedLedger.metrics.interviewPreparationNeeded).toBe(0);
    expect(updatedLedger.queues.interviewPreparationNeeded).toHaveLength(0);
  });

  it("keeps an exact preparation total while bounding upcoming interview records", async () => {
    const userId = 99024;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      notes: "Multi-round interview process.",
    });
    const applicationId = Number(application.insertId);
    for (let index = 0; index < 12; index += 1) {
      await recordEmployerResponse({
        applicationId,
        responseType: "interview_invite",
        source: "email",
        sourceReference: `gmail-campaign-round-${applicationId}-${index}`,
        summary: `Employer invited the candidate to interview round ${index + 1}.`,
      }, userId);
      await scheduleInterview({
        applicationId,
        interviewType: "video",
        scheduledAt: new Date(Date.now() + (index + 1) * 3_600_000),
        duration: 30,
        interviewerName: `Interviewer ${index + 1}`,
      }, userId);
    }

    const ledger = await getUserOperatingLedger(userId, { persistCampaign: false });

    expect(ledger.metrics.interviewPreparationNeeded).toBe(12);
    expect(ledger.queues.interviewPreparationNeeded).toHaveLength(5);
    expect(ledger.interviewPreparationScope).toEqual({
      loaded: 10,
      limit: 10,
      hasMore: true,
    });
    expect(ledger.nextActions).toContain("Prepare for 12 upcoming interviews.");
  });

  it("surfaces interview-status applications that still need scheduling", async () => {
    const userId = 99002;
    const futureInterview = new Date(Date.now() + 7 * 86400000);

    await upsertUserProfile({
      userId,
      skills: "TypeScript, React, stakeholder communication",
      experience: "Four years shipping customer-facing product work.",
      desiredJobTypes: "Product Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/product-engineer.pdf",
      resumeFileKey: "resumes/99004/product-engineer.pdf",
      preferences: JSON.stringify({ createFollowUps: true }),
    });
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      lastActivity: new Date(Date.now() - 7 * 86400000),
      notes: "Employer invited candidate to schedule a video interview.",
    });
    await recordInterviewInvite(Number(application.insertId), userId);

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.interviewSchedulingNeeded).toBe(1);
    expect(ledger.metrics.followUpsDue).toBe(0);
    expect(ledger.queues.interviewScheduling).toHaveLength(1);
    expect(ledger.queues.followUpsDue).toHaveLength(0);
    expect(ledger.queues.interviewScheduling[0].applicationId).toBe(Number(application.insertId));
    expect(ledger.nextActions.some((action) => action.includes("Review 1 interview scheduling item"))).toBe(true);

    await scheduleInterview({
      applicationId: Number(application.insertId),
      interviewType: "video",
      scheduledAt: futureInterview,
      duration: 45,
      meetingLink: "https://meet.example.com/interview",
    }, userId);

    const ledgerAfterScheduling = await getUserOperatingLedger(userId);

    expect(ledgerAfterScheduling.metrics.interviewSchedulingNeeded).toBe(0);
    expect(ledgerAfterScheduling.queues.interviewScheduling).toHaveLength(0);
  });

  it("returns cancelled interview schedules to the operator review queue", async () => {
    const userId = 99011;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      notes: "A scheduled interview was later cancelled.",
    });
    const applicationId = Number(application.insertId);
    await recordInterviewInvite(applicationId, userId);
    const interview = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 3 * 86400000),
    }, userId);
    await updateInterviewStatus(interview.id, "cancelled", userId);

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.interviewSchedulingNeeded).toBe(1);
    expect(ledger.queues.interviewScheduling).toHaveLength(1);
    expect(ledger.queues.interviewScheduling[0]).toMatchObject({
      applicationId,
      schedulingRequirement: "cancelled_schedule",
    });
    expect(ledger.nextActions).toContain("Review 1 interview scheduling item before follow-up automation continues.");
  });

  it("returns a later interview invite to the scheduling queue after a completed round", async () => {
    const userId = 99019;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      notes: "The first interview round was completed.",
    });
    const applicationId = Number(application.insertId);
    await recordInterviewInvite(applicationId, userId);
    const firstRound = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 2 * 86400000),
    }, userId);

    await recordInterviewOutcome({
      interviewId: firstRound.id,
      outcome: "next_round",
      source: "email",
      sourceReference: `gmail-campaign-next-round-${firstRound.id}`,
      summary: "The recruiter invited the candidate to a technical interview next week.",
    }, userId);

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.interviewSchedulingNeeded).toBe(1);
    expect(ledger.metrics.followUpsDue).toBe(0);
    expect(ledger.queues.interviewScheduling).toHaveLength(1);
    expect(ledger.queues.interviewScheduling[0]).toMatchObject({
      applicationId,
      schedulingRequirement: "new_invite",
    });

    await scheduleInterview({
      applicationId,
      interviewType: "technical",
      scheduledAt: new Date(Date.now() + 5 * 86400000),
    }, userId);

    const ledgerAfterScheduling = await getUserOperatingLedger(userId);
    expect(ledgerAfterScheduling.metrics.interviewSchedulingNeeded).toBe(0);
    expect(ledgerAfterScheduling.queues.interviewScheduling).toHaveLength(0);
  });

  it("surfaces completed interviews until their linked outcome is recorded", async () => {
    const userId = 99013;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      notes: "A completed interview needs a result in the operating ledger.",
    });
    const applicationId = Number(application.insertId);
    await recordInterviewInvite(applicationId, userId);
    const interview = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 2 * 86400000),
    }, userId);
    await updateInterviewStatus(interview.id, "completed", userId);

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.interviewOutcomesNeeded).toBe(1);
    expect(ledger.metrics.followUpsDue).toBe(0);
    expect(ledger.queues.interviewOutcomesNeeded).toMatchObject([
      { interviewId: interview.id, applicationId, interviewType: "video" },
    ]);
    expect(ledger.nextActions).toContain("Record outcomes for 1 completed interview before routine follow-ups continue.");

    const outcome = await recordInterviewOutcome({
      interviewId: interview.id,
      outcome: "no_response",
      source: "email",
      summary: "No employer response has arrived since the completed interview.",
    }, userId);
    const ledgerAfterOutcome = await getUserOperatingLedger(userId);

    expect(outcome.responseType).toBe("no_response");
    expect(ledgerAfterOutcome.metrics.interviewOutcomesNeeded).toBe(0);
    expect(ledgerAfterOutcome.queues.interviewOutcomesNeeded).toHaveLength(0);
  });

  it("tracks outcomes separately for each completed interview round", async () => {
    const userId = 99014;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "interview",
      notes: "The first round progressed and the second round still needs an outcome.",
    });
    const applicationId = Number(application.insertId);
    await recordInterviewInvite(applicationId, userId);
    const firstRound = await scheduleInterview({
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 2 * 86400000),
    }, userId);
    await updateInterviewStatus(firstRound.id, "completed", userId);
    await recordInterviewOutcome({
      interviewId: firstRound.id,
      outcome: "next_round",
      source: "email",
      sourceReference: `gmail-campaign-next-round-${firstRound.id}`,
      summary: "Recruiter confirmed that the candidate will progress to a technical interview.",
    }, userId);

    const secondRound = await scheduleInterview({
      applicationId,
      interviewType: "technical",
      scheduledAt: new Date(Date.now() + 5 * 86400000),
    }, userId);
    await updateInterviewStatus(secondRound.id, "completed", userId);

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.interviewOutcomesNeeded).toBe(1);
    expect(ledger.queues.interviewOutcomesNeeded).toMatchObject([
      { interviewId: secondRound.id, applicationId, interviewType: "technical" },
    ]);
    expect(ledger.queues.interviewOutcomesNeeded.some((item) => item.interviewId === firstRound.id)).toBe(false);
  });

  it("suppresses routine follow-up queue items once an active draft approval exists", async () => {
    const userId = 99003;
    const oldDate = new Date(Date.now() - 8 * 86400000);

    await upsertUserProfile({
      userId,
      skills: "TypeScript, React, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/frontend-resume.pdf",
      resumeFileKey: "resumes/99005/frontend-resume.pdf",
      preferences: JSON.stringify({ createFollowUps: true }),
    });
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      appliedDate: oldDate,
      lastActivity: oldDate,
      notes: "Submitted and stale enough for a follow-up.",
    });
    const applicationId = Number(application.insertId);

    await createFollowUp({
      applicationId,
      message: "Hi, I am checking in on my submitted application.",
    }, userId);

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.followUpsDue).toBe(0);
    expect(ledger.queues.followUpsDue).toHaveLength(0);
    expect(ledger.metrics.pendingApprovals).toBe(1);
    expect(ledger.queues.pendingApprovals[0]).toMatchObject({
      entityType: "follow_up",
      approvalType: "follow_up_send",
    });
    expect(ledger.nextActions.some((action) => action.includes("pending user approval"))).toBe(true);
  });

  it("suppresses employer response reply queue items once a reply draft approval exists", async () => {
    const userId = 99004;

    await upsertUserProfile({
      userId,
      skills: "Python, APIs, distributed teams",
      experience: "Six years building backend services.",
      desiredJobTypes: "Backend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/backend-resume.pdf",
      resumeFileKey: "resumes/99006/backend-resume.pdf",
      preferences: JSON.stringify({ createFollowUps: true }),
    });
    const application = await createApplication({
      userId,
      jobId: 3,
      status: "viewed",
      notes: "Recruiter asked a question after viewing the application.",
    });
    const applicationId = Number(application.insertId);
    const response = await recordEmployerResponse({
      applicationId,
      responseType: "employer_question",
      source: "email",
      summary: "Recruiter asked for availability and remote collaboration details.",
      receivedAt: new Date(),
    }, userId);

    await createFollowUp({
      applicationId,
      message: "Hi, thanks for reaching out. [Add exact availability here.]",
      purpose: "employer_reply",
      sourceResponseId: response.responseId,
    }, userId);

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.employerResponsesNeedingReply).toBe(0);
    expect(ledger.queues.employerResponsesNeedingReply).toHaveLength(0);
    expect(ledger.metrics.pendingApprovals).toBe(1);
    expect(ledger.queues.pendingApprovals[0]?.payload).toContain('"purpose":"employer_reply"');
    expect(ledger.nextActions.some((action) => action.includes("Reply to 1 employer question"))).toBe(false);
  });

  it("surfaces approved unsent follow-up drafts as send handoffs", async () => {
    const userId = 99005;
    const oldDate = new Date(Date.now() - 8 * 86400000);

    await upsertUserProfile({
      userId,
      skills: "React, TypeScript, customer communication",
      experience: "Five years building customer-facing software.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/frontend-resume.pdf",
      resumeFileKey: "resumes/99007/frontend-resume.pdf",
      preferences: JSON.stringify({ createFollowUps: true }),
    });
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      appliedDate: oldDate,
      lastActivity: oldDate,
      notes: "Submitted application with an approved follow-up draft.",
    });
    const applicationId = Number(application.insertId);
    const followUp = await createFollowUp({
      applicationId,
      message: "Hi, I am checking in on my submitted application.",
    }, userId);
    const approval = (await listUserApplicationApprovals(userId, "pending")).find((item) =>
      item.entityType === "follow_up" &&
      item.entityId === followUp.id &&
      item.approvalType === "follow_up_send"
    );
    expect(approval).toBeTruthy();

    await resolveApplicationApproval(
      approval!.id,
      userId,
      "approved",
      "Approved follow-up draft for manual send handoff.",
      "user"
    );

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.pendingApprovals).toBe(0);
    expect(ledger.metrics.followUpsDue).toBe(0);
    expect(ledger.metrics.approvedFollowUpsReadyToSend).toBe(1);
    expect(ledger.queues.approvedFollowUpsReadyToSend).toHaveLength(1);
    expect(ledger.queues.approvedFollowUpsReadyToSend[0]).toMatchObject({
      applicationId,
      followUpId: followUp.id,
      approvalId: approval!.id,
      purpose: "routine_follow_up",
    });
    expect(ledger.nextActions.some((action) =>
      action.includes("Record send handoff for 1 approved follow-up draft")
    )).toBe(true);

    await markFollowUpSent(
      followUp.id,
      userId,
      "Sent through the candidate's email account after approval."
    );
    const ledgerAfterSent = await getUserOperatingLedger(userId);

    expect(ledgerAfterSent.metrics.approvedFollowUpsReadyToSend).toBe(0);
    expect(ledgerAfterSent.queues.approvedFollowUpsReadyToSend).toHaveLength(0);
  });

  it("retires approved unsent follow-up handoffs when an employer response arrives", async () => {
    const userId = 99007;
    const oldDate = new Date(Date.now() - 8 * 86400000);

    await upsertUserProfile({
      userId,
      skills: "React, TypeScript, customer communication",
      experience: "Five years building customer-facing software.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/frontend-resume.pdf",
      resumeFileKey: "resumes/99010/frontend-resume.pdf",
      preferences: JSON.stringify({ createFollowUps: true }),
    });
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      appliedDate: oldDate,
      lastActivity: oldDate,
      notes: "Submitted application with an approved follow-up draft.",
    });
    const applicationId = Number(application.insertId);
    const followUp = await createFollowUp({
      applicationId,
      message: "Hi, I am checking in on my submitted application.",
    }, userId);
    const approval = (await listUserApplicationApprovals(userId, "pending")).find((item) =>
      item.entityType === "follow_up" &&
      item.entityId === followUp.id &&
      item.approvalType === "follow_up_send"
    );
    expect(approval).toBeTruthy();

    await resolveApplicationApproval(
      approval!.id,
      userId,
      "approved",
      "Approved follow-up draft for manual send handoff.",
      "user"
    );

    expect((await getUserOperatingLedger(userId)).metrics.approvedFollowUpsReadyToSend).toBe(1);

    await recordEmployerResponse({
      applicationId,
      responseType: "employer_question",
      source: "email",
      summary: "Recruiter replied with a new question, making the old follow-up stale.",
      receivedAt: new Date(),
    }, userId);

    const ledger = await getUserOperatingLedger(userId);
    const approvals = await listUserApplicationApprovals(userId, "all");
    const staleApproval = approvals.find((item) => item.id === approval!.id);
    const auditEvents = await getAuditEventsForEntity(userId, "application", applicationId);

    expect(staleApproval?.status).toBe("cancelled");
    expect(staleApproval?.decisionNote).toContain("unsent follow-up draft stale");
    expect(ledger.metrics.approvedFollowUpsReadyToSend).toBe(0);
    expect(ledger.queues.approvedFollowUpsReadyToSend).toHaveLength(0);
    expect(ledger.metrics.employerResponsesNeedingReply).toBe(1);
    expect(auditEvents.some((event) =>
      event.action === "stale_follow_up_approvals_cancelled" &&
      event.afterState?.includes(`"cancelledApprovalIds":[${approval!.id}]`) &&
      event.afterState?.includes('"cancelledStatuses":["approved"]')
    )).toBe(true);
  });

  it("moves an uncertain connected-mail follow-up out of the send handoff queue", async () => {
    const userId = 99028;
    await upsertUserProfile({
      userId,
      skills: "React, TypeScript, customer communication",
      experience: "Five years building customer-facing software.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/frontend-resume.pdf",
      resumeFileKey: "resumes/99011/frontend-resume.pdf",
      preferences: JSON.stringify({ createFollowUps: true }),
    });
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      appliedDate: new Date(Date.now() - 8 * 86400000),
      lastActivity: new Date(Date.now() - 8 * 86400000),
      notes: "Submitted application with an uncertain mailbox delivery.",
    });
    const applicationId = Number(application.insertId);
    const followUp = await createFollowUp({
      applicationId,
      message: "Hi, I am checking in on my submitted application.",
    }, userId);
    const approval = (await listUserApplicationApprovals(userId, "pending")).find((item) =>
      item.entityType === "follow_up" && item.entityId === followUp.id
    );
    expect(approval).toBeTruthy();

    await resolveApplicationApproval(
      approval!.id,
      userId,
      "approved",
      "Approved follow-up for connected mailbox delivery.",
      "user"
    );
    const [storedFollowUp] = await getFollowUps(applicationId, userId);
    storedFollowUp.deliveryState = "sending";
    storedFollowUp.deliveryProvider = "gmail";
    storedFollowUp.deliveryRecipient = "recruiter@example.com";

    const ledger = await getUserOperatingLedger(userId);

    expect(ledger.metrics.approvedFollowUpsReadyToSend).toBe(0);
    expect(ledger.metrics.followUpDeliveryReconciliation).toBe(1);
    expect(ledger.queues.approvedFollowUpsReadyToSend).toHaveLength(0);
    expect(ledger.queues.followUpDeliveryReconciliation).toMatchObject([{
      followUpId: followUp.id,
      applicationId,
      deliveryState: "sending",
      deliveryProvider: "gmail",
      deliveryRecipient: "recruiter@example.com",
    }]);
    expect(ledger.nextActions).toContain("Verify 1 uncertain mailbox delivery before any retry.");
  });
});
