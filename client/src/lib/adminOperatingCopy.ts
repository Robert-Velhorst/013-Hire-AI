import type { SupportedLocale } from "@shared/localization";
import type { AdminOperatingControlAction, AdminOperatingControlActionId } from "./adminOperatingControl";
import type { AdminOperatingSummary } from "./adminOperatingSummary";

type ActionCopy = { label: string; headline: string; detail: string; cta: string };
type SummaryCopy = { label: string; nextAction: string };

const staticCopy = {
  en: {
    operations: "Hire.AI Operations", refresh: "Refresh", accessDenied: "Access denied",
    accessDeniedDetail: "You do not have permission to access the admin panel.", operatingQueue: "Admin operating queue",
    approvalBoundary: "Manual admin approval is still required for legal escalation, suspension, billing changes, and verification decisions.",
    approvalGated: "Approval gated", openWork: "Open work", critical: "Critical", overdue: "Overdue",
    verifications: "Verifications", failedPayments: "Failed payments", legal: "Legal", offerReviews: "Offer reviews",
    monthlyRevenue: "Monthly revenue", activeFees: "Active fees", pendingVerification: "Pending verification",
    overdueVerifications: "Overdue verifications", reviewItems: "Review items", suspended: "Suspended", paused: "Paused",
    disputed: "Disputed", totalRevenue: "Total revenue", totalUsers: "Total users",
    runtimeFailureSignals: "Runtime failure signals", failuresRecorded: "{count} recorded",
    runtimeFailureDescription: "Redacted aggregate counters for failed provider and runtime operations across restarts and app instances. No exception text, user data, or credentials are stored.",
    occurrencesLast: "{count} occurrence(s) - last {date}", noFailureSignals: "No redacted failure signals have been recorded.",
    allFees: "All fees", overdueTab: "Overdue", verificationsTab: "Verifications", reviewTab: "Review", paymentsTab: "Payments", jobDiscovery: "Job discovery",
    discoveryScheduler: "Job discovery scheduler", scheduled: "Scheduled", stopped: "Stopped", running: "Running",
    lastCycleClean: "Last cycle clean", lastCyclePartial: "Last cycle partial", lastCycleFailed: "Last cycle failed",
    readySources: "Ready sources", freshSources: "Fresh sources", dedicatedAdapters: "Source-specific adapters", genericAdapters: "Generic adapters",
    freshEmptySources: "Fresh no-listing sources", freshFailedSources: "Fresh failed sources", freshPartialSources: "Fresh partial sources",
    historicalOutcomes: "Historical source outcomes", registrySources: "Registry sources", completedCycles: "Completed cycles", cleanCycles: "Clean cycles",
    partialCycles: "Partial cycles", failedCycles: "Failed cycles", jobsSaved: "Jobs saved", alertMatches: "Alert matches",
    concurrentSourceCap: "Concurrent source cap", sourceTimeout: "Source timeout", attentionSignals: "Current attention signals",
    lastCycle: "Last cycle", nextScheduledRun: "Next scheduled run", noRecordedCycle: "No recorded cycle", notScheduled: "Not scheduled",
    adapterEvidenceNotice: "Adapter type describes the parser implementation, not verified production coverage. Use each source's health and latest outcome to assess discovery reliability.",
    registryConfigurationTitle: "Source registry needs configuration", registryConfigurationDetail: "{count} registered source(s) are not configured for this deployment. The scheduler only runs ready sources with durable provenance.",
    configuredAttentionTitle: "Configured sources need attention", configuredAttentionDetail: "{count} active source(s) are configured but not ready. They are excluded from scheduling until initialization succeeds.",
    emptySourcesTitle: "Source scans returned no listings", emptySourcesDetail: "{count} active source(s) returned no listings in the last 24 hours. This is not a transport failure, but it is not evidence of current discovery coverage.",
    sourceOutcomesTitle: "Latest source outcomes need attention", sourceOutcomesDetail: "{failed} failed and {partial} partial source outcome(s) were recorded in the last 24 hours. Inspect the source health table before relying on full discovery coverage.",
    alertRefreshTitle: "Job alerts need refresh attention", alertRefreshDetail: "The scrape completed, but internal job-alert matching could not refresh. Existing discovery results remain available and no external job-match notification was sent.",
    latestSourceIssues: "Latest source issues", runtimeSchedule: "Runtime schedule", intervalMinutes: "Interval (minutes)", maximumJobs: "Maximum jobs per run",
    limitSources: "Limit discovery to selected sources", updateSchedule: "Update schedule", startSchedule: "Start schedule", stopAction: "Stop", runDiscoveryNow: "Run discovery now",
    currentSchedule: "Current: every {minutes} minutes, up to {jobs} jobs per run.", restrictedSources: "Restricted to {count} selected source(s).", allConfiguredSources: "All active configured sources are included.",
    activeSourceHealth: "Active source health", source: "Source", adapter: "Adapter", readiness: "Readiness", latestOutcome: "Latest outcome", freshness: "Freshness",
    listings: "Listings", lastAttempt: "Last attempt", lastSuccessfulScrape: "Last successful scrape", general: "General", ready: "Ready", unavailable: "Unavailable",
    outcomeSuccess: "Succeeded", outcomeEmpty: "No listings observed", outcomePartial: "Partial", outcomeFailed: "Failed", outcomeAwaiting: "Awaiting scan",
    fresh: "Fresh", stale: "Stale", noRecordedRun: "No recorded run", noRecordedAttempt: "No recorded attempt", awaitingSuccessfulScrape: "Awaiting first successful scrape",
    noActiveSources: "No active configured scraper sources.", schedulerStarted: "Discovery schedule updated", schedulerStopped: "Discovery schedule stopped", discoveryRunStarted: "Discovery run completed",
    discoveryRunSkipped: "A discovery run is already active on another app instance.", discoveryRunFailed: "The discovery run could not complete.", discoveryRunJoined: "The active discovery run completed.",
    dedicatedAdapterLabel: "Source-specific adapter", dedicatedAdapterDetail: "Uses a source-specific parser. Current source health still determines availability.",
    rssAdapterLabel: "Generic RSS adapter", rssAdapterDetail: "Uses generic RSS extraction. Review source health and output before relying on coverage.",
    htmlAdapterLabel: "Generic HTML adapter", htmlAdapterDetail: "Uses generic HTML extraction. Review source health and output before relying on coverage.",
    invalidInterval: "Choose an interval between 5 minutes and 24 hours.", invalidJobLimit: "Choose 10 to 1,000 jobs per run.", selectSource: "Select at least one source or use all active sources.",
  },
  nl: {
    operations: "Hire.AI-beheer", refresh: "Vernieuwen", accessDenied: "Toegang geweigerd",
    accessDeniedDetail: "Je hebt geen toestemming om het beheerpaneel te openen.", operatingQueue: "Operationele beheerwachtrij",
    approvalBoundary: "Handmatige goedkeuring door beheer blijft vereist voor juridische escalatie, opschorting, factureringswijzigingen en verificatiebesluiten.",
    approvalGated: "Goedkeuring vereist", openWork: "Openstaand werk", critical: "Kritiek", overdue: "Te laat",
    verifications: "Verificaties", failedPayments: "Mislukte betalingen", legal: "Juridisch", offerReviews: "Aanbiedingsbeoordelingen",
    monthlyRevenue: "Maandelijkse omzet", activeFees: "Actieve vergoedingen", pendingVerification: "Openstaande verificatie",
    overdueVerifications: "Te late verificaties", reviewItems: "Beoordelingspunten", suspended: "Opgeschort", paused: "Gepauzeerd",
    disputed: "Betwist", totalRevenue: "Totale omzet", totalUsers: "Totaal gebruikers",
    runtimeFailureSignals: "Signalen van runtimefouten", failuresRecorded: "{count} vastgelegd",
    runtimeFailureDescription: "Geanonimiseerde totaaltellers voor mislukte provider- en runtimebewerkingen over herstarts en app-instanties. Er worden geen uitzonderingstekst, gebruikersgegevens of inloggegevens opgeslagen.",
    occurrencesLast: "{count} keer voorgekomen - laatst {date}", noFailureSignals: "Er zijn geen geanonimiseerde foutsignalen vastgelegd.",
    allFees: "Alle vergoedingen", overdueTab: "Te laat", verificationsTab: "Verificaties", reviewTab: "Beoordeling", paymentsTab: "Betalingen", jobDiscovery: "Vacatureverkenning",
    discoveryScheduler: "Planning voor vacatureverkenning", scheduled: "Ingepland", stopped: "Gestopt", running: "Actief",
    lastCycleClean: "Laatste cyclus geslaagd", lastCyclePartial: "Laatste cyclus gedeeltelijk", lastCycleFailed: "Laatste cyclus mislukt",
    readySources: "Gereedstaande bronnen", freshSources: "Actuele bronnen", dedicatedAdapters: "Bronspecifieke adapters", genericAdapters: "Generieke adapters",
    freshEmptySources: "Actuele bronnen zonder vacatures", freshFailedSources: "Actuele mislukte bronnen", freshPartialSources: "Actuele gedeeltelijke bronnen",
    historicalOutcomes: "Historische bronresultaten", registrySources: "Registerbronnen", completedCycles: "Voltooide cycli", cleanCycles: "Geslaagde cycli",
    partialCycles: "Gedeeltelijke cycli", failedCycles: "Mislukte cycli", jobsSaved: "Opgeslagen vacatures", alertMatches: "Waarschuwingsmatches",
    concurrentSourceCap: "Limiet gelijktijdige bronnen", sourceTimeout: "Time-out per bron", attentionSignals: "Actuele aandachtssignalen",
    lastCycle: "Laatste cyclus", nextScheduledRun: "Volgende geplande uitvoering", noRecordedCycle: "Geen cyclus vastgelegd", notScheduled: "Niet ingepland",
    adapterEvidenceNotice: "Het adaptertype beschrijft de parserimplementatie, niet de geverifieerde productiedekking. Gebruik de gezondheid en het laatste resultaat van elke bron om de betrouwbaarheid te beoordelen.",
    registryConfigurationTitle: "Bronregister vereist configuratie", registryConfigurationDetail: "{count} geregistreerde bron(nen) zijn niet geconfigureerd voor deze implementatie. De planner voert alleen gereedstaande bronnen met duurzame herkomst uit.",
    configuredAttentionTitle: "Geconfigureerde bronnen vereisen aandacht", configuredAttentionDetail: "{count} actieve bron(nen) zijn geconfigureerd maar niet gereed. Ze blijven buiten de planning totdat initialisatie slaagt.",
    emptySourcesTitle: "Bronscans leverden geen vacatures op", emptySourcesDetail: "{count} actieve bron(nen) leverden in de afgelopen 24 uur geen vacatures op. Dit is geen transportfout, maar ook geen bewijs van actuele dekking.",
    sourceOutcomesTitle: "Laatste bronresultaten vereisen aandacht", sourceOutcomesDetail: "In de afgelopen 24 uur zijn {failed} mislukte en {partial} gedeeltelijke bronresultaten vastgelegd. Controleer de brontabel voordat je uitgaat van volledige dekking.",
    alertRefreshTitle: "Vacaturewaarschuwingen vereisen vernieuwing", alertRefreshDetail: "De scan is voltooid, maar interne matching van vacaturewaarschuwingen kon niet worden vernieuwd. Bestaande resultaten blijven beschikbaar en er is geen externe matchmelding verzonden.",
    latestSourceIssues: "Laatste bronproblemen", runtimeSchedule: "Runtimeplanning", intervalMinutes: "Interval (minuten)", maximumJobs: "Maximaal aantal vacatures per uitvoering",
    limitSources: "Verkenning beperken tot geselecteerde bronnen", updateSchedule: "Planning bijwerken", startSchedule: "Planning starten", stopAction: "Stoppen", runDiscoveryNow: "Vacatureverkenning nu uitvoeren",
    currentSchedule: "Huidig: elke {minutes} minuten, maximaal {jobs} vacatures per uitvoering.", restrictedSources: "Beperkt tot {count} geselecteerde bron(nen).", allConfiguredSources: "Alle actieve geconfigureerde bronnen zijn opgenomen.",
    activeSourceHealth: "Gezondheid actieve bronnen", source: "Bron", adapter: "Adapter", readiness: "Gereedheid", latestOutcome: "Laatste resultaat", freshness: "Actualiteit",
    listings: "Vacatures", lastAttempt: "Laatste poging", lastSuccessfulScrape: "Laatste geslaagde scan", general: "Algemeen", ready: "Gereed", unavailable: "Niet beschikbaar",
    outcomeSuccess: "Geslaagd", outcomeEmpty: "Geen vacatures waargenomen", outcomePartial: "Gedeeltelijk", outcomeFailed: "Mislukt", outcomeAwaiting: "Wacht op scan",
    fresh: "Actueel", stale: "Verouderd", noRecordedRun: "Geen uitvoering vastgelegd", noRecordedAttempt: "Geen poging vastgelegd", awaitingSuccessfulScrape: "Wacht op eerste geslaagde scan",
    noActiveSources: "Geen actieve geconfigureerde scanbronnen.", schedulerStarted: "Planning voor vacatureverkenning bijgewerkt", schedulerStopped: "Planning voor vacatureverkenning gestopt", discoveryRunStarted: "Vacatureverkenning voltooid",
    discoveryRunSkipped: "Er is al een vacatureverkenning actief op een andere app-instantie.", discoveryRunFailed: "De vacatureverkenning kon niet worden voltooid.", discoveryRunJoined: "De actieve vacatureverkenning is voltooid.",
    dedicatedAdapterLabel: "Bronspecifieke adapter", dedicatedAdapterDetail: "Gebruikt een bronspecifieke parser. De actuele brongezondheid bepaalt nog steeds de beschikbaarheid.",
    rssAdapterLabel: "Generieke RSS-adapter", rssAdapterDetail: "Gebruikt generieke RSS-extractie. Beoordeel brongezondheid en uitvoer voordat je op de dekking vertrouwt.",
    htmlAdapterLabel: "Generieke HTML-adapter", htmlAdapterDetail: "Gebruikt generieke HTML-extractie. Beoordeel brongezondheid en uitvoer voordat je op de dekking vertrouwt.",
    invalidInterval: "Kies een interval tussen 5 minuten en 24 uur.", invalidJobLimit: "Kies 10 tot 1.000 vacatures per uitvoering.", selectSource: "Selecteer ten minste een bron of gebruik alle actieve bronnen.",
  },
} as const satisfies Record<SupportedLocale, Record<string, string>>;

