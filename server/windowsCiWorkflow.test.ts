import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows runtime CI contract", () => {
  it("runs native Windows launcher, network, HAI, type, and build checks", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github", "workflows", "ci.yml"),
      "utf8"
    );

    expect(workflow).toContain("windows-runtime:");
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("./scripts/check-windows-runtime.ps1");
    expect(workflow).toContain("server/_core/network.test.ts server/haiConnector.test.ts");
    expect(workflow).toContain("run: pnpm check");
    expect(workflow.match(/run: pnpm build/g)).toHaveLength(2);
  });

  it("syntax-checks both supported PowerShell launchers", () => {
    const checker = readFileSync(
      resolve(process.cwd(), "scripts", "check-windows-runtime.ps1"),
      "utf8"
    );

    expect(checker).toContain("start-windows.ps1");
    expect(checker).toContain("start-ngrok.ps1");
    expect(checker).toContain("Language.Parser]::ParseFile");
    expect(checker).toContain("$parseErrors.Count -gt 0");
  });

  it("requires runtime readiness before Windows or ngrok reports success", () => {
    const windowsLauncher = readFileSync(
      resolve(process.cwd(), "scripts", "start-windows.ps1"),
      "utf8"
    );
    const ngrokLauncher = readFileSync(
      resolve(process.cwd(), "scripts", "start-ngrok.ps1"),
      "utf8"
    );

    expect(windowsLauncher).toContain("/readyz");
    expect(windowsLauncher).toContain("$response.ready -eq $true");
    expect(ngrokLauncher.match(/\/readyz/g)).toHaveLength(2);
    expect(ngrokLauncher).toContain("$response.ready -eq $true");
  });
});
