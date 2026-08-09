import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("private document download wiring", () => {
  it("authorizes owner and administrator downloads before creating signed URLs", () => {
    const fees = source("server/routers/successFees.ts");
    const admin = source("server/routers/admin.ts");

    expect(fees).toContain("getOfferLetterDownloadUrl: protectedProcedure");
    expect(fees).toContain("eq(successFees.userId, ctx.user.id)");
    expect(fees).toContain("await storageGet(fee.offerLetterKey)");
    expect(admin).toContain("getVerificationDocumentDownloadUrl: adminProcedure");
    expect(admin).toContain("await storageGet(verification.documentKey)");
    expect(admin).toContain('actor: "admin"');
  });

  it("does not expose private object references as browser links", () => {
    const fees = source("server/routers/successFees.ts");
    const admin = source("server/routers/admin.ts");
    const billing = source("client/src/pages/Billing.tsx");
    const adminPanel = source("client/src/pages/AdminPanel.tsx");

    expect(fees).toContain("items: page.items.map(toUserSuccessFeeView)");
    expect(admin).toContain("hasDocument:");
    expect(admin).not.toContain("documentUrl: employmentVerifications.documentUrl");
    expect(billing).toContain("getOfferLetterDownloadUrl.useMutation");
    expect(adminPanel).toContain("getVerificationDocumentDownloadUrl.useMutation");
    expect(billing).not.toContain("href={fee.offerLetterUrl}");
    expect(adminPanel).not.toContain("href={v.documentUrl}");
    expect(billing).not.toContain("window.open(data.checkoutUrl");
    expect(source("client/src/components/ReportHireDialog.tsx")).toContain("openExternalUrl(data.checkoutUrl)");
    expect(source("client/src/pages/Profile.tsx")).toContain("openExternalUrl(result.data?.url)");
  });
});
