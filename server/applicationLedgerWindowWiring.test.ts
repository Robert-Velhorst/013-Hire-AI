import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_LEDGER_WINDOW_LIMITS,
  takeApplicationLedgerWindow,
} from "../shared/applicationLedgerWindow";

describe("application ledger detail windows", () => {
  it("uses small render-aligned windows with one-row overflow detection", () => {
    expect(APPLICATION_LEDGER_WINDOW_LIMITS).toEqual({
      attempts: 5,
      employerResponses: 5,
      auditEvents: 6,
    });
    expect(takeApplicationLedgerWindow([1, 2, 3], 2)).toEqual({
      items: [1, 2],
      hasMore: true,
    });
  });

  it("keeps complete internal reads separate from the bounded interactive route", () => {
    const database = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const applicationFeatures = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");

    expect(database).toContain("readApplicationLedgerArtifacts(applicationId, userId, false)");
    expect(database).toContain("readApplicationLedgerArtifacts(applicationId, userId, true)");
    expect(router).toContain("getApplicationLedgerArtifactWindow(input.applicationId, ctx.user.id)");
    expect(applicationFeatures).toContain("getApplicationLedgerArtifacts(input.applicationId, userId)");
  });

  it("surfaces recent-window overflow truthfully in the application detail UI", () => {
    const page = readFileSync(resolve(process.cwd(), "client", "src", "pages", "Applications.tsx"), "utf8");

    expect(page).toContain("ledgerArtifacts?.hasMore.attempts");
    expect(page).toContain("ledgerArtifacts?.hasMore.employerResponses");
    expect(page).toContain("ledgerArtifacts?.hasMore.auditEvents");
    expect(page).toContain("Recent employer responses");
    expect(page).toContain("Recent audit trail");
  });
});
