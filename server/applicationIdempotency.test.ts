import { describe, expect, it } from "vitest";
import {
  createApplication,
  createAutonomousPreparationApplication,
  getUserApplications,
  updateApplicationStatus,
} from "./db";

describe("application idempotency", () => {
  it("creates only one application per user and job", async () => {
    const userId = 92001;
    const jobId = 1;

    const first = await createApplication({ userId, jobId, status: "pending" });
    const second = await createApplication({ userId, jobId, status: "pending" });
    const applications = await getUserApplications(userId);

    expect(first.existing).not.toBe(true);
    expect(second.existing).toBe(true);
    expect(applications).toHaveLength(1);
  });

  it("promotes an existing prepared record when submission is confirmed", async () => {
    const userId = 92002;
    const jobId = 2;

    await createApplication({ userId, jobId, status: "pending" });
    const result = await createApplication({
      userId,
      jobId,
      status: "applied",
      notes: "Submission confirmed",
    });
    const applications = await getUserApplications(userId);

    expect(result.existing).toBe(true);
    expect(applications[0].status).toBe("applied");
    expect(applications[0].appliedDate).toBeInstanceOf(Date);
  });

  it("refreshes materials for an existing pending application", async () => {
    const userId = 92003;
    const jobId = 3;

    await createApplication({
      userId,
      jobId,
      status: "pending",
      coverLetter: "Initial cover letter",
      customResume: "initial-resume.pdf",
      notes: "Initial notes",
    });
    const result = await createApplication({
      userId,
      jobId,
      status: "pending",
      coverLetter: "Updated cover letter",
      customResume: "updated-resume.pdf",
      notes: "Updated notes",
    });
    const applications = await getUserApplications(userId);

    expect(result.existing).toBe(true);
    expect(applications).toHaveLength(1);
    expect(applications[0].status).toBe("pending");
    expect(applications[0].coverLetter).toBe("Updated cover letter");
    expect(applications[0].customResume).toBe("updated-resume.pdf");
    expect(applications[0].notes).toBe("Updated notes");
  });

  it("preserves candidate edits when an autonomous preparation is retried", async () => {
    const userId = 92007;
    const jobId = 7;

    const created = await createAutonomousPreparationApplication({
      userId,
      jobId,
      status: "pending",
      coverLetter: "Generated draft",
      notes: "Autonomous preparation",
    });
    await createApplication({
      userId,
      jobId,
      status: "pending",
      coverLetter: "Candidate-edited cover letter",
      notes: "Candidate review notes",
    });

    const retried = await createAutonomousPreparationApplication({
      userId,
      jobId,
      status: "pending",
      coverLetter: "Regenerated draft",
      notes: "Autonomous preparation retry",
    });
    const applications = await getUserApplications(userId);

    expect(created.existing).toBe(false);
    expect(retried).toEqual({ insertId: created.insertId, existing: true });
    expect(applications).toHaveLength(1);
    expect(applications[0].coverLetter).toBe("Candidate-edited cover letter");
    expect(applications[0].notes).toBe("Candidate review notes");
  });

  it("does not downgrade a progressed application through a duplicate submission write", async () => {
    const userId = 92004;
    const jobId = 4;

    const created = await createApplication({ userId, jobId, status: "pending" });
    await updateApplicationStatus(Number(created.insertId), "applied", userId);
    await updateApplicationStatus(Number(created.insertId), "interview", userId);
    await createApplication({
      userId,
      jobId,
      status: "applied",
      notes: "Stale submission callback",
    });
    const applications = await getUserApplications(userId);

    expect(applications[0].status).toBe("interview");
    expect(applications[0].notes).not.toBe("Stale submission callback");
  });

  it("reopens a withdrawn preparation that was never submitted", async () => {
    const userId = 92005;
    const jobId = 5;

    const created = await createApplication({ userId, jobId, status: "pending", notes: "Prepared for review" });
    await updateApplicationStatus(Number(created.insertId), "withdrawn", userId);
    const reopened = await createApplication({ userId, jobId, status: "pending", notes: "Queued again" });
    const applications = await getUserApplications(userId);

    expect(reopened.existing).toBe(true);
    expect(applications).toHaveLength(1);
    expect(applications[0].status).toBe("pending");
    expect(applications[0].notes).toBe("Queued again");
  });

  it("does not reopen a withdrawn application that already had submission evidence", async () => {
    const userId = 92006;
    const jobId = 6;

    const created = await createApplication({ userId, jobId, status: "pending" });
    await updateApplicationStatus(Number(created.insertId), "applied", userId);
    await updateApplicationStatus(Number(created.insertId), "withdrawn", userId);
    const staleRequeue = await createApplication({ userId, jobId, status: "pending", notes: "Unsafe requeue" });
    const applications = await getUserApplications(userId);

    expect(staleRequeue.existing).toBe(true);
    expect(applications).toHaveLength(1);
    expect(applications[0].status).toBe("withdrawn");
    expect(applications[0].notes).not.toBe("Unsafe requeue");
  });
});
