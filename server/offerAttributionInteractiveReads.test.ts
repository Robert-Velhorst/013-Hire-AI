import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getUserOfferAttributionReviewsForApplications } from "./db";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("bounded interactive offer-attribution reads", () => {
  it("returns a stable empty result without requested application IDs", async () => {
    await expect(getUserOfferAttributionReviewsForApplications(991_304, [])).resolves.toEqual([]);
  });

  it("scopes pending attribution approvals to the owner and requested applications", () => {
    const database = source("server/db.ts");
    const implementation = database.slice(
      database.indexOf("export async function getUserOfferAttributionReviewsForApplications"),
      database.indexOf("export async function getUserOfferAttributionReviewPage")
    );

    expect(implementation).toContain("eq(applicationApprovals.userId, userId)");
    expect(implementation).toContain('eq(applicationApprovals.status, "pending")');
    expect(implementation).toContain('eq(applicationApprovals.approvalType, "offer_attribution")');
    expect(implementation).toContain("inArray(applicationApprovals.applicationId, applicationIds)");
    expect(implementation).toContain("getUserApplicationsByIds(userId, applicationIds)");
    expect(implementation).toContain(".slice(0, 250)");
    expect(implementation).toContain(".limit(500)");
  });

  it("uses scoped reads in application flows and a bounded summary on Billing", () => {
    const router = source("server/routers/successFees.ts");
    const applications = source("client/src/pages/Applications.tsx");
    const dialog = source("client/src/components/ReportHireDialog.tsx");
    const billing = source("client/src/pages/Billing.tsx");

    expect(router).not.toContain("getOfferAttributionReviews: protectedProcedure");
    expect(router).toContain("listOfferAttributionReviewsForApplications: protectedProcedure");
    expect(router).toContain("getOfferAttributionReviewPage: protectedProcedure");
    expect(applications).toContain("listOfferAttributionReviewsForApplications.useQuery");
    expect(dialog).toContain("listOfferAttributionReviewsForApplications.useQuery");
    expect(billing).toContain("getOfferAttributionReviewPage.useQuery({ limit: 25 })");
    expect(billing).toContain('t("showingPendingReviews", { shown: 25, total: offerAttributionReviewPage.total })');
    expect(billing).toContain('setLocation("/applications")');
    expect(applications).not.toContain("getOfferAttributionReviews.useQuery");
    expect(dialog).not.toContain("getOfferAttributionReviews.useQuery");
    expect(billing).not.toContain("getOfferAttributionReviews.useQuery");
  });
});