export type AdminOperatingCopyKey = keyof typeof staticCopy.en;

const summaryCopy: Record<SupportedLocale, Record<AdminOperatingSummary["presentationId"], SummaryCopy>> = {
  en: {
    critical_legal: { label: "Critical review", nextAction: "Review legal escalation items manually before any enforcement action." },
    critical_payments: { label: "Critical review", nextAction: "Review failed payment items and billing status before suspending accounts." },
    critical_verification: { label: "Critical review", nextAction: "Review grace-expired verification items before suspension or escalation." },
    attention_offer: { label: "Needs attention", nextAction: "Review offer attribution before success-fee billing is created." },
    attention_employment_ended: { label: "Needs attention", nextAction: "Review employment-ended reports before closing success-fee obligations." },
    attention_overdue: { label: "Needs attention", nextAction: "Work overdue verification and high-priority review items first." },
    watch: { label: "Review queue", nextAction: "Review pending employment verification and operating queue items." },
    clear: { label: "Operationally clear", nextAction: "No admin operating work is currently queued." },
  },
  nl: {
    critical_legal: { label: "Kritieke beoordeling", nextAction: "Beoordeel juridische escalaties handmatig voordat handhaving plaatsvindt." },
    critical_payments: { label: "Kritieke beoordeling", nextAction: "Beoordeel mislukte betalingen en de factureringsstatus voordat accounts worden opgeschort." },
    critical_verification: { label: "Kritieke beoordeling", nextAction: "Beoordeel verificaties waarvan de respijttermijn is verstreken voordat opschorting of escalatie plaatsvindt." },
    attention_offer: { label: "Aandacht vereist", nextAction: "Beoordeel de herkomst van aanbiedingen voordat facturering van succesvergoedingen wordt aangemaakt." },
    attention_employment_ended: { label: "Aandacht vereist", nextAction: "Beoordeel meldingen van beeindigd dienstverband voordat verplichtingen voor succesvergoedingen worden gesloten." },
    attention_overdue: { label: "Aandacht vereist", nextAction: "Behandel te late verificaties en beoordelingen met hoge prioriteit eerst." },
    watch: { label: "Beoordelingswachtrij", nextAction: "Beoordeel openstaande arbeidsverificaties en operationele wachtrijpunten." },
    clear: { label: "Operationeel vrij", nextAction: "Er staat momenteel geen operationeel beheerwerk in de wachtrij." },
  },
};

