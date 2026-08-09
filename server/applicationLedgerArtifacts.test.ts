import { describe, expect, it } from "vitest";
import {
  createApplication,
  createApplicationAttempt,
  createApplicationMaterial,
  createEmployerResponse,
  getApplicationLedgerArtifactWindow,
  getApplicationLedgerArtifacts,
  getEmployerResponses,
} from "./db";

describe("application ledger artifacts", () => {
  it("stores prepared materials and attempt history for an application", async () => {
    const userId = 95001;
    const jobId = 1;
    const application = await createApplication({
      userId,
      jobId,
      status: "pending",
      coverLetter: "Prepared cover letter",
      notes: "Prepared for review.",
    });
    const applicationId = Number(application.insertId);

    await createApplicationMaterial({
      applicationId,
      coverLetter: "Prepared cover letter",
      customResume: "Tailored resume summary",
      customAnswers: JSON.stringify({ availability: "Immediate" }),
      claimsMade: "React, TypeScript, remote collaboration",
      sourceProfileSnapshot: JSON.stringify({ profile: { skills: "React, TypeScript" } }),
    });
    await createApplicationAttempt({
      applicationId,
      userId,
      jobId,
      platformId: 1,
      attemptType: "prepare",
      status: "review_required",
      confirmationText: "Application prepared; user review required before submission.",
      finishedAt: new Date(),
      retryCount: 0,
    });

    const ledger = await getApplicationLedgerArtifacts(applicationId, userId);

    expect(ledger.material?.coverLetter).toBe("Prepared cover letter");
    expect(ledger.material?.customResume).toBe("Tailored resume summary");
    expect(ledger.attempts).toHaveLength(1);
    expect(ledger.attempts[0].status).toBe("review_required");
    expect(ledger.attempts[0].confirmationText).toContain("user review required");
  });

  it("bounds the interactive attempt window without truncating internal ledger reads", async () => {
    const userId = 95004;
    const jobId = 1;
    const application = await createApplication({
      userId,
      jobId,
      status: "pending",
      notes: "Window behavior.",
    });
    const applicationId = Number(application.insertId);

    for (let index = 0; index < 7; index += 1) {
      await createApplicationAttempt({
        applicationId,
        userId,
        jobId,
        attemptType: "prepare",
        status: "prepared",
        confirmationText: `Attempt ${index}`,
        createdAt: new Date(Date.UTC(2026, 7, 9, 10, index)),
      });
    }

    const [complete, interactive] = await Promise.all([
      getApplicationLedgerArtifacts(applicationId, userId),
      getApplicationLedgerArtifactWindow(applicationId, userId),
    ]);

    expect(complete.attempts).toHaveLength(7);
    expect(complete.hasMore.attempts).toBe(false);
    expect(interactive.attempts).toHaveLength(5);
    expect(interactive.hasMore.attempts).toBe(true);
    expect(interactive.attempts.map((attempt) => attempt.confirmationText)).toEqual([
      "Attempt 6",
      "Attempt 5",
      "Attempt 4",
      "Attempt 3",
      "Attempt 2",
    ]);
  });

  it("adds employer responses to the application ledger without leaking other users", async () => {
    const userId = 95002;
    const otherUserId = 95003;
    const jobId = 1;
    const receivedAt = new Date("2026-06-29T09:00:00.000Z");
    const newerReceivedAt = new Date("2026-06-29T10:00:00.000Z");
    const application = await createApplication({
      userId,
      jobId,
      status: "applied",
      notes: "Submitted with evidence.",
    });
    const applicationId = Number(application.insertId);
    const otherApplication = await createApplication({
      userId: otherUserId,
      jobId,
      status: "applied",
      notes: "Other user's application.",
    });

    await createEmployerResponse({
      applicationId,
      userId,
      responseType: "viewed",
      source: "email",
      summary: "Employer opened the submitted application.",
      receivedAt,
      statusBefore: "applied",
      statusAfter: "viewed",
    });
    await createEmployerResponse({
      applicationId,
      userId,
      responseType: "interview_invite",
      source: "employer_portal",
      summary: "Recruiter requested interview availability.",
      receivedAt: newerReceivedAt,
      statusBefore: "viewed",
      statusAfter: "interview",
    });
    await createEmployerResponse({
      applicationId: Number(otherApplication.insertId),
      userId: otherUserId,
      responseType: "offer",
      source: "email",
      summary: "Other user's offer must not leak.",
      receivedAt: newerReceivedAt,
      statusBefore: "interview",
      statusAfter: "offer",
    });

    const ledger = await getApplicationLedgerArtifacts(applicationId, userId);
    const directResponses = await getEmployerResponses(applicationId, userId);

    expect(ledger.employerResponses).toHaveLength(2);
    expect(ledger.employerResponses[0].responseType).toBe("interview_invite");
    expect(ledger.employerResponses[0].summary).toContain("interview availability");
    expect(ledger.employerResponses.some((response) => response.summary.includes("must not leak"))).toBe(false);
    expect(directResponses.map((response) => response.responseType)).toEqual(["interview_invite", "viewed"]);
  });
});
