import { describe, expect, it } from "vitest";
import { getJobMatchDecisionSummary } from "./jobMatchDecisionSummary";

describe("job match decision summary", () => {
  it("surfaces matched skills and a review recommendation for strong remote matches", () => {
    const summary = getJobMatchDecisionSummary(
      {
        skills: "React, TypeScript, Node.js",
        location: "Remote - Worldwide",
        salaryMin: 120000,
        salaryMax: 150000,
        salaryCurrency: "USD",
        applicationUrl: "https://example.com/apply",
        matchScore: 88,
      },
      {
        skills: "React, TypeScript, SQL",
        desiredLocations: "Remote",
        salaryExpectationMin: 100000,
        salaryExpectationCurrency: "USD",
        resumeFileKey: "resume.pdf",
      }
    );

    expect(summary.matchedSkills).toEqual(["React", "TypeScript"]);
    expect(summary.missingSkills).toEqual(["Node.js"]);
    expect(summary.locationFit).toBe("fit");
    expect(summary.salaryFit).toBe("fit");
    expect(summary.recommendedDecision).toBe("review");
    expect(summary.riskLevel).toBe("low");
  });

  it("blocks unsafe submission when profile evidence is missing", () => {
    const summary = getJobMatchDecisionSummary(
      {
        skills: "React",
        location: "Remote",
        applicationUrl: "https://example.com/apply",
        matchScore: 92,
      },
      {
        skills: "",
      }
    );

    expect(summary.blockers).toContain("Profile skills are incomplete");
    expect(summary.blockers).toContain("Resume is required before submission");
    expect(summary.riskLevel).toBe("high");
    expect(summary.nextAction).toContain("Review blockers");
  });

  it("requires review when a disclosed salary has no supported currency", () => {
    const summary = getJobMatchDecisionSummary(
      {
        location: "Remote - Worldwide",
        salaryMin: 90000,
        salaryMax: 110000,
      },
      { salaryExpectationMin: 80000, salaryExpectationCurrency: "USD" }
    );

    expect(summary.salaryFit).toBe("unknown");
    expect(summary.blockers.join(" ")).toContain("unknown currency");
  });

  it("uses autonomous decisions when available", () => {
    const summary = getJobMatchDecisionSummary(
      {
        skills: "Customer support",
        location: "Remote",
        applicationUrl: "https://example.com/apply",
      },
      {
        skills: "Customer support",
        resumeUrl: "https://example.com/resume.pdf",
      },
      {
        matchScore: 83,
        confidence: "high",
        action: "manual_apply",
        blockers: ["Unsupported ATS requires manual application"],
        reasons: ["Remote-compatible role"],
        reviewRequired: true,
      }
    );

    expect(summary.matchScore).toBe(83);
    expect(summary.confidence).toBe("high");
    expect(summary.recommendedDecision).toBe("manual_apply");
    expect(summary.reviewRequired).toBe(true);
    expect(summary.blockers).toContain("Unsupported ATS requires manual application");
  });

  it("ignores jobs without an application destination", () => {
    const summary = getJobMatchDecisionSummary(
      {
        skills: "React",
        location: "Remote",
        matchScore: 88,
      },
      {
        skills: "React",
        resumeUrl: "https://example.com/resume.pdf",
      }
    );

    expect(summary.recommendedDecision).toBe("ignore");
    expect(summary.blockers).toContain("No application destination found");
  });

  it("does not call jurisdiction-restricted remote jobs a location fit", () => {
    const summary = getJobMatchDecisionSummary(
      {
        title: "Software Engineer",
        company: "Example Co",
        location: "Remote - US Only",
        skills: "React",
        applicationUrl: "https://boards.example.com/jobs/1",
      },
      {
        skills: "React",
        desiredLocations: "Europe",
        resumeUrl: "https://example.com/resume.pdf",
      }
    );

    expect(summary.locationFit).toBe("gap");
    expect(summary.blockers).toContain("Location does not match stated preferences");
  });

  it("requires salary review instead of comparing different currencies as equivalent", () => {
    const summary = getJobMatchDecisionSummary(
      {
        skills: "React",
        location: "Remote",
        salaryMin: 70000,
        salaryMax: 90000,
        salaryCurrency: "EUR",
        applicationUrl: "https://example.com/apply",
      },
      {
        skills: "React",
        salaryExpectationMin: 100000,
        salaryExpectationCurrency: "USD",
        resumeFileKey: "resume.pdf",
      }
    );

    expect(summary.salaryFit).toBe("unknown");
    expect(summary.blockers.join(" ")).toContain("EUR");
    expect(summary.blockers.join(" ")).toContain("USD");
    expect(summary.recommendedDecision).toBe("review");
  });

  it("uses persisted operating-ledger decisions after refresh", () => {
    const summary = getJobMatchDecisionSummary(
      {
        skills: "React, TypeScript",
        location: "Remote",
        applicationUrl: "https://example.com/apply",
        matchScore: 88,
      },
      {
        skills: "React, TypeScript",
        resumeUrl: "https://example.com/resume.pdf",
      },
      null,
      {
        decision: "save",
        decisionReason: "Saved for later review from Job Search.",
        matchScore: 76,
        riskLevel: "medium",
        reviewRequired: 1,
        reviewReason: "Saved to compare with stronger roles.",
        updatedAt: "2026-06-30T08:00:00.000Z",
      }
    );

    expect(summary.matchScore).toBe(76);
    expect(summary.recommendedDecision).toBe("save");
    expect(summary.decisionLabel).toBe("Save for later");
    expect(summary.isDecided).toBe(true);
    expect(summary.ledgerDecision).toBe("save");
    expect(summary.ledgerDecisionLabel).toBe("Save for later");
    expect(summary.ledgerDecisionReason).toContain("Saved for later");
    expect(summary.ledgerUpdatedAt?.toISOString()).toBe("2026-06-30T08:00:00.000Z");
    expect(summary.nextAction).toContain("Already saved");
  });

  it("lets persisted ignore decisions override high inferred matches", () => {
    const summary = getJobMatchDecisionSummary(
      {
        skills: "React, TypeScript",
        location: "Remote",
        applicationUrl: "https://example.com/apply",
        matchScore: 94,
      },
      {
        skills: "React, TypeScript",
        resumeFileKey: "resume.pdf",
      },
      null,
      {
        decision: "ignore",
        decisionReason: "User rejected this company.",
        matchScore: 94,
        riskLevel: "low",
        reviewRequired: 0,
      }
    );

    expect(summary.recommendedDecision).toBe("ignore");
    expect(summary.reviewRequired).toBe(false);
    expect(summary.isDecided).toBe(true);
    expect(summary.nextAction).toContain("Already ignored");
  });
});
