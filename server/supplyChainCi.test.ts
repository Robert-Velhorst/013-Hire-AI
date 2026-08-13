import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("supply-chain CI contract", () => {
  it("enforces moderate, high, and critical advisory scanning in CI", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readFileSync(
      resolve(process.cwd(), ".github", "workflows", "ci.yml"),
      "utf8"
    );

    expect(packageJson.scripts?.["security:audit"]).toBe("pnpm audit --audit-level moderate");
    expect(workflow).toContain("Audit moderate, high, and critical dependency vulnerabilities");
    expect(workflow).toContain("run: pnpm security:audit");
  });

  it("keeps transitive Nano ID remediation in pnpm's active workspace settings", () => {
    const packageJson = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    const workspace = readFileSync(resolve(process.cwd(), "pnpm-workspace.yaml"), "utf8");

    expect(packageJson).not.toContain('"pnpm": {');
    expect(workspace).toContain('"nanoid@<3.3.18": "3.3.18"');
    expect(workspace).toContain('"postcss@<=8.5.22": "8.5.23"');
    expect(workspace).toContain('"mermaid@<11.16.1": "11.16.1"');
    expect(workspace).toContain('"dompurify@<=3.4.12": "3.4.13"');
    expect(workspace).toContain('"@esbuild-kit/core-utils>esbuild": "0.25.12"');
    expect(workspace).toContain("allowBuilds:");
    expect(workspace).toContain("  esbuild: true");
  });
});
