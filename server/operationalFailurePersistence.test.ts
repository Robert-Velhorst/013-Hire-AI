import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOperationalFailuresForTests,
  configureOperationalFailurePersistence,
  flushOperationalFailurePersistence,
  logOperationalFailure,
} from "./operationalFailureLog";

describe("operational failure persistence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearOperationalFailuresForTests();
  });

  it("coalesces repeated redacted signals into one bounded persistence batch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sink = vi.fn(async () => undefined);
    configureOperationalFailurePersistence(sink);

    logOperationalFailure("ResumeParser", "PDF extraction");
    logOperationalFailure("ResumeParser", "PDF extraction");
    logOperationalFailure("scope user=17", "token=provider-secret");
    await flushOperationalFailurePersistence();

    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "ResumeParser", operation: "PDF extraction", count: 2 }),
      expect.objectContaining({ scope: "Runtime", operation: "Unclassified failure", count: 1 }),
    ]));
    expect(JSON.stringify(sink.mock.calls)).not.toContain("provider-secret");
    expect(JSON.stringify(sink.mock.calls)).not.toContain("user=17");
  });

  it("requeues a failed batch without duplicating its count", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sink = vi.fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(undefined);
    configureOperationalFailurePersistence(sink);
    logOperationalFailure("Server", "Startup");

    await expect(flushOperationalFailurePersistence()).rejects.toThrow("database unavailable");
    await expect(flushOperationalFailurePersistence()).resolves.toBeUndefined();

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1][0]).toEqual([
      expect.objectContaining({ scope: "Server", operation: "Startup", count: 1 }),
    ]);
  });
});
