export type ProfileEvidenceProviderId =
  | "resume"
  | "linkedin"
  | "github"
  | "portfolio"
  | "gmail"
  | "google_drive"
  | "dropbox"
  | "outlook";

export type ProfileEvidenceProviderStatus =
  | "connected"
  | "missing"
  | "consent_required";

export type ProfileConnectorAccountStatus =
  | "not_connected"
  | "connection_requested"
  | "connected"
  | "needs_reauth"
  | "disabled";

export type ProfileEvidenceControlStatus =
  | "blocked"
  | "limited"
  | "ready";

export type ProfileEvidenceControlSection =
  | "import"
  | "social"
  | "preferences"
  | "work-experience"
  | "skills";

const MAILBOX_SEND_CONSENT: Partial<Record<ProfileEvidenceProviderId, string>> = {
  gmail: "email.messages.send",
  outlook: "mail.messages.send",
};

const CALENDAR_WRITE_CONSENT: Partial<Record<ProfileEvidenceProviderId, string>> = {
  gmail: "calendar.events.write",
  outlook: "calendar.events.write",
};

export function getMailboxSendConsentScope(provider: ProfileEvidenceProviderId) {
  return MAILBOX_SEND_CONSENT[provider] ?? null;
}

export function needsMailboxSendConsent(provider: Pick<ProfileEvidenceProvider, "id" | "connectionStatus" | "consentScopes">) {
  const sendScope = getMailboxSendConsentScope(provider.id);
  return provider.connectionStatus === "connected" && sendScope !== null && !provider.consentScopes?.includes(sendScope);
}

export function getCalendarWriteConsentScope(provider: ProfileEvidenceProviderId) {
  return CALENDAR_WRITE_CONSENT[provider] ?? null;
}

export function needsCalendarWriteConsent(provider: Pick<ProfileEvidenceProvider, "id" | "connectionStatus" | "consentScopes">) {
  const calendarScope = getCalendarWriteConsentScope(provider.id);
  return provider.connectionStatus === "connected" && calendarScope !== null && !provider.consentScopes?.includes(calendarScope);
}

export const CONNECTOR_VERIFICATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function isConnectorAuthorizationStale(
  lastVerifiedAt: Date | string | null | undefined,
  now = new Date()
): boolean {
  // A connected account without a verification timestamp has no evidence that
  // its consent is current. Treat legacy records as needing reauthorization.
  if (!lastVerifiedAt) return true;
  const verifiedAt = new Date(lastVerifiedAt).getTime();
  return !Number.isFinite(verifiedAt) || now.getTime() - verifiedAt > CONNECTOR_VERIFICATION_MAX_AGE_MS;
}

export interface ProfileEvidenceProvider {
  id: ProfileEvidenceProviderId;
  label: string;
  category: "document" | "professional_profile" | "inbox" | "cloud_storage";
  status: ProfileEvidenceProviderStatus;
  connectionStatus?: ProfileConnectorAccountStatus;
  /** A connector exists but lacks the minimum consent needed for this evidence use. */
  authorizationIncomplete?: boolean;
  /** The authorization was connected but has not been verified recently enough for external evidence use. */
  authorizationStale?: boolean;
  accountLabel?: string | null;
  consentScopes?: string[];
  detail: string;
  section: ProfileEvidenceControlSection;
}

export interface ProfileEvidenceControlInput {
  profile?: {
    resumeUrl?: string | null;
    resumeFileKey?: string | null;
    linkedinUrl?: string | null;
    githubUrl?: string | null;
    portfolioUrl?: string | null;
  } | null;
  readiness?: {
    score?: number | null;
    autoApplyEligible?: boolean | null;
    blockers?: unknown[] | null;
    warnings?: unknown[] | null;
  } | null;
  /** Authoritative active-resume state from the versioned resume ledger. */
  hasActiveResumeArtifact?: boolean;
  connectorAccounts?: Array<{
    provider: ProfileEvidenceProviderId;
    status: ProfileConnectorAccountStatus;
    externalAccountLabel?: string | null;
    consentScopes?: string[] | string | null;
    lastVerifiedAt?: Date | string | null;
  }> | null;
}

