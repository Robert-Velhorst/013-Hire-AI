import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, UserProfile } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({
  invokeLLM: vi.fn(),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: mocks.invokeLLM,
}));

import { calculateJobMatch } from "./aiMatching";

const profile = {
  skills: "TypeScript, React, Node.js",
  experience: "Five years building production web applications.",
  desiredJobTypes: "full-time",
  desiredLocations: "remote, worldwide",
  salaryExpectationMin: 100000,
  salaryExpectationMax: 150000,
  salaryExpectationCurrency: "USD",
} as UserProfile;

const job = {
  id: 42,
  title: "Senior React Engineer",
  company: "Example Co",
  requirements: "React, TypeScript, Node.js",
  location: "Remote - Worldwide",
  jobType: "full-time",
  salaryMin: 120000,
  salaryMax: 145000,
  salaryCurrency: "USD",
  skills: "React, TypeScript, Node.js",
  applicationUrl: "https://boards.example.com/jobs/42",
  applicationEmail: null,
  visaSponsorshipAvailable: 1,
  isActive: 1,
} as Job;

describe("job matching resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses structured profile and job evidence when the LLM is unavailable", async () => {
    mocks.invokeLLM.mockRejectedValueOnce(new Error("LLM unavailable"));

    const result = await calculateJobMatch(profile, job);

    expect(result).toMatchObject({
      jobId: job.id,
      analysisSource: "deterministic_fallback",
      skillsMatch: 100,
      locationMatch: 100,
      salaryMatch: 100,
    });
    expect(result.matchScore).toBeGreaterThan(70);
    expect(result.matchReasons).toContain("Deterministic profile-based analysis");
    expect(result.matchReasons).toContain("Experience is recorded");
  });

  it("rejects invalid LLM scores instead of persisting out-of-range analysis", async () => {
    mocks.invokeLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            matchScore: 120,
            skillsMatch: 100,
            experienceMatch: 80,
            locationMatch: 100,
            salaryMatch: 100,
            matchReasons: "This should be rejected because the score is invalid.",
          }),
        },
      }],
    });

    const result = await calculateJobMatch(profile, job);

    expect(result.analysisSource).toBe("deterministic_fallback");
    expect(result.matchScore).toBeLessThanOrEqual(100);
    expect(result.matchReasons).toContain("Deterministic profile-based analysis");
  });

  it("keeps salary scoring neutral when source compensation uses another currency", async () => {
    mocks.invokeLLM.mockRejectedValueOnce(new Error("LLM unavailable"));

    const result = await calculateJobMatch({
      ...profile,
      salaryExpectationCurrency: "USD",
    }, {
      ...job,
      salaryCurrency: "EUR",
    });

    expect(result.analysisSource).toBe("deterministic_fallback");
    expect(result.salaryMatch).toBe(50);
  });

  it("overrides an LLM salary verdict when it compares different currencies", async () => {
    mocks.invokeLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            matchScore: 90,
            skillsMatch: 100,
            experienceMatch: 80,
            locationMatch: 100,
            salaryMatch: 100,
            matchReasons: "Strong technical match.",
          }),
        },
      }],
    });

    const result = await calculateJobMatch({
      ...profile,
      salaryExpectationCurrency: "USD",
    }, {
      ...job,
      salaryCurrency: "EUR",
    });

    expect(result.analysisSource).toBe("llm");
    expect(result.salaryMatch).toBe(50);
    expect(result.matchReasons).toContain("requires review");
  });

  it("keeps valid LLM analysis and identifies its source", async () => {
    mocks.invokeLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            matchScore: 88,
            skillsMatch: 92,
            experienceMatch: 78,
            locationMatch: 100,
            salaryMatch: 85,
            matchReasons: "Strong overlap with the recorded profile skills.",
          }),
        },
      }],
    });

    const result = await calculateJobMatch(profile, job);

    expect(result).toMatchObject({
      analysisSource: "llm",
      matchScore: 88,
      skillsMatch: 92,
      matchReasons: "Strong overlap with the recorded profile skills.",
    });
  });
});
