import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAdminOperatingActionCopy, getAdminOperatingCopy, getAdminOperatingSummaryCopy } from "../client/src/lib/adminOperatingCopy";
import { getAdminOperatingControlAction } from "../client/src/lib/adminOperatingControl";
import { getAdminOperatingSummary } from "../client/src/lib/adminOperatingSummary";

describe("admin operating localization", () => {
  it("keeps decisions structured and renders the complete operating boundary by locale", () => {
    const summary = getAdminOperatingSummary({
      reviewQueue: [{ priority: "critical", category: "legal_escalation" }],
      overdue: [],
      pendingVerifications: [],
      payments: [],
    });
    const action = getAdminOperatingControlAction(summary);

    expect(summary.presentationId).toBe("critical_legal");
    expect(action).toMatchObject({ id: "review_legal", count: 1, tab: "review", approvalGated: true });
    expect(getAdminOperatingSummaryCopy("nl", summary).label).toBe("Kritieke beoordeling");
    expect(getAdminOperatingActionCopy("nl", action).cta).toBe("Juridische beoordeling openen");
    expect(getAdminOperatingCopy("nl", "approvalBoundary")).toContain("Handmatige goedkeuring");
  });

  it("wires locale presentation and stable metric identifiers into the admin page", () => {
    const admin = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPanel.tsx"), "utf8");

    expect(admin).toContain("const { locale, t } = useLocale()");
    expect(admin).toContain("getAdminOperatingSummaryCopy(locale, operatingSummary)");
    expect(admin).toContain("getAdminOperatingActionCopy(locale, operatingAction)");
    expect(admin).toContain('currency: "USD"');
    expect(admin).toContain('data-testid={`admin-operating-metric-${id}`}');
    expect(admin).not.toContain("operatingSummary.label");
    expect(admin).not.toContain("operatingAction.headline");
  });
});
