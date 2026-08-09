import { describe, expect, it, vi } from "vitest";
import {
  getSavedJobPage,
  getSavedJobs,
  saveJob,
  unsaveJob,
  updateSavedJobNotes,
} from "./applicationFeatures";

describe("saved jobs memory fallback", () => {
  it("supports save, update, list, and unsave without a configured database", async () => {
    const userId = 990_001;
    const jobId = 1;

    await unsaveJob(userId, jobId);

    const created = await saveJob({
      userId,
      jobId,
      notes: "Queued from review decision.",
      tags: "review-queue",
      priority: "high",
    });
    expect(created.updated).toBe(false);

    const updated = await saveJob({
      userId,
      jobId,
      notes: "Saved after user review.",
      priority: "medium",
    });
    expect(updated).toEqual({ id: created.id, updated: true });

    expect(await getSavedJobs(userId)).toMatchObject([
      {
        id: created.id,
        notes: "Saved after user review.",
        tags: "review-queue",
        priority: "medium",
        updatedAt: expect.any(Date),
      },
    ]);

    await updateSavedJobNotes(userId, jobId, "Ready for manual review.", "manual", "low");

    const saved = await getSavedJobs(userId);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: created.id,
      jobId,
      notes: "Ready for manual review.",
      tags: "manual",
      priority: "low",
    });
    expect(saved[0].job?.id).toBe(jobId);

    await unsaveJob(userId, jobId);
    expect(await getSavedJobs(userId)).toEqual([]);
  });

  it("stores duplicate-source saves against the canonical job and removes them from either source", async () => {
    const userId = 990_002;
    await unsaveJob(userId, 1);

    const duplicateSave = await saveJob({
      userId,
      jobId: 5,
      notes: "Saved from a reposted source.",
    });
    const canonicalSave = await saveJob({
      userId,
      jobId: 1,
      notes: "Updated from the canonical listing.",
    });

    expect(canonicalSave).toEqual({ id: duplicateSave.id, updated: true });
    expect(await getSavedJobs(userId)).toMatchObject([
      { jobId: 1, notes: "Updated from the canonical listing." },
    ]);

    await unsaveJob(userId, 5);
    expect(await getSavedJobs(userId)).toEqual([]);
  });

  it("pages equal-timestamp saves without leaking another owner's records", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T18:00:00.000Z"));
    const userId = 990_003;
    const otherUserId = 990_004;
    try {
      for (const jobId of [1, 2, 3, 4]) {
        await saveJob({ userId, jobId });
      }
      await saveJob({ userId: otherUserId, jobId: 1 });

      const first = await getSavedJobPage(userId, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toEqual({
        updatedAt: new Date("2026-08-09T18:00:00.000Z"),
        id: first.items[1].id,
      });
      const second = await getSavedJobPage(userId, {
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.items).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4);
      expect([...first.items, ...second.items].every((item) => item.userId === userId)).toBe(true);
    } finally {
      vi.useRealTimers();
      for (const jobId of [1, 2, 3, 4]) {
        await unsaveJob(userId, jobId);
      }
      await unsaveJob(otherUserId, 1);
    }
  });
});
