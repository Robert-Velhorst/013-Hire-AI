import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { translate } from "../contexts/LocaleContext";

describe("localization wiring", () => {
  it("wires the account locale through the provider, shell, and settings mutation", () => {
    const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
    const provider = readFileSync(resolve(process.cwd(), "client/src/contexts/LocaleContext.tsx"), "utf8");
    const layout = readFileSync(resolve(process.cwd(), "client/src/components/DashboardLayout.tsx"), "utf8");
    const settings = readFileSync(resolve(process.cwd(), "client/src/pages/Settings.tsx"), "utf8");
    const appHeader = readFileSync(resolve(process.cwd(), "client/src/components/AppHeader.tsx"), "utf8");

    expect(app).toContain("<LocaleProvider>");
    expect(provider).toContain("document.documentElement.lang = locale");
    expect(provider).toContain("user?.locale");
    expect(layout).toContain("t(item.labelKey)");
    expect(settings).toContain("trpc.auth.updateLocale.useMutation");
    expect(settings).toContain("SUPPORTED_LOCALES.map");
    expect(settings).toContain('<AppHeader currentPage="settings" />');
    expect(settings).toContain('t("accountDeletionReviewDescription")');
    expect(settings).toContain('t("requestDeletionReviewDescription")');
    expect(settings).toContain('aria-label={t("scanFrequency")}');
    expect(settings).not.toContain("Request an operator review of account erasure");
    expect(appHeader).toContain('aria-label={t("openAccountMenu")}');
    expect(appHeader).toContain('t("signOut")');
  });

  it("localizes complete saved-job and not-found workflows with safe interpolation", () => {
    const savedJobs = readFileSync(resolve(process.cwd(), "client/src/pages/SavedJobs.tsx"), "utf8");
    const notFound = readFileSync(resolve(process.cwd(), "client/src/pages/NotFound.tsx"), "utf8");
    const jobAlerts = readFileSync(resolve(process.cwd(), "client/src/pages/JobAlerts.tsx"), "utf8");
    const team = readFileSync(resolve(process.cwd(), "client/src/pages/Team.tsx"), "utf8");
    const aiPreferences = readFileSync(resolve(process.cwd(), "client/src/pages/AIPreferences.tsx"), "utf8");

    expect(savedJobs).toContain("const { locale, t } = useLocale()");
    expect(savedJobs).toContain('t("savedJobsTitle")');
    expect(savedJobs).toContain('toLocaleDateString(locale)');
    expect(notFound).toContain('t("pageNotFound")');
    expect(jobAlerts).toContain('t("jobAlertsTitle")');
    expect(jobAlerts).toContain('toLocaleDateString(locale)');
    expect(jobAlerts).toContain('aria-label={t("deleteAlert"');
    expect(team).toContain('t("teamAccess")');
    expect(team).toContain('toLocaleDateString(locale)');
    expect(aiPreferences).toContain('t("autonomousOperatingControl")');
    expect(aiPreferences).toContain('t("schedulerErrors"');
    expect(aiPreferences).toContain('toLocaleTimeString(locale');
    expect(aiPreferences).not.toContain(">Save AI Preferences<");
    expect(aiPreferences).not.toContain(">Scheduled Background Runs<");
    expect(jobAlerts).not.toContain("â€¢");
    expect(translate("en", "daysAgo", { count: 3 })).toBe("3 days ago");
    expect(translate("nl", "savedOn", { date: "gisteren" })).toBe("Opgeslagen gisteren");
    expect(translate("en", "applicationsCount", { count: 10 })).toBe("10 applications");
    expect(translate("nl", "deletionStatusOpen")).toContain("geen gegevens verwijderd");
    expect(translate("nl", "jobTasksCount", { count: 4 })).toBe("4 vacaturtaken");
  });
});
