import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("supply-chain CI contract", () => {
  it("enforces high and critical advisory scanning in CI", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readFileSync(
      resolve(process.cwd(), ".github", "workflows", "ci.yml"),
      "utf8"
    );

    expect(packageJson.scripts?.["security:audit"]).toBe("pnpm audit --audit-level high");
    expect(workflow).toContain("Audit high and critical dependency vulnerabilities");
    expect(workflow).toContain("run: pnpm security:audit");
  });

  it("keeps transitive Nano ID remediation in pnpm's active workspace settings", () => {
    const packageJson = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    const workspace = readFileSync(resolve(process.cwd(), "pnpm-workspace.yaml"), "utf8");

    expect(packageJson).not.toContain('"pnpm": {');
    expect(workspace).toContain('"nanoid@<3.3.17": "3.3.17"');
  });
});
