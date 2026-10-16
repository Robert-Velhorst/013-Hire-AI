import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOperationalFailuresForTests,
  getOperationalFailureSnapshot,
  getOperationalFailureSnapshotPage,
  logOperationalFailure,
} from "./operationalFailureLog";

describe("operational failure logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearOperationalFailuresForTests();
  });

  it("aggregates bounded redacted signals without retaining exception or user data", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    logOperationalFailure("Connector<script>", "OAuth user=17 token=secret");
    logOperationalFailure("Connector<script>", "OAuth user=17 token=secret");

    const snapshot = getOperationalFailureSnapshot(5);
    expect(snapshot.totalFailures).toBe(2);
    expect(snapshot.uniqueSignals).toBe(1);
    expect(snapshot.signals).toMatchObject([{
      scope: "Runtime",
      operation: "Unclassified failure",
      count: 2,
    }]);
    expect(JSON.stringify(snapshot)).not.toContain("secret");
  });

  it("caps cardinality and result size", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let index = 0; index < 105; index += 1) {
      logOperationalFailure(`Scope ${index}`, "operation");
    }

    const snapshot = getOperationalFailureSnapshot(3);
    expect(snapshot.uniqueSignals).toBe(1);
    expect(snapshot.totalFailures).toBe(105);
    expect(snapshot.signals).toHaveLength(1);
  });

  it("emits a fixed marker without accepting upstream error details", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logOperationalFailure("ResumeParser", "PDF extraction");

    expect(errorSpy).toHaveBeenCalledWith("[ResumeParser] PDF extraction failed.");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("provider-secret");
  });

  it("keeps memory-fallback cursor pages stable when an existing aggregate is updated", () => {
    logOperationalFailure("Database", "Connection initialization");
    logOperationalFailure("OAuth", "Callback");
    logOperationalFailure("Server", "Startup");

    const firstPage = getOperationalFailureSnapshotPage(1);
    expect(firstPage.signals.map((signal) => signal.operation)).toEqual(["Startup"]);
    expect(firstPage.hasMore).toBe(true);

    logOperationalFailure("Database", "Connection initialization");
    const secondPage = getOperationalFailureSnapshotPage(1, firstPage.nextCursor!.id);
    const thirdPage = getOperationalFailureSnapshotPage(1, secondPage.nextCursor!.id);

    expect(secondPage.signals.map((signal) => signal.operation)).toEqual(["Callback"]);
    expect(thirdPage.signals.map((signal) => signal.operation)).toEqual(["Connection initialization"]);
    expect(thirdPage.signals[0]?.count).toBe(2);
    expect(thirdPage.hasMore).toBe(false);
    expect(thirdPage.nextCursor).toBeNull();
  });
});
