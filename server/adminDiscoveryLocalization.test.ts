import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatAdminOperatingCopy, getAdminOperatingCopy } from "../client/src/lib/adminOperatingCopy";
import { getScraperSourceHealthSummary } from "../client/src/lib/scraperSourceHealth";

describe("admin discovery localization", () => {
  it("keeps source health structured and presents scheduler state by locale", () => {
    const source = getScraperSourceHealthSummary({
      lastScrapeStatus: "success",
      lastScrapeJobCount: 0,
      lastScrapeAttemptedAt: "2026-08-14T01:00:00.000Z",
    }, new Date("2026-08-14T02:00:00.000Z"));

    expect(source).toMatchObject({ outcome: "empty", jobCount: 0, isFresh: true });
    expect(source).not.toHaveProperty("label");
    expect(getAdminOperatingCopy("nl", "outcomeEmpty")).toBe("Geen vacatures waargenomen");
    expect(getAdminOperatingCopy("nl", "runDiscoveryNow")).toBe("Vacatureverkenning nu uitvoeren");
    expect(formatAdminOperatingCopy("nl", "currentSchedule", { minutes: 60, jobs: 100 })).toContain("60 minuten");
  });

  it("localizes the complete runtime and discovery control boundary", () => {
    const admin = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPanel.tsx"), "utf8");

    expect(admin).toContain('ac("runtimeFailureSignals")');
    expect(admin).toContain('ac("discoveryScheduler")');
    expect(admin).toContain("SOURCE_OUTCOME_COPY_KEYS[sourceHealth.outcome]");
    expect(admin).toContain("dateTimeFormatter.format(new Date(platform.lastScrapeAttemptedAt))");
    expect(admin).toContain('data-testid={`admin-discovery-metric-${id}`}');
    expect(admin).toContain('toast.success(ac("schedulerStarted"))');
    expect(admin).toContain('result.outcome === "failed"');
    expect(admin).toContain('result.outcome === "skipped"');
    expect(admin).toContain("ADAPTER_COPY_KEYS[platform.adapter.kind]");
    expect(admin).not.toContain("sourceHealth.label");
    expect(admin).not.toContain("toast.success(result.message)");
    expect(admin).not.toContain("platform.adapter.label");
    expect(admin).not.toContain(">Job discovery scheduler<");
    expect(admin).not.toContain(">Runtime schedule<");
  });
});
