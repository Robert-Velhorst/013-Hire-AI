import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOperationalFailuresForTests,
  getOperationalFailureSnapshot,
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

  it("pages in stable insertion order when an existing signal updates", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const known = [
      ["Database", "Connection initialization"],
      ["Database", "User upsert"],
      ["Discovery", "Job polling"],
      ["Discovery", "Subscriber notification"],
      ["ResumeParser", "PDF extraction"],
      ["ResumeParser", "DOCX extraction"],
    ] as const;
    known.forEach(([scope, operation]) => logOperationalFailure(scope, operation));

    const first = getOperationalFailureSnapshot(2);
    expect(first.signals).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe(first.signals[1]?.id);

    logOperationalFailure("Database", "Connection initialization");
    logOperationalFailure("Server", "Startup");
    const second = getOperationalFailureSnapshot(2, first.nextCursor!);
    const third = getOperationalFailureSnapshot(2, second.nextCursor!);

    const visitedIds = [...first.signals, ...second.signals, ...third.signals].map(signal => signal.id);
    expect(new Set(visitedIds).size).toBe(visitedIds.length);
    expect(visitedIds).not.toContain(getOperationalFailureSnapshot(1).signals[0]?.id);
  });

  it("emits a fixed marker without accepting upstream error details", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logOperationalFailure("ResumeParser", "PDF extraction");

    expect(errorSpy).toHaveBeenCalledWith("[ResumeParser] PDF extraction failed.");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("provider-secret");
  });
});
