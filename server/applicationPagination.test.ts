import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApplication,
  getUserApplicationById,
  getUserApplicationPage,
  getUserApplicationSummary,
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
      active: 3,
      submitted: 3,
      responded: 2,
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
});
