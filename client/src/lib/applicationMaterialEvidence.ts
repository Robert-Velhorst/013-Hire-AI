export interface ApplicationMaterialEvidenceInput {
  coverLetter?: string | null;
  customResume?: string | null;
  customAnswers?: string | null;
  claimsMade?: string | null;
  sourceProfileSnapshot?: string | null;
  resumeId?: number | null;
}

export interface ApplicationMaterialEvidenceSummary {
  hasMaterial: boolean;
  source: string | null;
  resumeState: "version" | "custom_text" | "profile_linked" | "missing";
  resumeVersion: number | null;
  coverLetterStored: boolean;
  customAnswerCount: number;
  customAnswerLabels: string[];
  supportSignals: string[];
  supportedSkills: string[];
  blockers: string[];
  honestyNote: string | null;
  profileEvidence: {
    skills: string | null;
    experience: string | null;
    education: string | null;
    targetRoles: string | null;
    targetLocations: string | null;
    salaryMinimum: number | null;
    salaryMaximum: number | null;
    salaryCurrency: string;
    resumeConnected: boolean;
  };
}

function parseJsonRecord(value?: string | null): Record<string, unknown> | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === "string" ? item.trim() : "")
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function getNestedRecord(value: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const candidate = value?.[key];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

function stringValue(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactText(value: string | null, maxLength = 180): string | null {
  if (!value) return null;
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength - 1).trim()}...`;
}

function firstNonEmpty(...values: Array<string | null>): string | null {
  return values.find((value) => Boolean(value?.trim())) || null;
}

function getProfileRecord(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  return getNestedRecord(snapshot, "profile") || snapshot;
}

export function getApplicationMaterialEvidenceSummary(
  material?: ApplicationMaterialEvidenceInput | null
): ApplicationMaterialEvidenceSummary {
  const customAnswers = parseJsonRecord(material?.customAnswers);
  const claimsMade = parseJsonRecord(material?.claimsMade);
  const sourceProfileSnapshot = parseJsonRecord(material?.sourceProfileSnapshot);
  const profile = getProfileRecord(sourceProfileSnapshot);
  const reasons = toStringList(claimsMade?.reasons);
  const supportedSkills = toStringList(claimsMade?.supportedSkills);
  const blockers = toStringList(claimsMade?.blockers);
  const textClaims = !claimsMade && material?.claimsMade ? toStringList(material.claimsMade) : [];
  const automationNotes = toStringList(customAnswers?.automationNotes);
  const customAnswerLabels = customAnswers
    ? Object.keys(customAnswers).filter((key) => !["source", "automationNotes"].includes(key))
    : [];
  const supportSignals = [
    ...reasons,
    ...textClaims,
    ...automationNotes.filter((note) => !/unsupported|requires manual|must be connected/i.test(note)),
  ].map((item) => compactText(item)).filter(Boolean) as string[];
  const source = firstNonEmpty(
    stringValue(customAnswers, "source"),
    stringValue(sourceProfileSnapshot, "source")
  );
  const resumeConnected = Boolean(
    material?.resumeId ||
    material?.customResume ||
    (stringValue(profile, "resumeUrl") && stringValue(profile, "resumeFileKey"))
  );

  return {
    hasMaterial: Boolean(material),
    source,
    resumeState: material?.resumeId
      ? "version"
      : material?.customResume
        ? "custom_text"
        : resumeConnected
          ? "profile_linked"
          : "missing",
    resumeVersion: material?.resumeId ?? null,
    coverLetterStored: Boolean(material?.coverLetter),
    customAnswerCount: customAnswerLabels.length,
    customAnswerLabels,
    supportSignals: Array.from(new Set(supportSignals)).slice(0, 6),
    supportedSkills: Array.from(new Set(supportedSkills)).slice(0, 6),
    blockers: blockers.map((item) => compactText(item)).filter(Boolean).slice(0, 6) as string[],
    honestyNote: firstNonEmpty(
      stringValue(claimsMade, "note"),
      material?.claimsMade && !claimsMade ? compactText(material.claimsMade) : null
    ),
    profileEvidence: {
      skills: compactText(stringValue(profile, "skills")),
      experience: compactText(stringValue(profile, "experience")),
      education: compactText(stringValue(profile, "education")),
      targetRoles: compactText(firstNonEmpty(
        stringValue(profile, "desiredJobTypes"),
        stringValue(profile, "targetRoles")
      )),
      targetLocations: compactText(firstNonEmpty(
        stringValue(profile, "desiredLocations"),
        stringValue(profile, "targetLocations")
      )),
      salaryMinimum: numberValue(profile, "salaryExpectationMin"),
      salaryMaximum: numberValue(profile, "salaryExpectationMax"),
      salaryCurrency: stringValue(profile, "salaryExpectationCurrency") || "USD",
      resumeConnected,
    },
  };
}
