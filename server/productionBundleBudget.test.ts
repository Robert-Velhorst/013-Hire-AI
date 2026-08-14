import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production browser bundle budget", () => {
  it("keeps stable runtime dependency groups independently cacheable", () => {
    const config = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

    for (const chunk of ["vendor-react", "vendor-data"]) {
      expect(config).toContain(`return "${chunk}"`);
    }
    expect(config).toContain('moduleId.lastIndexOf("/node_modules/")');
    expect(config).not.toContain('return "vendor-ui"');
    expect(config).not.toContain('return "vendor-common"');
  });

  it("enforces a maximum production JavaScript chunk size", () => {
    const audit = readFileSync(
      resolve(process.cwd(), "scripts", "check-production-bundle.mjs"),
      "utf8",
    );

    expect(audit).toContain("maximumJavaScriptChunkBytes = 350 * 1024");
    expect(audit).toContain("maximumStartupJavaScriptBytes = 600 * 1024");
    expect(audit).toContain('name.endsWith(".js")');
    expect(audit).toContain("startupJavaScriptBytes > maximumStartupJavaScriptBytes");
  });

  it("does not retain prototype showcases or source backups", () => {
    const pages = readdirSync(resolve(process.cwd(), "client", "src", "pages"));

    expect(pages).not.toContain("ComponentShowcase.tsx");
    expect(pages.some((name) => name.endsWith(".backup"))).toBe(false);
  });
});
