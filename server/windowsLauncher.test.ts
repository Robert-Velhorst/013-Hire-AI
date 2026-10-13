import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Native PowerShell execution belongs to the Windows CI job; no external service is started.
describe.skipIf(process.platform !== "win32").each(["windows", "ngrok"])("%s launcher readiness binding", launcher => {
  let results: Array<{
    scenario: string; announced: boolean; error: string | null; launchId: string;
    restoredId: string; stopped: number[];
  }>;
  beforeAll(() => {
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      resolve("scripts/fixtures/windows-launcher-harness.ps1"),
      "-Launcher", launcher,
    ], { encoding: "utf8", timeout: 30_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    results = JSON.parse(result.stdout.trim());
    expect(results).toHaveLength(launcher === "windows" ? 7 : 9);
  }, 40_000);
  function run(scenario: string) {
    const result = results.find(item => item.scenario === scenario);
    expect(result).toBeDefined();
    return result!;
  }

  it("announces a matching live runtime and preserves the parent identity", () => {
    const result = run("matching");
    expect(result.error).toBeNull();
    expect(result.announced).toBe(true);
    expect(result.launchId).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(result.launchId).not.toBe("parent-value-must-be-restored");
    expect(result.restoredId).toBe("parent-value-must-be-restored");
  });

  const rejected = ["foreign", "case-mismatch", "missing", "string-ready", "exited", "start-failure"];
  if (launcher === "ngrok") rejected.push("local-string-ready", "local-newline-id");
  it.each(rejected)(
    "does not announce readiness for %s responses", scenario => {
      const result = run(scenario);
      expect(result.announced).toBe(false);
      if (scenario === "start-failure") {
        expect(result.error).toBe("Fixture start failure");
      } else if (scenario === "local-string-ready") {
        expect(result.error).toBe("The local Hire.AI runtime is not ready.");
      } else if (scenario === "local-newline-id") {
        expect(result.error).toBe("The local Hire.AI runtime did not provide a valid process identity.");
      } else if (launcher === "windows") {
        expect(result.error).toMatch(/^Hire.AI did not become ready\./);
      } else {
        expect(result.error).toMatch(/^The ngrok endpoint (did not pass public readiness verification|is ready but does not match the local Hire.AI runtime)\./);
      }
      expect(result.restoredId).toBe("parent-value-must-be-restored");
      expect(result.stopped).toEqual(
        ["start-failure", "exited", "local-string-ready", "local-newline-id"].includes(scenario)
          ? [] : [424242]
      );
    }
  );
});
