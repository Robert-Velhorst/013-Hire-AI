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
    expect(settings).toContain('translate(savedLocale, "languageSaved")');
    expect(settings).toContain("SUPPORTED_LOCALES.map");
    expect(settings).toContain('<AppHeader currentPage="settings" />');
    expect(settings).toContain('t("accountDeletionReviewDescription")');
    expect(settings).toContain('t("requestDeletionReviewDescription")');
    expect(settings).toContain('aria-label={t("scanFrequency")}');
    expect(settings).not.toContain("Request an operator review of account erasure");
    expect(appHeader).toContain('aria-label={t("openAccountMenu")}');
    expect(appHeader).toContain('t("signOut")');
    expect(appHeader).toContain('t("billingFees")');
    expect(appHeader).toContain('t("adminPanel")');
  });

  it("localizes complete saved-job and not-found workflows with safe interpolation", () => {
    const savedJobs = readFileSync(resolve(process.cwd(), "client/src/pages/SavedJobs.tsx"), "utf8");
    const notFound = readFileSync(resolve(process.cwd(), "client/src/pages/NotFound.tsx"), "utf8");
    const jobAlerts = readFileSync(resolve(process.cwd(), "client/src/pages/JobAlerts.tsx"), "utf8");
    const team = readFileSync(resolve(process.cwd(), "client/src/pages/Team.tsx"), "utf8");
    const aiPreferences = readFileSync(resolve(process.cwd(), "client/src/pages/AIPreferences.tsx"), "utf8");
    const billing = readFileSync(resolve(process.cwd(), "client/src/pages/Billing.tsx"), "utf8");

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
    expect(billing).toContain("const { locale, t } = useLocale()");
    expect(billing).toContain("formatBillingCurrency(total.totalCents, total.currency, locale)");
    expect(billing).toContain("t(cfg.labelKey)");
    expect(billing).toContain('t("billingSuccessFees")');
    expect(billing).toContain('t("submitVerificationDocument")');
    expect(billing).toContain('t("reportEmploymentEnded")');
    expect(billing).not.toContain(">Billing & Success Fees<");
    expect(billing).not.toContain(">Payment History<");
    expect(billing).not.toContain(">Submit Verification<");
    expect(billing).not.toContain("Â·");
    expect(billing).not.toContain('new Intl.NumberFormat("en-US"');
    expect(jobAlerts).not.toContain("â€¢");
    expect(translate("en", "daysAgo", { count: 3 })).toBe("3 days ago");
    expect(translate("nl", "savedOn", { date: "gisteren" })).toBe("Opgeslagen gisteren");
    expect(translate("en", "applicationsCount", { count: 10 })).toBe("10 applications");
    expect(translate("nl", "deletionStatusOpen")).toContain("geen gegevens verwijderd");
    expect(translate("nl", "jobTasksCount", { count: 4 })).toBe("4 vacaturtaken");
    expect(translate("nl", "verificationDueInDays", { count: 4 })).toContain("4");
    expect(translate("nl", "showingPendingReviews", { shown: 25, total: 31 })).toContain("25 van 31");
  });

  it("uses the shared localized header and localized onboarding on the dashboard", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "client/src/pages/Dashboard.tsx"), "utf8");

    expect(dashboard).toContain('<AppHeader currentPage="dashboard" />');
    expect(dashboard).toContain('const { locale, t } = useLocale()');
    expect(dashboard).toContain('t("onboardingTitle")');
    expect(dashboard).toContain('t("welcomeBack"');
    expect(dashboard).not.toContain('aria-label="Open account menu"');
    expect(translate("nl", "billingFees")).toBe("Facturatie en kosten");
    expect(translate("nl", "welcomeBack", { name: "Sam" })).toBe("Welkom terug, Sam!");
  });

  it("uses the persisted locale for core workflow dates and salaries", () => {
    const jobSearch = readFileSync(resolve(process.cwd(), "client/src/pages/JobSearch.tsx"), "utf8");
    const applications = readFileSync(resolve(process.cwd(), "client/src/pages/Applications.tsx"), "utf8");
    const reviewQueue = readFileSync(resolve(process.cwd(), "client/src/pages/ReviewQueue.tsx"), "utf8");

    for (const source of [jobSearch, applications, reviewQueue]) {
      expect(source).toContain("useLocale()");
      expect(source).not.toContain(".toLocaleDateString()");
      expect(source).not.toContain(".toLocaleString()");
    }
    expect(jobSearch).toContain("formatJobSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, locale)");
    expect(jobSearch).toContain('aria-label={t("openJobDetails"');
    expect(jobSearch).toContain('aria-label={t("saveJobForReview"');
    expect(jobSearch).toContain('t("jobSearchTitle")');
    expect(jobSearch).toContain('placeholder={t("searchJobsPlaceholder")}');
    expect(jobSearch).toContain('t("matchDecision")');
    expect(jobSearch).toContain('t("sourcingControlTitle")');
    expect(jobSearch).not.toContain(">Job Search<");
    expect(jobSearch).not.toContain('placeholder="Search jobs');
    expect(jobSearch).not.toContain("Integration required");
    expect(jobSearch).not.toContain("Ã‚Â·");
    expect(applications).toContain("formatCalendarDate(selectedOfferSummary.nextVerificationDue, locale)");
    expect(applications).toContain("<AppHeader />");
    expect(applications).toContain('t("recordEmployerResponseTitle")');
    expect(applications).toContain('t("recordInterviewOutcomeTitle")');
    expect(applications).toContain('t("confirmExternalSubmissionTitle")');
    expect(applications).toContain('t("completeFollowUpDelivery")');
    expect(applications).toContain('t("confirmOfferAcceptanceTitle")');
    expect(applications).toContain('t("declineOfferTitle")');
    expect(applications).not.toContain(">Record Employer Response<");
    expect(applications).not.toContain(">Confirm Submission Evidence<");
    expect(applications).not.toContain('placeholder="Example: Employer portal showed');
    expect(reviewQueue).toContain('t("completedLabel")');
    expect(translate("nl", "listingPosted")).toBe("Geplaatst");
    expect(translate("nl", "statusWithdrawn")).toBe("Ingetrokken");
    expect(translate("nl", "jobSearchTitle")).toBe("Vacatures zoeken");
    expect(translate("nl", "visibleJobs", { count: 3 })).toContain("3");
    expect(translate("nl", "recordEmployerResponseTitle")).toBe("Werkgeversreactie vastleggen");
    expect(translate("nl", "confirmExternalSubmissionTitle")).toBe("Externe indiening bevestigen");
  });

  it("localizes primary candidate evidence and resume controls", () => {
    const profile = readFileSync(resolve(process.cwd(), "client/src/pages/Profile.tsx"), "utf8");
    const dialog = readFileSync(resolve(process.cwd(), "client/src/components/ui/dialog.tsx"), "utf8");

    expect(profile).toContain('const { locale, t } = useLocale()');
    expect(profile).toContain('t("profileEvidenceControl")');
    expect(profile).toContain('t("profileConsentNotice")');
    expect(profile).toContain('t("uploadResume")');
    expect(profile).toContain('t("activeResumeVersion"');
    expect(profile).toContain("formatCalendarDate(experience.startDate, locale)");
    expect(profile).toContain('t("workHistoryDescription"');
    expect(profile).toContain('t("educationDescription"');
    expect(profile).toContain('t("skillsDescription"');
    expect(profile).toContain('t("projectsDescription"');
    expect(profile).toContain('toast.error(t("workExperienceRequired"))');
    expect(profile).toContain('toast.error(t("educationRequired"))');
    expect(profile).toContain('toast.error(t("skillYearsInvalid"))');
    expect(profile).toContain('toast.error(t("projectUrlInvalid"))');
    expect(profile).toContain('aria-label={t("editItem"');
    expect(profile).toContain('aria-label={t("deleteItem"');
    expect(profile).toContain('t("socialPortfolio")');
    expect(profile).toContain('t("publicSocialDescription")');
    expect(profile).toContain('t("jobSearchTargets")');
    expect(profile).toContain('placeholder={t("targetRolesPlaceholder")}');
    expect(profile).toContain('t("classificationFor"');
    expect(profile).toContain('getInboxResponseTypeLabel(candidate.suggestedResponseType, t)');
    expect(profile).toContain('t("confirmDeleteResumeVersion"');
    expect(profile).toContain('getProviderStatusLabel(provider.status, t)');
    expect(profile).toContain('result.requiresOAuth ? "connectorRequestNeedsOAuth" : "connectorRequestNeedsSource"');
    expect(profile).not.toContain('toast.success(result.message');
    expect(profile).not.toContain("External inbox and cloud access requires explicit consent.");
    expect(profile).not.toContain('confirm("Are you sure you want to delete this work experience?")');
    expect(profile).not.toContain('>Add Skill<');
    expect(profile).not.toContain('>Save Search Targets<');
    expect(profile).not.toContain('>Public social profiles<');
    expect(profile).not.toContain('>Interview invite<');
    expect(dialog).toContain('{t("closeLabel")}');
    expect(dialog).not.toContain('>Close<');
    expect(translate("nl", "yourProfile")).toBe("Je profiel");
    expect(translate("nl", "activeResumeVersion", { version: 3 })).toContain("3");
    expect(translate("nl", "workHistoryDescription", { count: 2, limit: 25 })).toContain("2/25");
    expect(translate("nl", "confirmRemoveSkill", { name: "TypeScript" })).toContain("TypeScript");
    expect(translate("nl", "closeLabel")).toBe("Sluiten");
    expect(translate("nl", "foundCloudResumes", { count: 4 })).toContain("4");
    expect(translate("nl", "applicationResponseSummary", { id: 12, type: "Aanbod" })).toBe("Sollicitatie #12 - Aanbod");
    expect(translate("nl", "publicRepositories", { count: 8 })).toContain("8");
  });
});
