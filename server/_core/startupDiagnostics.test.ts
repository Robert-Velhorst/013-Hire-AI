import { afterEach, describe, expect, it, vi } from "vitest";
import { startupStages, writeStartupFailureStage } from "./startupDiagnostics";

describe("startup diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports only a bounded stage label", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (const stage of startupStages) writeStartupFailureStage(stage);

    expect(error.mock.calls.map(([message]) => message)).toEqual([
      "[Server] Startup stage failed: configuration validation.",
      "[Server] Startup stage failed: platform catalog initialization.",
      "[Server] Startup stage failed: application assembly.",
      "[Server] Startup stage failed: listener binding.",
    ]);
  });

  it("does not accept an exception or free-form diagnostic text", () => {
    const source = writeStartupFailureStage.toString();
    expect(writeStartupFailureStage.length).toBe(1);
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("error.stack");
  });
});