export interface ProfileEvidenceControlSummary {
  status: ProfileEvidenceControlStatus;
  label: string;
  headline: string;
  detail: string;
  cta: string;
  primarySection: ProfileEvidenceControlSection;
  score: number;
  connectedCount: number;
  missingCount: number;
  consentRequiredCount: number;
  autoApplyEligible: boolean;
  externalAccessGated: boolean;
  providers: ProfileEvidenceProvider[];
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function clampScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : 0;
}

function parseScopes(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((scope) => scope.trim()).filter(Boolean);
  }
  if (typeof value !== "string" || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((scope) => String(scope).trim()).filter(Boolean);
    }
  } catch {
    // Fall through to comma-separated legacy data.
  }
  return String(value)
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function connectorForProvider(
  accounts: ProfileEvidenceControlInput["connectorAccounts"],
  providerId: ProfileEvidenceProviderId
) {
  return accounts?.find((account) => account.provider === providerId);
}

function externalProviderState(
  accounts: ProfileEvidenceControlInput["connectorAccounts"],
  providerId: ProfileEvidenceProviderId,
  requiredScope: string,
  connectedDetail: string,
  requestedDetail: string,
  defaultDetail: string,
  needsReauthDetail: string,
  missingScopeDetail: string
) {
  const connector = connectorForProvider(accounts, providerId);
  const scopes = parseScopes(connector?.consentScopes);

  if (connector?.status === "connected" && isConnectorAuthorizationStale(connector.lastVerifiedAt)) {
    return {
      status: "consent_required" as const,
      connectionStatus: "needs_reauth" as const,
      authorizationIncomplete: true,
      authorizationStale: true,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: needsReauthDetail,
    };
  }

  if (connector?.status === "connected" && scopes.includes(requiredScope)) {
    return {
      status: "connected" as const,
      connectionStatus: connector.status,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: connectedDetail,
    };
  }

  if (connector?.status === "connected") {
    return {
      status: "consent_required" as const,
      connectionStatus: connector.status,
      authorizationIncomplete: true,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: missingScopeDetail,
    };
  }

  if (connector?.status === "connection_requested") {
    return {
      status: "consent_required" as const,
      connectionStatus: connector.status,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: requestedDetail,
    };
  }

  if (connector?.status === "needs_reauth") {
    return {
      status: "consent_required" as const,
      connectionStatus: connector.status,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: needsReauthDetail,
    };
  }

  return {
    status: "consent_required" as const,
    connectionStatus: connector?.status ?? "not_connected",
    accountLabel: connector?.externalAccountLabel || null,
    consentScopes: scopes,
    detail: defaultDetail,
  };
}

function professionalProviderState(
  accounts: ProfileEvidenceControlInput["connectorAccounts"],
  providerId: ProfileEvidenceProviderId,
  requiredScope: string,
  hasSavedUrl: boolean,
  connectedDetail: string,
  requestedDetail: string,
  missingDetail: string,
  needsReauthDetail: string,
  missingScopeDetail: string,
  identityOnlyDetail?: string
) {
  const connector = connectorForProvider(accounts, providerId);
  const scopes = parseScopes(connector?.consentScopes);

  if (!hasSavedUrl && connector?.status === "connected" && isConnectorAuthorizationStale(connector.lastVerifiedAt)) {
    return {
      status: "consent_required" as const,
      connectionStatus: "needs_reauth" as const,
      authorizationIncomplete: true,
      authorizationStale: true,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: needsReauthDetail,
    };
  }

  if (hasSavedUrl) {
    return {
      status: "connected" as const,
      connectionStatus: connector?.status ?? (hasSavedUrl ? "connected" as const : undefined),
      accountLabel: connector?.externalAccountLabel || null,
      consentScopes: scopes,
      detail: connectedDetail,
    };
  }

  if (connector?.status === "connected" && scopes.includes(requiredScope)) {
    if (identityOnlyDetail) {
      return {
        status: "missing" as const,
        connectionStatus: connector.status,
        accountLabel: connector.externalAccountLabel || null,
        consentScopes: scopes,
        detail: identityOnlyDetail,
      };
    }
    return {
      status: "connected" as const,
      connectionStatus: connector.status,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: connectedDetail,
    };
  }

  if (connector?.status === "connected") {
    return {
      status: "consent_required" as const,
      connectionStatus: connector.status,
      authorizationIncomplete: true,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: missingScopeDetail,
    };
  }

  if (connector?.status === "connection_requested") {
    return {
      status: "consent_required" as const,
      connectionStatus: connector.status,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: requestedDetail,
    };
  }

  if (connector?.status === "needs_reauth") {
    return {
      status: "consent_required" as const,
      connectionStatus: connector.status,
      accountLabel: connector.externalAccountLabel || null,
      consentScopes: scopes,
      detail: needsReauthDetail,
    };
  }

  return {
    status: "missing" as const,
    connectionStatus: connector?.status ?? "not_connected",
    accountLabel: connector?.externalAccountLabel || null,
    consentScopes: scopes,
    detail: missingDetail,
  };
}

