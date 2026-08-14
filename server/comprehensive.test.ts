import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createMockContext(userId: number = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-user-${userId}`,
      email: `test${userId}@example.com`,
      name: `Test User ${userId}`,
      loginMethod: "test",
      role: "user",
      accountStatus: "active",
      stripeCustomerId: null,
      tosAcceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

describe("Job Platforms", () => {
  it("lists all and active platforms", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    await expect(caller.platforms.list()).resolves.toEqual(expect.any(Array));
    await expect(caller.platforms.active()).resolves.toEqual(expect.any(Array));
  });
});

describe("Scraping Infrastructure", () => {
  it("exposes the current scraping controls", () => {
    const caller = appRouter.createCaller(createMockContext());

    expect(caller.scraping).toBeDefined();
    expect(caller.scraping.status).toBeDefined();
    expect(caller.scraping.runScrape).toBeDefined();
    expect(caller.scraping.startScheduler).toBeDefined();
    expect(caller.scraping.stopScheduler).toBeDefined();
    expect(caller.scraping.runNow).toBeDefined();
  });
});

describe("Job Normalization", () => {
  it("exposes normalization helpers", () => {
    const caller = appRouter.createCaller(createPublicContext());

    expect(caller.normalization.normalizeSalary).toBeDefined();
    expect(caller.normalization.normalizeLocation).toBeDefined();
    expect(caller.normalization.normalizeJobType).toBeDefined();
    expect(caller.normalization.normalizeExperienceLevel).toBeDefined();
    expect(caller.normalization.extractSkills).toBeDefined();
    expect(caller.normalization.extractBenefits).toBeDefined();
  });
});

describe("Job Discovery", () => {
  it("uses the canonical jobs API without exposing a duplicate discovery namespace", () => {
    const caller = appRouter.createCaller(createMockContext());

    expect(caller.jobs.list).toBeDefined();
    expect(caller.jobs.listPage).toBeDefined();
    expect(caller.jobs.search).toBeDefined();
    expect(caller).not.toHaveProperty("discovery");
  });

  it("passes job-type filters through the canonical public jobs contract", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const result = await caller.jobs.list({
      limit: 50,
      offset: 0,
      filters: { jobType: "contract", remoteOnly: false, listingSafety: "all" },
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((job) => job.jobType === "contract")).toBe(true);
  });
});

describe("Resume Management", () => {
  it("exposes resume methods", () => {
    const caller = appRouter.createCaller(createMockContext());

    expect(caller.resume.upload).toBeDefined();
    expect(caller.resume.parse).toBeDefined();
    expect(caller.resume.parseFile).toBeDefined();
    expect(caller.resume.uploadWithHistory).toBeDefined();
    expect(caller.resume.getActive).toBeDefined();
    expect(caller.resume.getVersionPage).toBeDefined();
  });
});

describe("Job Alerts", () => {
  it("lists user alerts", async () => {
    const caller = appRouter.createCaller(createMockContext());

    await expect(caller.alerts.listPage({ limit: 10 })).resolves.toMatchObject({
      items: expect.any(Array),
    });
  });
});

describe("Interview Preparation", () => {
  it("exposes interview-prep methods", () => {
    const caller = appRouter.createCaller(createMockContext());

    expect(caller.interviewPrep.generateQuestions).toBeDefined();
    expect(caller.interviewPrep.mockInterview).toBeDefined();
    expect(caller.interviewPrep.videoTips).toBeDefined();
  });
});

describe("Diversity & Inclusion Support", () => {
  it("gets D&I platforms by category", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const platforms = await caller.diversity.getDIPlatforms({
      categories: ["women_in_tech", "veterans"],
    });

    expect(platforms).toEqual(expect.any(Array));
  });
});

describe("Application Automation", () => {
  it("detects supported ATS types", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const greenhouse = await caller.automation.detectATS({
      url: "https://boards.greenhouse.io/company/jobs/12345",
    });
    const workday = await caller.automation.detectATS({
      url: "https://company.myworkday.com/careers/job/12345",
    });
    const lever = await caller.automation.detectATS({
      url: "https://jobs.lever.co/company/12345",
    });

    expect(greenhouse.atsType).toBe("greenhouse");
    expect(workday.atsType).toBe("workday");
    expect(lever.atsType).toBe("lever");
  });

  it("exposes applyToJob", () => {
    const caller = appRouter.createCaller(createMockContext());
    expect(caller.automation.applyToJob).toBeDefined();
  });
});

describe("Application Features", () => {
  it("lists user applications and exposes application tools", async () => {
    const caller = appRouter.createCaller(createMockContext());

    await expect(caller.applications.list()).resolves.toEqual(expect.any(Array));
    expect(caller.applications.addNote).toBeDefined();
    expect(caller.applications.scheduleInterview).toBeDefined();
    expect(caller.applications.createFollowUp).toBeDefined();
    await expect(caller.applications.getUpcomingInterviews()).resolves.toEqual(expect.any(Array));
  });
});

describe("Jobs Router", () => {
  it("lists, searches, and exposes saved jobs", async () => {
    const publicCaller = appRouter.createCaller(createPublicContext());
    const authedCaller = appRouter.createCaller(createMockContext());

    await expect(publicCaller.jobs.list({ limit: 10, offset: 0 })).resolves.toEqual(expect.any(Array));
    await expect(publicCaller.jobs.listPage({ limit: 10 })).resolves.toMatchObject({
      items: expect.any(Array),
    });
    await expect(publicCaller.jobs.search({ title: "engineer", limit: 10, offset: 0 })).resolves.toEqual(expect.any(Array));
    await expect(authedCaller.jobs.getSavedJobPage({ limit: 10 })).resolves.toMatchObject({
      items: expect.any(Array),
    });
  });
});

describe("Profile Router", () => {
  it("gets user profile and exposes structured profile sections", async () => {
    const caller = appRouter.createCaller(createMockContext());

    const profile = await caller.profile.get();
    expect(profile === undefined || profile === null || typeof profile === "object").toBe(true);
    expect(caller.profile.getWorkExperiences).toBeDefined();
    expect(caller.profile.getEducation).toBeDefined();
    expect(caller.profile.getSkills).toBeDefined();
    expect(caller.profile.getProjects).toBeDefined();
  });
});

describe("Matching Router", () => {
  it("gets user matches", async () => {
    const caller = appRouter.createCaller(createMockContext());

    await expect(caller.matching.getMatchesForJobs({ jobIds: [1] })).resolves.toEqual(expect.any(Array));
    await expect(caller.matching.getMatchesForJobs({
      jobIds: Array.from({ length: 251 }, (_, index) => index + 1),
    })).rejects.toBeDefined();
    expect(caller.matching.calculateMatch).toBeDefined();
  });
});

describe("AI Router", () => {
  it("exposes AI helpers", () => {
    const caller = appRouter.createCaller(createMockContext());

    expect(caller.ai.generateCoverLetter).toBeDefined();
    expect(caller.ai.identifyDecisionMakers).toBeDefined();
    expect(caller.ai.generateInterviewPrep).toBeDefined();
  });
});

describe("Social Connections", () => {
  it("exposes current social profile helpers", () => {
    const caller = appRouter.createCaller(createMockContext());

    expect(caller.social.validateUrl).toBeDefined();
    expect(caller.social.connect).toBeDefined();
    expect(caller.social.analyzeLinkedIn).toBeDefined();
    expect(caller.social.analyzeGitHub).toBeDefined();
    expect(caller.social.analyzePortfolio).toBeDefined();
  });
});

describe("Authentication", () => {
  it("returns user info for authenticated context", async () => {
    const caller = appRouter.createCaller(createMockContext());

    const user = await caller.auth.me();

    expect(user).toBeDefined();
    expect(user?.id).toBe(1);
    expect(user?.email).toBe("test1@example.com");
  });

  it("returns null for unauthenticated context", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    await expect(caller.auth.me()).resolves.toBeNull();
  });

  it("handles logout", async () => {
    const caller = appRouter.createCaller(createMockContext());

    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
  });
});
