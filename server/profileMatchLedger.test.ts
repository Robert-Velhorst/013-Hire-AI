import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuditEvent: vi.fn(),
  createCanonicalJobMatches: vi.fn(),
  createJobMatch: vi.fn(),
  getActiveJobs: vi.fn(),
  getUserProfile: vi.fn(),
  getUserSkills: vi.fn(),
  getWorkExperiences: vi.fn(),
}));

vi.mock("./db", () => mocks);

import { refreshProfileMatchLedger } from "./profileMatchLedger";

describe("profile match ledger reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserProfile.mockResolvedValue({
      id: 1,
      userId: 44,
      skills: null,
      experience: null,
      education: null,
      preferences: null,
      desiredJobTypes: "Platform Engineer",
      desiredLocations: "Remote",
      salaryExpectationMin: null,
      salaryExpectationMax: null,
      resumeUrl: null,
      resumeFileKey: null,
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
      diversityGroup: null,
      needsVisaSponsorship: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.getUserSkills.mockResolvedValue([{ skillName: "TypeScript" }]);
    mocks.getWorkExperiences.mockResolvedValue([
      { jobTitle: "Platform Engineer", company: "Example Co", skills: "TypeScript, Kubernetes" },
    ]);
    mocks.getActiveJobs.mockResolvedValue([
      {
        id: 11,
        title: "Platform Engineer",
        company: "Example Co",
        location: "Remote - Worldwide",
        jobType: "full-time",
        skills: "TypeScript, Kubernetes",
        requirements: "Build TypeScript services.",
        applicationUrl: "https://boards.example.com/jobs/11",
        applicationEmail: null,
        applicationProcess: "greenhouse",
        platformId: 1,
        salaryMin: null,
        salaryMax: null,
        visaSponsorshipAvailable: 1,
      },
      {
        id: 12,
        title: "Platform Engineer",
        company: "Another Co",
        location: "Remote - Worldwide",
        jobType: "full-time",
        skills: "TypeScript",
        requirements: null,
        applicationUrl: "https://boards.example.com/jobs/12",
        applicationEmail: null,
        applicationProcess: "greenhouse",
        platformId: 1,
        salaryMin: null,
        salaryMax: null,
        visaSponsorshipAvailable: 1,
      },
    ]);
    mocks.createJobMatch.mockResolvedValue({ insertId: 1 });
    mocks.createCanonicalJobMatches.mockResolvedValue(undefined);
    mocks.createAuditEvent.mockResolvedValue(undefined);
  });

  it("refreshes every active match from resolved candidate evidence without external side effects", async () => {
    const result = await refreshProfileMatchLedger({ userId: 44, source: "profile.update" });

    expect(result).toEqual({
      profileAvailable: true,
      consideredJobs: 2,
      refreshedMatches: 2,
      failedMatches: 0,
    });
    expect(mocks.createCanonicalJobMatches).toHaveBeenCalledOnce();
    expect(mocks.createCanonicalJobMatches).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        userId: 44,
        jobId: 11,
        skillsMatch: 100,
        experienceMatch: 50,
        matchReasons: expect.stringContaining("Current candidate evidence was reconciled"),
      }),
    ]));
    expect(mocks.createJobMatch).not.toHaveBeenCalled();
    expect(mocks.getWorkExperiences).toHaveBeenCalledWith(44);
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "profile_match_ledger_refreshed",
      source: "profile.update",
      riskLevel: "low",
      afterState: expect.stringContaining('"externalSubmissionPerformed":false'),
    }));
  });

  it("records a partial reconciliation instead of failing a candidate profile update", async () => {
    mocks.createCanonicalJobMatches.mockRejectedValueOnce(new Error("database unavailable"));
    mocks.createJobMatch.mockRejectedValueOnce(new Error("job write unavailable"));

    const result = await refreshProfileMatchLedger({ userId: 44, source: "profile.addSkill" });

    expect(result).toMatchObject({ refreshedMatches: 1, failedMatches: 1 });
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "profile_match_ledger_reconciliation_partial",
      riskLevel: "medium",
    }));
    expect(mocks.createJobMatch).toHaveBeenCalledTimes(2);
  });

  it("writes a larger reconciliation in bounded ten-match batches", async () => {
    mocks.getActiveJobs.mockResolvedValue(Array.from({ length: 25 }, (_, index) => ({
      id: 100 + index,
      title: "Platform Engineer",
      company: `Example ${index}`,
      location: "Remote - Worldwide",
      jobType: "full-time",
      skills: "TypeScript, Kubernetes",
      requirements: "Build TypeScript services.",
      applicationUrl: `https://boards.example.com/jobs/${100 + index}`,
      applicationEmail: null,
      applicationProcess: "greenhouse",
      platformId: 1,
      salaryMin: null,
      salaryMax: null,
      visaSponsorshipAvailable: 1,
    })));

    await expect(refreshProfileMatchLedger({ userId: 44, source: "profile.update" }))
      .resolves.toMatchObject({ consideredJobs: 25, refreshedMatches: 25, failedMatches: 0 });

    expect(mocks.createCanonicalJobMatches).toHaveBeenCalledTimes(3);
    expect(mocks.createCanonicalJobMatches.mock.calls.map(([matches]) => matches.length))
      .toEqual([10, 10, 5]);
    expect(mocks.createJobMatch).not.toHaveBeenCalled();
  });

  it("does not write matches or an audit record when no candidate profile exists", async () => {
    mocks.getUserProfile.mockResolvedValueOnce(undefined);

    await expect(refreshProfileMatchLedger({ userId: 45, source: "profile.update" })).resolves.toMatchObject({
      profileAvailable: false,
      refreshedMatches: 0,
    });
    expect(mocks.createJobMatch).not.toHaveBeenCalled();
    expect(mocks.createCanonicalJobMatches).not.toHaveBeenCalled();
    expect(mocks.createAuditEvent).not.toHaveBeenCalled();
  });
});
