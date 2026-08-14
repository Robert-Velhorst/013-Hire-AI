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
