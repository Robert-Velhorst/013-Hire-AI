import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countUserAutonomousPreparationsSince,
  createApplication,
  getUserApplicationById,
  getUserApplicationPage,
  getUserApplicationStatusPage,
  getUserApplicationSummary,
  getUserApplicationsForJobs,
  getUserOperatingApplicationWindow,
} from "./db";

describe("application ledger pagination", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a stable cursor, reports full-ledger totals, and enforces ownership", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00.000Z"));

    const userId = 94101;
    const otherUserId = 94102;
    const statuses = ["pending", "applied", "interview", "rejected"] as const;
    const createdIds: number[] = [];

    for (const [index, status] of statuses.entries()) {
      const result = await createApplication({
        userId,
        jobId: index + 1,
        status,
      });
      createdIds.push(result.insertId);
    }
    await createApplication({ userId: otherUserId, jobId: 1, status: "offer" });

    const firstPage = await getUserApplicationPage(userId, { limit: 2 });
    const secondPage = await getUserApplicationPage(userId, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.items.map((application) => application.id)).toEqual(
      [...createdIds].sort((left, right) => right - left).slice(0, 2)
    );
    expect(firstPage.nextCursor).toEqual({
      createdAt: new Date("2026-08-09T12:00:00.000Z"),
      id: firstPage.items[1].id,
    });
    expect(secondPage.items.map((application) => application.id)).toEqual(
      [...createdIds].sort((left, right) => right - left).slice(2)
    );
    expect(secondPage.nextCursor).toBeNull();
    expect(new Set([...firstPage.items, ...secondPage.items].map(({ id }) => id)).size).toBe(4);

    await expect(getUserApplicationSummary(userId)).resolves.toEqual({
      total: 4,
      prepared: 1,
      active: 3,
      submitted: 3,
      responded: 2,
      responseSignals: 2,
      responseMonitoring: 2,
      interviewing: 1,
      interview: 1,
      offered: 0,
      closed: 1,
    });
    await expect(getUserApplicationById(userId, createdIds[0])).resolves.toMatchObject({
      id: createdIds[0],
      userId,
    });
    await expect(getUserApplicationById(otherUserId, createdIds[0])).resolves.toBeNull();
  });

  it("bounds the operating set while preserving exact job and daily-preparation checks", async () => {
    vi.useFakeTimers();
    const userId = 94103;
    const otherUserId = 94104;
    const baseTime = new Date("2026-08-09T00:00:00.000Z").getTime();
    const createdIds: number[] = [];

    for (let index = 0; index < 260; index += 1) {
      vi.setSystemTime(new Date(baseTime + index * 1000));
      const result = await createApplication({
        userId,
        jobId: 10_000 + index,
        status: "applied",
        notes: index < 3 ? "Autonomous queue: prepared for review." : "Historical application.",
      });
      createdIds.push(result.insertId);
    }
    await createApplication({
      userId: otherUserId,
      jobId: 10_000,
      status: "applied",
      notes: "Autonomous queue: belongs to another user.",
    });

    const window = await getUserOperatingApplicationWindow(userId, 25);
    expect(window).toMatchObject({ hasMore: true, limit: 25 });
    expect(window.items).toHaveLength(25);
    expect(window.items.map(({ id }) => id)).toEqual(createdIds.slice(0, 25));
    expect(window.items.every((application) => application.userId === userId)).toBe(true);

    const exactJobs = await getUserApplicationsForJobs(userId, [10_259, 10_000, 10_259, -1]);
    expect(exactJobs.map(({ jobId }) => jobId).sort((left, right) => left - right)).toEqual([10_000, 10_259]);
    expect(exactJobs.every((application) => application.userId === userId)).toBe(true);
    await expect(
      countUserAutonomousPreparationsSince(userId, new Date(baseTime))
    ).resolves.toBe(3);
  });

  it("pages one owned application status with a stable id cursor", async () => {
    const userId = 94105;
    const otherUserId = 94106;
    const interviewIds: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const application = await createApplication({
        userId,
        jobId: 20_000 + index,
        status: "interview",
      });
      interviewIds.push(application.insertId);
    }
    await createApplication({ userId, jobId: 20_003, status: "applied" });
    await createApplication({ userId: otherUserId, jobId: 20_000, status: "interview" });

    const firstPage = await getUserApplicationStatusPage(userId, "interview", 0, 2);
    const secondPage = await getUserApplicationStatusPage(
      userId,
      "interview",
      firstPage.nextAfterId ?? 0,
      2
    );

    expect(firstPage).toMatchObject({ limit: 2, hasMore: true });
    expect(firstPage.items.map((application) => application.id)).toEqual(interviewIds.slice(0, 2));
    expect(secondPage.items.map((application) => application.id)).toEqual(interviewIds.slice(2));
    expect(secondPage.hasMore).toBe(false);
    expect([...firstPage.items, ...secondPage.items].every((application) =>
      application.userId === userId && application.status === "interview"
    )).toBe(true);
  });
});
