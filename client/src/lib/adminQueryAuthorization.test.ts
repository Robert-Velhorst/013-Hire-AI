import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin UI query authorization", () => {
  it("does not execute privileged queries before the admin role is known", () => {
    const source = readFileSync(
      resolve(process.cwd(), "client", "src", "pages", "AdminPanel.tsx"),
      "utf8"
    );

    expect(source).toContain('const isAdmin = user?.role === "admin";');
    expect(source).not.toContain("trpc.admin.getStats.useQuery();");
    expect(source).toContain("{ enabled: isAdmin }");
    expect(source).toContain("enabled: isAdmin && evidenceDialog.open");
    expect(source.match(/enabled: isAdmin/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
  });
});
