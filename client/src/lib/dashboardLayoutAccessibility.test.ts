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
    const header = readFileSync(new URL("../components/AppHeader.tsx", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("../pages/Dashboard.tsx", import.meta.url), "utf8");

    expect(header).toContain('aria-label={t("hireAiHome")}');
    expect(header).toContain('aria-label={t("openAccountMenu")}');
    expect(dashboard).toContain('<AppHeader currentPage="dashboard" />');
    expect(dashboard).not.toContain('aria-label="Hire.AI home"');
    expect(dashboard).not.toContain('aria-label="Open account menu"');
    expect(header).not.toMatch(/<div[^>]+onClick=\{\(\) => setLocation\("\/"\)\}/);
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