function plural(count: number, singular: string, pluralWord = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

const actionCopy: Record<SupportedLocale, Record<AdminOperatingControlActionId, (count: number) => ActionCopy>> = {
  en: {
    review_legal: (count) => ({ label: "Legal review", headline: `${plural(count, "legal escalation")} ${count === 1 ? "requires" : "require"} manual admin review.`, detail: "Open the review queue and inspect evidence, ToS acceptance, billing records, and prior admin decisions before any enforcement step.", cta: "Open legal review" }),
    review_failed_payments: (count) => ({ label: "Failed payments", headline: `${plural(count, "failed payment")} ${count === 1 ? "needs" : "need"} billing review.`, detail: "Review payment status and account history before changing access, billing state, or subscription records.", cta: "Open payments" }),
    review_grace_expired_verifications: (count) => ({ label: "Grace expired", headline: `${plural(count, "verification")} ${count === 1 ? "has" : "have"} passed the grace window.`, detail: "Review proof, reminders, and account context before suspension, escalation, or billing changes.", cta: "Open overdue" }),
    review_offer_attribution: (count) => ({ label: "Offer attribution", headline: `${plural(count, "offer")} ${count === 1 ? "needs" : "need"} attribution review before billing.`, detail: "Confirm whether each offer came from Hire.AI activity before any success-fee subscription or invoice is created.", cta: "Open offer reviews" }),
    review_employment_ended: (count) => ({ label: "Employment ended", headline: `${plural(count, "employment-end report")} ${count === 1 ? "needs" : "need"} final review.`, detail: "Confirm final billing period, subscription cancellation, verification history, and audit evidence before closing the success-fee obligation.", cta: "Open end reports" }),
    review_overdue_verifications: (count) => ({ label: "Overdue verification", headline: `${plural(count, "verification")} ${count === 1 ? "is" : "are"} overdue.`, detail: "Work overdue employment checks first and keep account actions auditable.", cta: "Open overdue" }),
    review_pending_verifications: (count) => ({ label: "Verification queue", headline: `${plural(count, "verification")} ${count === 1 ? "awaits" : "await"} review.`, detail: "Approve or reject submitted employment proof from the verification queue.", cta: "Open verifications" }),
    open_review_queue: (count) => ({ label: "Review queue", headline: `${plural(count, "admin item")} ${count === 1 ? "is" : "are"} waiting.`, detail: "Clear admin-visible operating items before making more consequential changes.", cta: "Open review queue" }),
    monitor: () => ({ label: "Monitoring", headline: "No admin intervention is currently queued.", detail: "Keep monitoring success-fee revenue, verification cadence, review items, and failed payments.", cta: "View overview" }),
  },
  nl: {
    review_legal: (count) => ({ label: "Juridische beoordeling", headline: `${plural(count, "juridische escalatie", "juridische escalaties")} ${count === 1 ? "vereist" : "vereisen"} handmatige beoordeling door beheer.`, detail: "Open de beoordelingswachtrij en controleer bewijs, acceptatie van voorwaarden, factureringsgegevens en eerdere beheerbesluiten voordat handhaving plaatsvindt.", cta: "Juridische beoordeling openen" }),
    review_failed_payments: (count) => ({ label: "Mislukte betalingen", headline: `${plural(count, "mislukte betaling", "mislukte betalingen")} ${count === 1 ? "vereist" : "vereisen"} factureringsbeoordeling.`, detail: "Beoordeel de betalingsstatus en accountgeschiedenis voordat toegang, factureringsstatus of abonnementsgegevens worden gewijzigd.", cta: "Betalingen openen" }),
    review_grace_expired_verifications: (count) => ({ label: "Respijttermijn verstreken", headline: `${plural(count, "verificatie", "verificaties")} ${count === 1 ? "heeft" : "hebben"} de respijttermijn overschreden.`, detail: "Beoordeel bewijs, herinneringen en accountcontext voordat opschorting, escalatie of factureringswijzigingen plaatsvinden.", cta: "Te late punten openen" }),
    review_offer_attribution: (count) => ({ label: "Herkomst aanbieding", headline: `${plural(count, "aanbieding", "aanbiedingen")} ${count === 1 ? "vereist" : "vereisen"} herkomstbeoordeling voor facturering.`, detail: "Bevestig of elke aanbieding uit Hire.AI-activiteit voortkomt voordat een abonnement of factuur voor een succesvergoeding wordt aangemaakt.", cta: "Aanbiedingen openen" }),
    review_employment_ended: (count) => ({ label: "Dienstverband beeindigd", headline: `${plural(count, "eindmelding", "eindmeldingen")} ${count === 1 ? "vereist" : "vereisen"} eindbeoordeling.`, detail: "Bevestig de laatste factureringsperiode, abonnementsbeeindiging, verificatiegeschiedenis en auditbewijs voordat de verplichting wordt gesloten.", cta: "Eindmeldingen openen" }),
    review_overdue_verifications: (count) => ({ label: "Te late verificatie", headline: `${plural(count, "verificatie", "verificaties")} ${count === 1 ? "is" : "zijn"} te laat.`, detail: "Behandel te late arbeidscontroles eerst en houd accountacties controleerbaar.", cta: "Te late punten openen" }),
    review_pending_verifications: (count) => ({ label: "Verificatiewachtrij", headline: `${plural(count, "verificatie", "verificaties")} ${count === 1 ? "wacht" : "wachten"} op beoordeling.`, detail: "Keur ingediend arbeidsbewijs goed of af vanuit de verificatiewachtrij.", cta: "Verificaties openen" }),
    open_review_queue: (count) => ({ label: "Beoordelingswachtrij", headline: `${plural(count, "beheerpunt", "beheerpunten")} ${count === 1 ? "wacht" : "wachten"}.`, detail: "Rond zichtbare beheerpunten af voordat ingrijpendere wijzigingen worden aangebracht.", cta: "Wachtrij openen" }),
    monitor: () => ({ label: "Bewaking", headline: "Er staat momenteel geen beheerinterventie in de wachtrij.", detail: "Blijf succesvergoedingen, verificatiecadans, beoordelingspunten en mislukte betalingen bewaken.", cta: "Overzicht bekijken" }),
  },
};

export function getAdminOperatingSummaryCopy(locale: SupportedLocale, summary: AdminOperatingSummary): SummaryCopy {
  return summaryCopy[locale][summary.presentationId];
}

export function getAdminOperatingActionCopy(locale: SupportedLocale, action: AdminOperatingControlAction): ActionCopy {
  return actionCopy[locale][action.id](action.count);
}

export function getAdminOperatingCopy(locale: SupportedLocale, key: AdminOperatingCopyKey): string {
  return staticCopy[locale][key];
}

export function formatAdminOperatingCopy(
  locale: SupportedLocale,
  key: AdminOperatingCopyKey,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    getAdminOperatingCopy(locale, key),
  );
}
