import { afterEach, describe, expect, it, vi } from "vitest";
import { startupStages, writeStartupFailureStage } from "./startupDiagnostics";

describe("startup diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports only a bounded stage label", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    for (const stage of startupStages) writeStartupFailureStage(stage);

    expect(error.mock.calls.map(([message]) => message)).toEqual([
      "[Server] Startup stage failed: configuration validation.",
      "[Server] Startup stage failed: database schema validation.",
      "[Server] Startup stage failed: platform catalog initialization.",
      "[Server] Startup stage failed: application assembly.",
      "[Server] Startup stage failed: listener binding.",
    ]);
  });

  it("does not accept an exception or free-form diagnostic text", () => {
    const source = writeStartupFailureStage.toString();
    expect(writeStartupFailureStage.length).toBe(2);
    expect(source).not.toContain("error.stack");
  });

  it("reports bounded startup error details without credentials or URLs", () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const error = new Error(
      "Failed for https://user:password@example.test using password=secret and token abcdef0123456789abcdef0123456789"
    );
    Object.assign(error, { code: "ERR_TEST" });

    writeStartupFailureStage("application assembly", error);

    expect(errorLog.mock.calls[1]?.[0]).toContain("Error: ERR_TEST");
    expect(errorLog.mock.calls[1]?.[0]).toContain("[redacted-url]");
    expect(errorLog.mock.calls[1]?.[0]).not.toContain("password@example.test");
    expect(errorLog.mock.calls[1]?.[0]).not.toContain("password=secret");
    expect(errorLog.mock.calls[1]?.[0]).not.toContain("abcdef0123456789");
  });

  it("does not log arbitrary non-error startup values", () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    writeStartupFailureStage("application assembly", {
      token: "private",
    });

    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
