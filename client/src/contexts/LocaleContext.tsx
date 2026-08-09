import { useAuth } from "@/_core/hooks/useAuth";
import { DEFAULT_LOCALE, resolveSupportedLocale, type SupportedLocale } from "@shared/localization";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "hire-ai-locale";

const translations = {
  en: {
    loading: "Loading Hire.AI...", dashboard: "Dashboard", findJobs: "Find Jobs",
    applications: "Applications", reviewQueue: "Review Queue", savedJobs: "Saved Jobs",
    alerts: "Alerts", profile: "Profile", aiPreferences: "AI Preferences", menu: "Menu",
    team: "Team",
    toggleNavigation: "Toggle navigation", signInTitle: "Sign in to continue",
    signInDescription: "Access to this dashboard requires authentication. Continue to launch the login flow.",
    signIn: "Sign in", signOut: "Sign out", language: "Language",
    languageDescription: "Choose the language used for Hire.AI navigation and account controls.",
    languageSaved: "Language saved", languageSaveFailed: "Unable to save the language preference",
    pageNotFound: "Page not found", pageNotFoundDescription: "Sorry, the page you are looking for does not exist. It may have been moved or deleted.",
    goHome: "Go home",
    savedJobsTitle: "Saved jobs", savedJobsDescription: "Jobs you have bookmarked for later", viewDashboard: "View dashboard",
    savedJobRemoved: "Job removed from saved jobs", savedJobRemoveFailed: "Unable to remove the saved job",
    resolveProfileEvidence: "Resolve profile evidence before preparing an application.",
    reviewDecisionUpdated: "Review decision updated", applicationQueued: "Application queued for review",
    applicationDecisionFailed: "Unable to record the application decision", loginToQueueReview: "Sign in to queue an application review",
    today: "Today", yesterday: "Yesterday", daysAgo: "{count} days ago", weeksAgo: "{count} weeks ago",
    moreSkills: "+{count} more", savedOn: "Saved {date}", queueControlledReview: "Queue a controlled application review",
    resolveEvidence: "Resolve evidence", queueReview: "Queue review", viewJob: "View job", remove: "Remove",
    noSavedJobs: "No saved jobs yet", noSavedJobsDescription: "Browse jobs and use the bookmark button to save them for later. Saved jobs will appear here.",
    completeProfile: "Complete profile",
    jobAlertsTitle: "Job alerts", jobAlertsDescription: "Track matching jobs in your command center with precise, saved criteria.",
    createAlert: "Create alert", createJobAlert: "Create job alert", createAlertDescription: "Define the criteria used to refresh this matching rule.",
    matchingRuleCreated: "Matching rule created", createAlertFailed: "Unable to create the alert", alertDeleted: "Alert deleted",
    deleteAlertFailed: "Unable to delete the alert", alertUpdated: "Alert updated", updateAlertFailed: "Unable to update the alert",
    requiredFields: "Enter the alert name and keywords", deleteAlertConfirm: "Are you sure you want to delete this alert?",
    alertName: "Alert name *", alertNamePlaceholder: "e.g. Senior React Developer", keywords: "Keywords *",
    keywordsPlaceholder: "e.g. React, TypeScript, Node.js", commaSeparatedKeywords: "Separate multiple keywords with commas",
    optionalLocation: "Location (optional)", locationPlaceholder: "e.g. Remote, US, Europe", optionalSources: "Sources (optional)",
    sourcesPlaceholder: "e.g. Remote OK, We Work Remotely", commaSeparatedSources: "Separate source names or IDs with commas",
    optionalMinimumSalary: "Minimum salary (optional)", minimumSalaryPlaceholder: "e.g. 100000", jobTypes: "Job types",
    fullTime: "Full-time", partTime: "Part-time", contract: "Contract", temporary: "Temporary",
    matchingCadence: "Matching cadence", hourly: "Hourly", daily: "Daily", weekly: "Weekly", cancel: "Cancel",
    active: "Active", paused: "Paused", lastMatched: "Last matched: {date}", toggleAlert: "{action} alert {name}",
    pause: "Pause", activate: "Activate", deleteAlert: "Delete alert {name}", noJobAlerts: "No job alerts yet",
    noJobAlertsDescription: "Create a matching rule to keep relevant jobs available in your command center.",
    createFirstAlert: "Create your first alert", alertTips: "Tips for useful job alerts",
    alertTipSpecific: "Use specific keywords to get more relevant matches.",
    alertTipMultiple: "Create separate alerts for different job types or locations.",
    alertTipCadence: "Use hourly matching for competitive roles you want to review early.",
    alertTipReview: "Review and update your alerts as your preferences change.",
    hireAiHome: "Hire.AI home", openAccountMenu: "Open account menu", settings: "Settings",
    loggedOut: "Signed out successfully", userFallback: "User",
    teamAccess: "Team access", teamAccessDescription: "Manage workspace membership and governance roles.",
    activeWorkspace: "Active workspace", selectWorkspace: "Select workspace", newWorkspace: "New workspace",
    workspaceName: "Workspace name", create: "Create", invitationCode: "Invitation code", pasteInvitationCode: "Paste invitation code", join: "Join",
    workspaceCreated: "Workspace created", invitationAlreadyAccepted: "Invitation was already accepted", workspaceJoined: "Workspace joined",
    invitationCreated: "Invitation created", workspaceRenamed: "Workspace renamed", invitationRevoked: "Invitation revoked",
    memberRoleUpdated: "Member role updated", leftWorkspace: "You left the workspace", memberRemoved: "Member removed",
    ownershipTransferred: "Ownership transferred", workspaceArchived: "Workspace archived",
    candidateDataPrivate: "Candidate data remains private",
    candidateDataPrivateDescription: "Membership controls team governance only. Profiles, resumes, applications, messages, and billing records remain owner-scoped.",
    rename: "Rename", inviteMember: "Invite member", inviteEmail: "Invite email", invitationRole: "Invitation role", invite: "Invite",
    memberRole: "Member", adminRole: "Admin", ownerRole: "Owner", oneTimeCodeFor: "One-time code for {email}",
    copyInvitationCode: "Copy invitation code", invitationCodeCopied: "Invitation code copied", invitationCodeCopyFailed: "Unable to copy the invitation code",
    members: "Members", userNumber: "User {id}", noEmail: "No email", roleFor: "Role for {name}", transferOwnership: "Transfer ownership",
    transferOwnershipTitle: "Transfer workspace ownership?", transferOwnershipDescription: "You will become an admin. Only the new owner can reverse this change.", transfer: "Transfer",
    leaveWorkspace: "Leave workspace", removeMember: "Remove member", leaveWorkspaceTitle: "Leave this workspace?", removeMemberTitle: "Remove this workspace member?",
    workspaceAccessEnds: "Candidate data remains private and unchanged. Workspace access ends immediately.", leave: "Leave",
    pendingInvitations: "Pending invitations", invitationExpires: "{role} - expires {date}", revoke: "Revoke",
    archiveWorkspace: "Archive workspace", archiveWorkspaceRequirement: "All other active members must be removed first.", archive: "Archive",
    archiveWorkspaceTitle: "Archive this workspace?", archiveWorkspaceDescription: "Pending invitations will be revoked and the workspace will disappear from active team access.",
    workspaceEmpty: "Create a workspace or enter an invitation code.",
  },
  nl: {
    loading: "Hire.AI laden...", dashboard: "Overzicht", findJobs: "Vacatures zoeken",
    applications: "Sollicitaties", reviewQueue: "Beoordelingswachtrij", savedJobs: "Opgeslagen vacatures",
    alerts: "Meldingen", profile: "Profiel", aiPreferences: "AI-voorkeuren", menu: "Menu",
    team: "Team",
    toggleNavigation: "Navigatie in- of uitklappen", signInTitle: "Log in om door te gaan",
    signInDescription: "Voor dit overzicht moet je ingelogd zijn. Ga verder om het inlogproces te starten.",
    signIn: "Inloggen", signOut: "Uitloggen", language: "Taal",
    languageDescription: "Kies de taal voor de navigatie en accountbediening van Hire.AI.",
    languageSaved: "Taal opgeslagen", languageSaveFailed: "De taalvoorkeur kon niet worden opgeslagen",
    pageNotFound: "Pagina niet gevonden", pageNotFoundDescription: "De pagina die je zoekt bestaat niet. Deze kan zijn verplaatst of verwijderd.",
    goHome: "Naar startpagina",
    savedJobsTitle: "Opgeslagen vacatures", savedJobsDescription: "Vacatures die je voor later hebt opgeslagen", viewDashboard: "Overzicht bekijken",
    savedJobRemoved: "Vacature verwijderd uit opgeslagen vacatures", savedJobRemoveFailed: "De opgeslagen vacature kon niet worden verwijderd",
    resolveProfileEvidence: "Vul ontbrekende profielgegevens aan voordat je een sollicitatie voorbereidt.",
    reviewDecisionUpdated: "Beoordelingsbesluit bijgewerkt", applicationQueued: "Sollicitatie klaargezet voor beoordeling",
    applicationDecisionFailed: "Het sollicitatiebesluit kon niet worden vastgelegd", loginToQueueReview: "Log in om een sollicitatiebeoordeling klaar te zetten",
    today: "Vandaag", yesterday: "Gisteren", daysAgo: "{count} dagen geleden", weeksAgo: "{count} weken geleden",
    moreSkills: "+{count} meer", savedOn: "Opgeslagen {date}", queueControlledReview: "Zet een gecontroleerde sollicitatiebeoordeling klaar",
    resolveEvidence: "Gegevens aanvullen", queueReview: "Beoordeling klaarzetten", viewJob: "Vacature bekijken", remove: "Verwijderen",
    noSavedJobs: "Nog geen opgeslagen vacatures", noSavedJobsDescription: "Bekijk vacatures en gebruik de bladwijzerknop om ze voor later op te slaan. Ze verschijnen daarna hier.",
    completeProfile: "Profiel voltooien",
    jobAlertsTitle: "Vacaturemeldingen", jobAlertsDescription: "Volg passende vacatures in je overzicht met nauwkeurige, opgeslagen criteria.",
    createAlert: "Melding maken", createJobAlert: "Vacaturemelding maken", createAlertDescription: "Bepaal de criteria waarmee deze zoekregel wordt bijgewerkt.",
    matchingRuleCreated: "Zoekregel gemaakt", createAlertFailed: "De melding kon niet worden gemaakt", alertDeleted: "Melding verwijderd",
    deleteAlertFailed: "De melding kon niet worden verwijderd", alertUpdated: "Melding bijgewerkt", updateAlertFailed: "De melding kon niet worden bijgewerkt",
    requiredFields: "Vul de naam en trefwoorden van de melding in", deleteAlertConfirm: "Weet je zeker dat je deze melding wilt verwijderen?",
    alertName: "Naam melding *", alertNamePlaceholder: "bijv. Senior React-ontwikkelaar", keywords: "Trefwoorden *",
    keywordsPlaceholder: "bijv. React, TypeScript, Node.js", commaSeparatedKeywords: "Scheid meerdere trefwoorden met komma's",
    optionalLocation: "Locatie (optioneel)", locationPlaceholder: "bijv. Op afstand, Nederland, Europa", optionalSources: "Bronnen (optioneel)",
    sourcesPlaceholder: "bijv. Remote OK, We Work Remotely", commaSeparatedSources: "Scheid bronnamen of ID's met komma's",
    optionalMinimumSalary: "Minimumsalaris (optioneel)", minimumSalaryPlaceholder: "bijv. 100000", jobTypes: "Dienstverbanden",
    fullTime: "Fulltime", partTime: "Parttime", contract: "Contract", temporary: "Tijdelijk",
    matchingCadence: "Zoekfrequentie", hourly: "Elk uur", daily: "Dagelijks", weekly: "Wekelijks", cancel: "Annuleren",
    active: "Actief", paused: "Gepauzeerd", lastMatched: "Laatst gevonden: {date}", toggleAlert: "Melding {name} {action}",
    pause: "pauzeren", activate: "activeren", deleteAlert: "Melding {name} verwijderen", noJobAlerts: "Nog geen vacaturemeldingen",
    noJobAlertsDescription: "Maak een zoekregel om relevante vacatures beschikbaar te houden in je overzicht.",
    createFirstAlert: "Eerste melding maken", alertTips: "Tips voor nuttige vacaturemeldingen",
    alertTipSpecific: "Gebruik specifieke trefwoorden voor relevantere resultaten.",
    alertTipMultiple: "Maak aparte meldingen voor verschillende dienstverbanden of locaties.",
    alertTipCadence: "Gebruik zoeken per uur voor populaire functies die je vroeg wilt beoordelen.",
    alertTipReview: "Bekijk en wijzig je meldingen wanneer je voorkeuren veranderen.",
    hireAiHome: "Hire.AI-startpagina", openAccountMenu: "Accountmenu openen", settings: "Instellingen",
    loggedOut: "Succesvol uitgelogd", userFallback: "Gebruiker",
    teamAccess: "Teamtoegang", teamAccessDescription: "Beheer werkruimteleden en beheerdersrollen.",
    activeWorkspace: "Actieve werkruimte", selectWorkspace: "Werkruimte selecteren", newWorkspace: "Nieuwe werkruimte",
    workspaceName: "Naam werkruimte", create: "Maken", invitationCode: "Uitnodigingscode", pasteInvitationCode: "Plak de uitnodigingscode", join: "Deelnemen",
    workspaceCreated: "Werkruimte gemaakt", invitationAlreadyAccepted: "Uitnodiging was al geaccepteerd", workspaceJoined: "Toegetreden tot werkruimte",
    invitationCreated: "Uitnodiging gemaakt", workspaceRenamed: "Werkruimte hernoemd", invitationRevoked: "Uitnodiging ingetrokken",
    memberRoleUpdated: "Rol van lid bijgewerkt", leftWorkspace: "Je hebt de werkruimte verlaten", memberRemoved: "Lid verwijderd",
    ownershipTransferred: "Eigendom overgedragen", workspaceArchived: "Werkruimte gearchiveerd",
    candidateDataPrivate: "Kandidaatgegevens blijven prive",
    candidateDataPrivateDescription: "Lidmaatschap regelt alleen het beheer van het team. Profielen, cv's, sollicitaties, berichten en factuurgegevens blijven alleen toegankelijk voor de eigenaar.",
    rename: "Hernoemen", inviteMember: "Lid uitnodigen", inviteEmail: "E-mailadres voor uitnodiging", invitationRole: "Rol bij uitnodiging", invite: "Uitnodigen",
    memberRole: "Lid", adminRole: "Beheerder", ownerRole: "Eigenaar", oneTimeCodeFor: "Eenmalige code voor {email}",
    copyInvitationCode: "Uitnodigingscode kopieren", invitationCodeCopied: "Uitnodigingscode gekopieerd", invitationCodeCopyFailed: "De uitnodigingscode kon niet worden gekopieerd",
    members: "Leden", userNumber: "Gebruiker {id}", noEmail: "Geen e-mailadres", roleFor: "Rol van {name}", transferOwnership: "Eigendom overdragen",
    transferOwnershipTitle: "Eigendom van werkruimte overdragen?", transferOwnershipDescription: "Je wordt beheerder. Alleen de nieuwe eigenaar kan deze wijziging terugdraaien.", transfer: "Overdragen",
    leaveWorkspace: "Werkruimte verlaten", removeMember: "Lid verwijderen", leaveWorkspaceTitle: "Deze werkruimte verlaten?", removeMemberTitle: "Dit lid uit de werkruimte verwijderen?",
    workspaceAccessEnds: "Kandidaatgegevens blijven prive en ongewijzigd. De toegang tot de werkruimte stopt direct.", leave: "Verlaten",
    pendingInvitations: "Openstaande uitnodigingen", invitationExpires: "{role} - verloopt {date}", revoke: "Intrekken",
    archiveWorkspace: "Werkruimte archiveren", archiveWorkspaceRequirement: "Alle andere actieve leden moeten eerst worden verwijderd.", archive: "Archiveren",
    archiveWorkspaceTitle: "Deze werkruimte archiveren?", archiveWorkspaceDescription: "Openstaande uitnodigingen worden ingetrokken en de werkruimte verdwijnt uit de actieve teamtoegang.",
    workspaceEmpty: "Maak een werkruimte of voer een uitnodigingscode in.",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function initialLocale() {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    return resolveSupportedLocale(localStorage.getItem(STORAGE_KEY) || navigator.language);
  } catch {
    return resolveSupportedLocale(navigator.language);
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);

  useEffect(() => {
    if (user?.locale) setLocale(resolveSupportedLocale(user.locale));
  }, [user?.locale]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // The account-backed preference remains authoritative when browser storage is unavailable.
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => translate(locale, key, values),
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function translate(
  locale: SupportedLocale,
  key: TranslationKey,
  values: Record<string, string | number> = {},
) {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    translations[locale][key] as string,
  );
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}
