import { describe, expect, it, vi } from "vitest";
import { createDatabaseReadinessProbe } from "./databaseReadiness";

describe("database readiness probe", () => {
  it("coalesces concurrent probes and caches successful results", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = vi.fn(() => pending);
    const readiness = createDatabaseReadinessProbe({ probe });

    const first = readiness.check();
    const second = readiness.check();
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    await expect(readiness.check()).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("fails closed on errors and retries after the short failure cache", async () => {
    let currentTime = 0;
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error("secret database detail"))
      .mockResolvedValue(undefined);
    const readiness = createDatabaseReadinessProbe({
      probe,
      failureTtlMs: 100,
      now: () => currentTime,
    });

    await expect(readiness.check()).resolves.toBe(false);
    currentTime = 99;
    await expect(readiness.check()).resolves.toBe(false);
    currentTime = 100;
    await expect(readiness.check()).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("returns within its deadline when the database does not answer", async () => {
    vi.useFakeTimers();
    try {
      const readiness = createDatabaseReadinessProbe({
        probe: () => new Promise<void>(() => undefined),
        timeoutMs: 25,
      });
      const result = readiness.check();

      await vi.advanceTimersByTimeAsync(25);
      await expect(result).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not accumulate probes after repeated timeouts while the database call is still active", async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const probe = vi.fn(() => pending);
      const readiness = createDatabaseReadinessProbe({
        probe,
        timeoutMs: 25,
        failureTtlMs: 10,
      });

      const first = readiness.check();
      await vi.advanceTimersByTimeAsync(25);
      await expect(first).resolves.toBe(false);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await vi.advanceTimersByTimeAsync(10);
        const repeated = readiness.check();
        await vi.advanceTimersByTimeAsync(25);
        await expect(repeated).resolves.toBe(false);
      }
      expect(probe).toHaveBeenCalledTimes(1);

      release();
      await vi.runAllTimersAsync();
      await expect(readiness.check()).resolves.toBe(true);
      expect(probe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
