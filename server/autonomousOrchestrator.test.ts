import { describe, expect, it } from "vitest";
import type { Application, Job, UserProfile } from "../drizzle/schema";
import {
  buildAutonomousPlan,
  getExecutableDecisions,
  isJobCurrentForAutonomousProcessing,
  parseAutonomousPreferences,
} from "./autonomousOrchestrator";

const baseJob: Job = {
  id: 1,
  externalId: "job-1",
  title: "Senior React Engineer",
  company: "Example Co",
  description: "Build React and TypeScript products with Node.js.",
  requirements: "React, TypeScript, Node.js",
  responsibilities: null,
  benefits: null,
  location: "Remote - Worldwide",
  jobType: "full-time",
  salaryMin: 120000,
  salaryMax: 160000,
  salaryCurrency: "USD",
  skills: "React, TypeScript, Node.js",
  applicationUrl: "https://boards.greenhouse.io/example/jobs/1",
  applicationEmail: null,
  applicationProcess: "greenhouse",
  platformId: 1,
  sourceUrl: null,
  postedDate: new Date(),
  expiryDate: null,
  isActive: 1,
  visaSponsorshipAvailable: 1,
  openHiringSupport: 0,
  diversityFriendly: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const profile: Partial<UserProfile> = {
  skills: "React, TypeScript, Node.js",
  desiredJobTypes: "full-time",
  desiredLocations: "remote, worldwide",
  salaryExpectationMin: 100000,
  resumeUrl: "https://example.com/resume.pdf",
};

describe("autonomous orchestrator", () => {
  it("normalizes unsafe persisted daily limits", () => {
    expect(parseAutonomousPreferences("{}").autonomousEnabled).toBe(false);
    expect(parseAutonomousPreferences('{"autonomousEnabled":true}').autonomousEnabled).toBe(true);
    expect(parseAutonomousPreferences('{"dailyApplicationLimit":100}').dailyApplicationLimit).toBe(25);
    expect(parseAutonomousPreferences('{"dailyApplicationLimit":0}').dailyApplicationLimit).toBe(1);
    expect(parseAutonomousPreferences('{"dailyApplicationLimit":7.6}').dailyApplicationLimit).toBe(8);
    expect(parseAutonomousPreferences('{"minMatchScore":140}').minMatchScore).toBe(100);
    expect(parseAutonomousPreferences('{"minMatchScore":-10}').minMatchScore).toBe(0);
  });

  it("queues review when human review is required", () => {
    const plan = buildAutonomousPlan([baseJob], profile, [], {
      mode: "auto_apply",
      requireHumanReview: true,
      minMatchScore: 70,
    });

    expect(plan.summary.queuedForReview).toBe(1);
    expect(plan.summary.queuedForApply).toBe(0);
    expect(plan.decisions[0].reviewRequired).toBe(true);
  });

  it("requires review when employer-portal handoff remains manual", () => {
    const plan = buildAutonomousPlan([baseJob], profile, [], {
      mode: "auto_apply",
      requireHumanReview: false,
      minMatchScore: 70,
    });

    expect(plan.summary.queuedForApply).toBe(0);
    expect(plan.summary.queuedForReview).toBe(1);
    expect(plan.decisions[0].automationSupported).toBe(false);
    expect(plan.decisions[0].automationNotes.join(" ")).toContain("does not access employer portal forms");
    expect(plan.decisions[0].automationNotes.join(" ")).not.toContain("form may be prepared automatically");
  });

  it("blocks explicit payment or forwarding signals before autonomous preparation", () => {
    const plan = buildAutonomousPlan([{
      ...baseJob,
      description: "Deposit the company check, retain a fee, and transfer the remaining funds.",
    }], profile, [], {
      mode: "auto_apply",
      requireHumanReview: false,
      minMatchScore: 0,
    });

    expect(plan.decisions[0].action).toBe("blocked");
    expect(plan.decisions[0].blockers.join(" ")).toContain("check handling");
  });

  it("queues ambiguous listing-safety signals for review instead of applying", () => {
    const plan = buildAutonomousPlan([{
      ...baseJob,
      applicationEmail: "recruiting@example@gmail.com",
    }], profile, [], {
      mode: "auto_apply",
      requireHumanReview: false,
      minMatchScore: 0,
    });

    expect(plan.decisions[0].action).toBe("queue_for_review");
    expect(plan.decisions[0].automationNotes.join(" ")).toContain("consumer email domain");
  });

  it("keeps jobs outside explicit target roles out of autonomous queues", () => {
    const plan = buildAutonomousPlan([baseJob], {
      ...profile,
      desiredJobTypes: "Product Designer",
    }, [], {
      minMatchScore: 0,
      dailyApplicationLimit: 2,
    });

    expect(plan.decisions[0]).toMatchObject({ action: "skip" });
    expect(plan.decisions[0].blockers).toContain("Role does not match the user's target preferences");
  });

  it("keeps jurisdiction-restricted remote roles out of incompatible location queues", () => {
    const usOnlyRemoteJob: Job = {
      ...baseJob,
      location: "Remote - US Only",
    };
    const plan = buildAutonomousPlan([usOnlyRemoteJob], {
      ...profile,
      desiredLocations: "Europe",
    }, [], {
      minMatchScore: 0,
      dailyApplicationLimit: 2,
    });

    expect(plan.decisions[0].action).toBe("skip");
    expect(plan.decisions[0].blockers).toContain("Location does not match the user's stated preferences");
  });

  it("queues a currency mismatch for review instead of treating it as a salary match", () => {
    const internationalJob: Job = {
      ...baseJob,
      salaryMin: 70000,
      salaryMax: 90000,
      salaryCurrency: "EUR",
    };
    const plan = buildAutonomousPlan([internationalJob], {
      ...profile,
      salaryExpectationCurrency: "USD",
    }, [], {
      minMatchScore: 0,
      dailyApplicationLimit: 2,
    });

    expect(plan.decisions[0].action).toBe("queue_for_review");
    expect(plan.decisions[0].blockers.join(" ")).toContain("EUR");
    expect(plan.decisions[0].blockers.join(" ")).toContain("USD");
  });

  it("keeps hybrid and on-site roles out of the remote-only campaign by default", () => {
    const hybridJob: Job = {
      ...baseJob,
      location: "Hybrid - Amsterdam, Netherlands",
    };
    const plan = buildAutonomousPlan([hybridJob], profile, [], {
      minMatchScore: 0,
      dailyApplicationLimit: 2,
    });

    expect(plan.decisions[0]).toMatchObject({ action: "skip", reviewRequired: true });
    expect(plan.decisions[0].blockers).toContain("Remote-only policy excludes hybrid and on-site roles");
    expect(plan.nextActions).toContain("Excluded 1 hybrid or on-site role under the remote-only campaign policy.");
  });

  it("keeps an unclassified location review-required under the remote-only campaign policy", () => {
    const locationUnknownJob: Job = {
      ...baseJob,
      location: "Amsterdam, Netherlands",
    };
    const plan = buildAutonomousPlan([locationUnknownJob], profile, [], {
      mode: "auto_apply",
      requireHumanReview: false,
      minMatchScore: 0,
      dailyApplicationLimit: 2,
    });

    expect(plan.decisions[0].reviewRequired).toBe(true);
    expect(plan.decisions[0].automationNotes).toContain(
      "Remote eligibility is not explicit in the listing and requires review before preparation."
    );
    expect(plan.nextActions).toContain("Review 1 role with unverified remote eligibility before preparation.");
  });

  it("enforces daily limits for review preparation", () => {
    const todayApplication: Application = {
      id: 20,
      userId: 1,
      jobId: 99,
      status: "pending",
      appliedDate: null,
      lastActivity: null,
      coverLetter: null,
      customResume: null,
      notes: "Autonomous queue",
      isAutoApplied: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = buildAutonomousPlan([baseJob], profile, [todayApplication], {
      mode: "auto_apply",
      requireHumanReview: false,
      dailyApplicationLimit: 1,
    });

    expect(plan.summary.dailyRemaining).toBe(0);
    expect(plan.summary.queuedForApply).toBe(0);
    expect(plan.summary.queuedForReview).toBe(0);
    expect(plan.decisions[0].action).toBe("skip");
    expect(plan.decisions[0].automationNotes).toContain(
      "Daily preparation limit reached; this job will be reconsidered on a future run."
    );
  });

  it("uses the exact preparation counter when the operating window is bounded", () => {
    const plan = buildAutonomousPlan(
      [baseJob],
      profile,
      [],
      {
        mode: "auto_apply",
        requireHumanReview: false,
        dailyApplicationLimit: 2,
      },
      true,
      [],
      { autonomousPreparationsToday: 2 }
    );

    expect(plan.summary.dailyRemaining).toBe(0);
    expect(plan.decisions[0].action).toBe("skip");
  });

  it("allows a pending preparation to be reconciled without treating it as submitted", () => {
    const pendingPreparation: Application = {
      id: 22,
      userId: 1,
      jobId: baseJob.id,
      status: "pending",
      appliedDate: null,
      lastActivity: null,
      coverLetter: null,
      customResume: null,
      notes: "Preparation was interrupted before its ledger artifacts were recorded.",
      isAutoApplied: 0,
      createdAt: new Date(Date.now() - 86400000),
      updatedAt: new Date(),
    };

    const plan = buildAutonomousPlan([baseJob], profile, [pendingPreparation], {
      minMatchScore: 70,
      dailyApplicationLimit: 2,
    });

    expect(plan.decisions[0].action).toBe("queue_for_review");
    expect(plan.decisions[0].blockers).not.toContain("Already applied to this job");
  });

  it("keeps an explicit user decision out of autonomous preparation", () => {
    const plan = buildAutonomousPlan([baseJob], profile, [], {
      minMatchScore: 0,
      dailyApplicationLimit: 2,
    }, undefined, [baseJob.id]);

    expect(plan.summary.queuedForReview).toBe(0);
    expect(plan.decisions[0]).toMatchObject({
      action: "skip",
      userDecisionLocked: true,
    });
    expect(plan.decisions[0].automationNotes).toContain(
      "A user-owned ledger decision prevents autonomous preparation for this job."
    );
    expect(getExecutableDecisions(plan).review).toHaveLength(0);
  });

  it("keeps progressed application history out of later autonomous preparation", () => {
    const submittedApplication: Application = {
      id: 23,
      userId: 1,
      jobId: baseJob.id,
      status: "applied",
      appliedDate: new Date(),
      lastActivity: new Date(),
      coverLetter: null,
      customResume: null,
      notes: "Employer submission confirmed.",
      isAutoApplied: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = buildAutonomousPlan([baseJob], profile, [submittedApplication], {
      minMatchScore: 70,
      dailyApplicationLimit: 2,
    });

    expect(plan.decisions[0].action).toBe("skip");
    expect(plan.decisions[0].blockers).toContain("Already applied to this job");
  });

  it("counts autonomous manual tasks toward the daily preparation limit", () => {
    const manualTask: Application = {
      id: 21,
      userId: 1,
      jobId: 98,
      status: "pending",
      appliedDate: null,
      lastActivity: null,
      coverLetter: null,
      customResume: null,
      notes: "Manual apply queue.",
      isAutoApplied: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = buildAutonomousPlan([baseJob], profile, [manualTask], {
      dailyApplicationLimit: 1,
      minMatchScore: 0,
    });

    expect(plan.summary.dailyRemaining).toBe(0);
    expect(plan.decisions[0].action).toBe("skip");
  });

  it("assigns limited preparation slots to the highest-scoring jobs", () => {
    const lowerScoreJob: Job = {
      ...baseJob,
      id: 2,
      externalId: "job-2",
      title: "General Developer",
      skills: "PHP",
    };
    const plan = buildAutonomousPlan([lowerScoreJob, baseJob], profile, [], {
      dailyApplicationLimit: 1,
      minMatchScore: 0,
    });

    expect(plan.decisions[0].jobId).toBe(baseJob.id);
    expect(plan.decisions[0].action).toBe("queue_for_review");
    expect(plan.decisions[1].action).toBe("skip");
  });

  it("excludes expired listings from every autonomous preparation decision", () => {
    const expiredJob: Job = {
      ...baseJob,
      id: 2,
      externalId: "expired-job",
      expiryDate: new Date(Date.now() - 60_000),
    };

    expect(isJobCurrentForAutonomousProcessing(expiredJob)).toBe(false);

    const plan = buildAutonomousPlan([expiredJob, baseJob], profile, [], {
      minMatchScore: 0,
      dailyApplicationLimit: 2,
    });

    expect(plan.summary.scanned).toBe(1);
    expect(plan.summary.expiredJobsSkipped).toBe(1);
    expect(plan.decisions.map((decision) => decision.jobId)).toEqual([baseJob.id]);
    expect(plan.nextActions).toContain("Excluded 1 expired or stale job posting from autonomous preparation.");
  });

  it("excludes an active no-expiry listing after its source observation window", () => {
    const staleJob: Job = {
      ...baseJob,
      id: 3,
      externalId: "stale-observation-job",
      expiryDate: null,
      updatedAt: new Date(Date.now() - 15 * 86400000),
    };

    expect(isJobCurrentForAutonomousProcessing(staleJob)).toBe(false);

    const plan = buildAutonomousPlan([staleJob, baseJob], profile, [], {
      minMatchScore: 0,
      dailyApplicationLimit: 2,
    });

    expect(plan.summary.scanned).toBe(1);
    expect(plan.summary.expiredJobsSkipped).toBe(1);
    expect(plan.decisions.map((decision) => decision.jobId)).toEqual([baseJob.id]);
  });

  it("marks high-fit roles as blocked instead of prepared when no resume is connected", () => {
    const plan = buildAutonomousPlan([baseJob], { ...profile, resumeUrl: null }, [], {
      mode: "auto_apply",
      requireHumanReview: false,
      minMatchScore: 70,
    });

    expect(plan.summary.queuedForApply).toBe(0);
    expect(plan.summary.queuedForReview).toBe(0);
    expect(plan.summary.blocked).toBe(1);
    expect(plan.summary.eligible).toBe(0);
    expect(plan.decisions[0].action).toBe("blocked");
    expect(plan.decisions[0].reviewRequired).toBe(true);
    expect(getExecutableDecisions(plan).review).toHaveLength(0);
    expect(plan.nextActions).toContain("Upload and select an active versioned resume before autonomous application preparation can run.");
  });

  it("uses the active resume ledger instead of profile metadata when planning preparation", () => {
    const plan = buildAutonomousPlan([baseJob], profile, [], {
      minMatchScore: 70,
    }, false);

    expect(plan.summary.blocked).toBe(1);
    expect(plan.summary.queuedForReview).toBe(0);
    expect(plan.decisions[0].action).toBe("blocked");
  });

  it("plans follow-ups for stale applied applications", () => {
    const oldDate = new Date(Date.now() - 7 * 86400000);
    const application: Application = {
      id: 30,
      userId: 1,
      jobId: 1,
      status: "applied",
      appliedDate: oldDate,
      lastActivity: oldDate,
      coverLetter: null,
      customResume: null,
      notes: null,
      isAutoApplied: 0,
      createdAt: oldDate,
      updatedAt: oldDate,
    };

    const disabledPlan = buildAutonomousPlan([], profile, [application], {});
    const plan = buildAutonomousPlan([], profile, [application], { createFollowUps: true });

    expect(disabledPlan.summary.followUpsDue).toBe(0);
    expect(getExecutableDecisions(disabledPlan).followUps).toHaveLength(0);
    expect(plan.summary.followUpsDue).toBe(1);
    expect(plan.followUps[0].action).toBe("send_follow_up");
    expect(getExecutableDecisions(plan).followUps).toHaveLength(1);
  });

  it("uses status checks instead of repeated thank-you drafts for stale interviews", () => {
    const oldDate = new Date(Date.now() - 7 * 86400000);
    const application: Application = {
      id: 31,
      userId: 1,
      jobId: 1,
      status: "interview",
      appliedDate: oldDate,
      lastActivity: oldDate,
      coverLetter: null,
      customResume: null,
      notes: null,
      isAutoApplied: 0,
      createdAt: oldDate,
      updatedAt: oldDate,
    };

    const plan = buildAutonomousPlan([], profile, [application], { createFollowUps: true });

    expect(plan.followUps[0].action).toBe("send_follow_up");
    expect(plan.followUps[0].messageType).toBe("status_check");
  });
});
