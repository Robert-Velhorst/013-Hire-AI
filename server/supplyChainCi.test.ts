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

  it("keeps patched transitive dependencies and safe CLI pruning in active pnpm settings", () => {
    const packageJson = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    const workspace = readFileSync(resolve(process.cwd(), "pnpm-workspace.yaml"), "utf8");
    const lockfile = readFileSync(resolve(process.cwd(), "pnpm-lock.yaml"), "utf8");
    const pnpmfile = readFileSync(resolve(process.cwd(), ".pnpmfile.mjs"), "utf8");

    expect(packageJson).not.toContain('"pnpm": {');
    expect(packageJson).toContain('"axios": "^1.20.0"');
    expect(packageJson).toContain('"vitest": "^4.1.11"');
    expect(workspace).toContain('"nanoid@<3.3.18": "3.3.18"');
    expect(workspace).toContain('"postcss@<=8.5.22": "8.5.23"');
    expect(workspace).toContain('"mermaid@<11.16.1": "11.16.1"');
    expect(workspace).toContain('"dompurify@<=3.4.15": "3.4.16"');
    expect(workspace).toContain('"proxy-addr@<2.0.8": "2.0.8"');
    expect(workspace).toContain('"tinypool@<2.1.2": "2.1.2"');
    expect(pnpmfile).toContain('pkg.name === "mammoth"');
    expect(lockfile).not.toContain("  argparse@1.0.10:");
    expect(lockfile).not.toContain("  sprintf-js@1.0.3:");
    expect(workspace).toContain('"@esbuild-kit/core-utils>esbuild": "0.25.12"');
    expect(workspace).toContain("allowBuilds:");
    expect(workspace).toContain("  esbuild: true");
  });
});
