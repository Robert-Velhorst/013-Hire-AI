import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dashboard layout landmarks", () => {
  it("uses SidebarInset as the only primary landmark", () => {
    const layout = readFileSync(
      new URL("../components/DashboardLayout.tsx", import.meta.url),
      "utf8"
    );
    const sidebar = readFileSync(
      new URL("../components/ui/sidebar.tsx", import.meta.url),
      "utf8"
    );

    expect(sidebar).toMatch(/function SidebarInset[\s\S]*?<main\b/);
    expect(layout).not.toMatch(/<main\b/);
  });

  it("keeps brand and account navigation keyboard accessible", () => {
    for (const sourcePath of [
      "../components/AppHeader.tsx",
      "../pages/Dashboard.tsx",
    ]) {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
      expect(source).toContain('aria-label="Hire.AI home"');
      expect(source).toContain('aria-label="Open account menu"');
      expect(source).not.toMatch(/<div[^>]+onClick=\{\(\) => setLocation\("\/"\)\}/);
    }
  });

  it("allows sentence-length dashboard status badges to wrap", () => {
    const dashboard = readFileSync(
      new URL("../pages/Dashboard.tsx", import.meta.url),
      "utf8"
    );
    const wrappingStatusBadges = dashboard.match(
      /<Badge variant="outline" className="max-w-full whitespace-normal/g
    );

    expect(wrappingStatusBadges).toHaveLength(3);
  });
});