export function getProfileEvidenceControlSummary(
  input: ProfileEvidenceControlInput = {}
): ProfileEvidenceControlSummary {
  const profile = input.profile;
  const hasVersionedResume = input.hasActiveResumeArtifact ?? (
    hasText(profile?.resumeUrl) && hasText(profile?.resumeFileKey)
  );
  const score = clampScore(input.readiness?.score);
  const blockerCount = input.readiness?.blockers?.length ?? 0;
  const autoApplyEligible = input.readiness?.autoApplyEligible === true;
  const linkedIn = professionalProviderState(
    input.connectorAccounts,
    "linkedin",
    "profile.basic.read",
    hasText(profile?.linkedinUrl),
    "LinkedIn evidence is available for professional profile checks.",
    "LinkedIn connection request is recorded; OAuth authorization or a saved profile URL is still required before Hire.AI can import profile evidence.",
    "Add LinkedIn to strengthen claims and recruiter-facing context.",
    "LinkedIn authorization needs renewal before Hire.AI can import professional profile evidence.",
    "LinkedIn is connected, but profile-read consent is incomplete before Hire.AI can import professional profile evidence.",
    "LinkedIn account identity is connected, but it does not provide career evidence. Add a LinkedIn URL or reviewed profile text before Hire.AI uses it for claims."
  );
  const github = professionalProviderState(
    input.connectorAccounts,
    "github",
    "profile.basic.read",
    hasText(profile?.githubUrl),
    "GitHub evidence is available for project and skills validation.",
    "GitHub connection request is recorded; OAuth authorization or a saved profile URL is still required before Hire.AI can import project evidence.",
    "Add GitHub when technical project evidence matters for target roles.",
    "GitHub authorization needs renewal before Hire.AI can import project evidence.",
    "GitHub is connected, but profile-read consent is incomplete before Hire.AI can import project evidence."
  );
  const portfolio = professionalProviderState(
    input.connectorAccounts,
    "portfolio",
    "profile.url.verify",
    hasText(profile?.portfolioUrl),
    "Portfolio evidence is available for work samples.",
    "Portfolio verification request is recorded; a saved URL or explicit verification is still required before Hire.AI can use work-sample evidence.",
    "Add a portfolio when work samples can support applications.",
    "Portfolio verification needs renewal before Hire.AI can use work-sample evidence.",
    "Portfolio is connected, but URL-verification consent is incomplete before Hire.AI can use work-sample evidence."
  );
  const gmail = externalProviderState(
    input.connectorAccounts,
    "gmail",
    "email.messages.read_recruiting",
    "Gmail is authorized for employer reply monitoring.",
    "Gmail connection request is recorded; OAuth authorization is still required before Hire.AI can read replies.",
    "Needs explicit account connection before Hire.AI can detect employer replies.",
    "Gmail authorization needs renewal before Hire.AI can monitor replies.",
    "Gmail is connected, but recruiting-message read consent is incomplete before Hire.AI can monitor replies."
  );
  const googleDrive = externalProviderState(
    input.connectorAccounts,
    "google_drive",
    "files.content.read_resume_candidates",
    "Google Drive is authorized for resume document discovery.",
    "Google Drive connection request is recorded; OAuth authorization is still required before document discovery.",
    "Needs explicit account connection before Hire.AI can discover resume documents.",
    "Google Drive authorization needs renewal before document discovery can continue.",
    "Google Drive is connected, but resume-document read consent is incomplete before Hire.AI can discover documents."
  );
  const dropbox = externalProviderState(
    input.connectorAccounts,
    "dropbox",
    "files.content.read_resume_candidates",
    "Dropbox is authorized for resume document discovery.",
    "Dropbox connection request is recorded; OAuth authorization is still required before document discovery.",
    "Needs explicit account connection before Hire.AI can discover stored resumes.",
    "Dropbox authorization needs renewal before document discovery can continue.",
    "Dropbox is connected, but resume-document read consent is incomplete before Hire.AI can discover documents."
  );
  const outlook = externalProviderState(
    input.connectorAccounts,
    "outlook",
    "mail.messages.read_recruiting",
    "Outlook is authorized for employer reply monitoring.",
    "Outlook connection request is recorded; OAuth authorization is still required before Hire.AI can read replies.",
    "Needs explicit account connection before Hire.AI can detect employer replies.",
    "Outlook authorization needs renewal before Hire.AI can monitor replies.",
    "Outlook is connected, but recruiting-message read consent is incomplete before Hire.AI can monitor replies."
  );

  const providers: ProfileEvidenceProvider[] = [
    {
      id: "resume",
      label: "Resume",
      category: "document",
      status: hasVersionedResume ? "connected" : "missing",
      detail: hasVersionedResume
        ? "An active versioned resume is linked for matching and application material preparation."
        : "Upload and select a versioned resume before Hire.AI prepares applications.",
      section: "import",
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      category: "professional_profile",
      ...linkedIn,
      section: "social",
    },
    {
      id: "github",
      label: "GitHub",
      category: "professional_profile",
      ...github,
      section: "social",
    },
    {
      id: "portfolio",
      label: "Portfolio",
      category: "professional_profile",
      ...portfolio,
      section: "social",
    },
    {
      id: "gmail",
      label: "Gmail",
      category: "inbox",
      ...gmail,
      section: "import",
    },
    {
      id: "google_drive",
      label: "Google Drive",
      category: "cloud_storage",
      ...googleDrive,
      section: "import",
    },
    {
      id: "dropbox",
      label: "Dropbox",
      category: "cloud_storage",
      ...dropbox,
      section: "import",
    },
    {
      id: "outlook",
      label: "Outlook",
      category: "inbox",
      ...outlook,
      section: "import",
    },
  ];

  const connectedCount = providers.filter((provider) => provider.status === "connected").length;
  const missingCount = providers.filter((provider) => provider.status === "missing").length;
  const consentRequiredCount = providers.filter((provider) => provider.status === "consent_required").length;

  const blockerKeys = input.readiness?.blockers
    ?.map((blocker) => typeof blocker === "object" && blocker !== null && "key" in blocker
      ? String((blocker as { key?: unknown }).key || "")
      : "")
    .filter(Boolean) ?? [];
  const primarySection: ProfileEvidenceControlSection = providers[0].status !== "connected"
    ? "import"
    : blockerKeys.includes("skills")
      ? "skills"
      : blockerKeys.includes("experience")
        ? "work-experience"
        : blockerKeys.includes("target_roles") || blockerKeys.includes("locations") || blockerKeys.includes("salary")
          ? "preferences"
          : "import";

  if (blockerCount > 0 || providers[0].status !== "connected") {
    return {
      status: "blocked",
      label: "Evidence blocked",
      headline: "Profile evidence is not ready for autonomous preparation.",
      detail: "Add the core resume, skills, and experience evidence before any external application workflow can advance.",
      cta: "Fix profile evidence",
      primarySection,
      score,
      connectedCount,
      missingCount,
      consentRequiredCount,
      autoApplyEligible,
      externalAccessGated: true,
      providers,
    };
  }

  if (consentRequiredCount > 0 || missingCount > 0 || !autoApplyEligible) {
    return {
      status: "limited",
      label: "Evidence limited",
      headline: "Core profile evidence exists, but external sources still need consent or completion.",
      detail: "Hire.AI can reason from saved profile data, but inbox, cloud document discovery, and some professional proof remain gated.",
      cta: "Complete evidence sources",
      primarySection: missingCount > 0 ? "social" : "import",
      score,
      connectedCount,
      missingCount,
      consentRequiredCount,
      autoApplyEligible,
      externalAccessGated: true,
      providers,
    };
  }

  return {
    status: "ready",
    label: "Evidence ready",
    headline: "Profile evidence is ready for controlled automation.",
    detail: "Connected evidence can support matching and material preparation. External sending still requires the configured approval gates.",
    cta: "Review evidence",
    primarySection: "import",
    score,
    connectedCount,
    missingCount,
    consentRequiredCount,
    autoApplyEligible,
    externalAccessGated: false,
    providers,
  };
}
