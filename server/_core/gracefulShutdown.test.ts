import { describe, expect, it, vi } from "vitest";
import { drainRuntime } from "./gracefulShutdown";

describe("runtime shutdown drain", () => {
  it("closes the listener before starting background stoppers", async () => {
    const order: string[] = [];
    let finishClose!: (error?: Error) => void;
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        order.push("listener");
        finishClose = callback;
        return server;
      }),
    };
    const firstStop = vi.fn(async () => { order.push("first"); });
    const secondStop = vi.fn(async () => { order.push("second"); });

    const draining = drainRuntime(server as any, [firstStop, secondStop]);
    await vi.waitFor(() => expect(secondStop).toHaveBeenCalledOnce());
    expect(order).toEqual(["listener", "first", "second"]);

    finishClose();
    await expect(draining).resolves.toBeUndefined();
  });

  it("waits for sibling cleanup before surfacing a sanitized failure", async () => {
    let finishClose!: () => void;
    let releaseSlowStop!: () => void;
    const server = {
      close: vi.fn((callback: () => void) => {
        finishClose = callback;
        return server;
      }),
    };
    const slowStop = vi.fn(() => new Promise<void>((resolve) => { releaseSlowStop = resolve; }));
    const failedStop = vi.fn(async () => { throw new Error("Bearer shutdown-secret"); });
    let settled = false;
    const draining = drainRuntime(server as any, [slowStop, failedStop]).finally(() => { settled = true; });
    await vi.waitFor(() => expect(failedStop).toHaveBeenCalledOnce());
    finishClose();
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseSlowStop();
    await expect(draining).rejects.toThrow("Runtime shutdown could not complete.");
    await expect(draining).rejects.not.toThrow("shutdown-secret");
  });

  it("runs shared-resource finalizers only after listener and workers drain", async () => {
    const order: string[] = [];
    let finishClose!: () => void;
    let finishWorker!: () => void;
    const server = {
      close: vi.fn((callback: () => void) => {
        order.push("listener-start");
        finishClose = () => {
          order.push("listener-done");
          callback();
        };
        return server;
      }),
    };
    const worker = vi.fn(() => new Promise<void>((resolve) => {
      order.push("worker-start");
      finishWorker = () => {
        order.push("worker-done");
        resolve();
      };
    }));
    const database = vi.fn(async () => { order.push("database-close"); });

    const draining = drainRuntime(server as any, [worker], [database]);
    await vi.waitFor(() => expect(worker).toHaveBeenCalledOnce());
    expect(database).not.toHaveBeenCalled();
    finishClose();
    await Promise.resolve();
    expect(database).not.toHaveBeenCalled();
    finishWorker();
    await expect(draining).resolves.toBeUndefined();
    expect(order).toEqual([
      "listener-start",
      "worker-start",
      "listener-done",
      "worker-done",
      "database-close",
    ]);
  });

  it("still closes shared resources after a drain failure", async () => {
    const server = {
      close: vi.fn((callback: () => void) => {
        callback();
        return server;
      }),
    };
    const database = vi.fn(async () => undefined);

    await expect(drainRuntime(
      server as any,
      [async () => { throw new Error("worker-secret"); }],
      [database]
    )).rejects.toThrow("Runtime shutdown could not complete.");
    expect(database).toHaveBeenCalledOnce();
  });
});
