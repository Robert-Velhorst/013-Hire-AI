import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("calendar date wiring", () => {
  it("uses timezone-stable formatting for billing and profile calendar fields", () => {
    const billing = source("client/src/pages/Billing.tsx");
    const profile = source("client/src/pages/Profile.tsx");

    expect(billing).toContain("formatBillingCalendarDate(complianceSummary.nextVerificationDue, locale)");
    expect(billing).toContain("formatBillingCalendarDate(fee.startDate, locale)");
    expect(billing).toContain("formatBillingCalendarDate(payment.periodStart, locale)");
    expect(profile).toContain("calendarDateForInput(value)");
    expect(profile).toContain("formatCalendarDate(experience.startDate)");
    expect(profile).toContain("calendarYear(education.endDate)");
    expect(profile).not.toContain("new Date(experience.endDate).toLocaleDateString()");
  });

  it("keeps verification deadlines stable across operating screens", () => {
    const dashboard = source("client/src/pages/Dashboard.tsx");
    const applications = source("client/src/pages/Applications.tsx");
    const reviewQueue = source("client/src/pages/ReviewQueue.tsx");

    expect(dashboard).toContain("formatCalendarDate(successFeeCompliance.nextVerificationDue)");
    expect(applications).toContain("formatCalendarDate(selectedOfferSummary.nextVerificationDue)");
    expect(reviewQueue).toContain("formatCalendarDate(item.nextVerificationDue)");
  });
});
