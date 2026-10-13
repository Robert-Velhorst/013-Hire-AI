import { areSalaryCurrenciesComparable, normalizeSalaryCurrency } from "@shared/salaryCurrency";

export interface JobMatchJobLike {
  title?: string | null;
  company?: string | null;
  skills?: string | null;
  location?: string | null;
  jobType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  applicationUrl?: string | null;
  applicationEmail?: string | null;
  matchScore?: number | null;
}

export interface JobMatchProfileLike {
  skills?: string | null;
  desiredLocations?: string | null;
  desiredJobTypes?: string | null;
  salaryExpectationMin?: number | null;
  salaryExpectationMax?: number | null;
  salaryExpectationCurrency?: string | null;
  resumeUrl?: string | null;
  resumeFileKey?: string | null;
}

export interface JobMatchAutonomousDecisionLike {
  matchScore?: number | null;
  confidence?: "high" | "medium" | "low" | string | null;
  action?: "auto_apply" | "queue_for_review" | "manual_apply" | "skip" | string | null;
  reasons?: string[] | null;
  blockers?: string[] | null;
  reviewRequired?: boolean | null;
  automationNotes?: string[] | null;
}

export interface JobMatchPersistedDecisionLike {
  decision?: "apply" | "save" | "ignore" | "review" | "manual_apply" | string | null;
  decisionReason?: string | null;
  matchScore?: number | null;
  riskLevel?: "low" | "medium" | "high" | string | null;
  reviewRequired?: boolean | number | null;
  reviewReason?: string | null;
  updatedAt?: Date | string | null;
}

export type JobMatchRecommendedDecision = "review" | "save" | "ignore" | "manual_apply";
export type JobMatchRiskLevel = "low" | "medium" | "high";
export type JobMatchFitStatus = "fit" | "partial" | "gap" | "unknown";

export interface JobMatchDecisionSummary {
  matchScore: number;
  confidence: "high" | "medium" | "low";
  matchedSkills: string[];
  missingSkills: string[];
  salaryFit: JobMatchFitStatus;
  locationFit: JobMatchFitStatus;
  remoteFit: boolean;
  recommendedDecision: JobMatchRecommendedDecision;
  decisionLabel: string;
  ledgerDecision: string | null;
  ledgerDecisionLabel: string | null;
  ledgerDecisionReason: string | null;
  ledgerReviewReason: string | null;
  ledgerUpdatedAt: Date | null;
  isDecided: boolean;
  riskLevel: JobMatchRiskLevel;
  reviewRequired: boolean;
  reasons: string[];
  blockers: string[];
  nextAction: string;
}

function splitList(value?: string | null): string[] {
  return (value || "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function canonical(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
}

function overlaps(a: string, b: string) {
  const left = canonical(a);
  const right = canonical(b);
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function uniqueCaseInsensitive(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = canonical(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function inferScore(
  job: JobMatchJobLike,
  userSkills: string[],
  jobSkills: string[],
  matchedSkills: string[]
) {
  if (typeof job.matchScore === "number") return clampScore(job.matchScore);

  const skillBase = userSkills.length > 0 && jobSkills.length > 0
    ? (matchedSkills.length / Math.max(1, Math.min(userSkills.length, jobSkills.length))) * 45
    : 18;
  const remoteBonus = (job.location || "").toLowerCase().includes("remote") ? 10 : 0;
  return clampScore(35 + skillBase + remoteBonus);
}

function getSalaryFit(job: JobMatchJobLike, profile?: JobMatchProfileLike | null): JobMatchFitStatus {
  const hasJobSalary = Boolean(job.salaryMin || job.salaryMax);
  const hasPreference = Boolean(profile?.salaryExpectationMin || profile?.salaryExpectationMax);
  if (!hasJobSalary || !hasPreference) return "unknown";
  if (!areSalaryCurrenciesComparable(job.salaryCurrency, profile?.salaryExpectationCurrency)) return "unknown";

  if (profile?.salaryExpectationMin && job.salaryMax && job.salaryMax < profile.salaryExpectationMin) {
    return "gap";
  }
  if (profile?.salaryExpectationMax && job.salaryMin && job.salaryMin > profile.salaryExpectationMax) {
    return "partial";
  }
  return "fit";
}

function getLocationFit(job: JobMatchJobLike, profile?: JobMatchProfileLike | null): JobMatchFitStatus {
  return getLocationPreferenceFit(job.location, profile?.desiredLocations);
}

function actionToDecision(action?: string | null): JobMatchRecommendedDecision | null {
  switch (action) {
    case "queue_for_review":
    case "auto_apply":
      return "review";
    case "manual_apply":
      return "manual_apply";
    case "skip":
      return "ignore";
    default:
      return null;
  }
}

function persistedDecisionToRecommended(decision?: string | null): JobMatchRecommendedDecision | null {
  switch (decision) {
    case "apply":
    case "review":
      return "review";
    case "manual_apply":
      return "manual_apply";
    case "save":
      return "save";
    case "ignore":
      return "ignore";
    default:
      return null;
  }
}

function decisionLabel(decision: JobMatchRecommendedDecision) {
  switch (decision) {
    case "manual_apply":
      return "Manual review";
    case "save":
      return "Save for later";
    case "ignore":
      return "Ignore";
    default:
      return "Queue for review";
  }
}

function coerceDate(value?: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function coerceRiskLevel(value?: string | null): JobMatchRiskLevel | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function coerceReviewRequired(value?: boolean | number | null): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return null;
}

function nextActionForPersistedDecision(decision: JobMatchRecommendedDecision) {
  switch (decision) {
    case "manual_apply":
      return "Already queued as a manual application task in the operating ledger.";
    case "review":
      return "Already queued in the operating ledger; review pending application gates before any external submission.";
    case "save":
      return "Already saved for later review in the operating ledger.";
    case "ignore":
      return "Already ignored in the operating ledger. Reopen only if the role or profile data changes.";
  }
}

export function getJobMatchDecisionSummary(
  job: JobMatchJobLike,
  profile?: JobMatchProfileLike | null,
  autonomousDecision?: JobMatchAutonomousDecisionLike | null,
  persistedDecision?: JobMatchPersistedDecisionLike | null
): JobMatchDecisionSummary {
  const userSkills = splitList(profile?.skills);
  const jobSkills = splitList(job.skills);
  const matchedSkills = uniqueCaseInsensitive(
    jobSkills.filter((jobSkill) => userSkills.some((userSkill) => overlaps(userSkill, jobSkill)))
  );
  const missingSkills = uniqueCaseInsensitive(
    jobSkills.filter((jobSkill) => !matchedSkills.some((matched) => overlaps(matched, jobSkill)))
  ).slice(0, 8);
  const inferredScore = inferScore(job, userSkills, jobSkills, matchedSkills);
  const matchScore = typeof persistedDecision?.matchScore === "number"
    ? clampScore(persistedDecision.matchScore)
    : typeof autonomousDecision?.matchScore === "number"
    ? clampScore(autonomousDecision.matchScore)
    : inferredScore;
  const confidence = autonomousDecision?.confidence === "high" || autonomousDecision?.confidence === "medium" || autonomousDecision?.confidence === "low"
    ? autonomousDecision.confidence
    : matchScore >= 80
      ? "high"
      : matchScore >= 60
        ? "medium"
        : "low";
  const salaryFit = getSalaryFit(job, profile);
  const locationFit = getLocationFit(job, profile);
  const remoteFit = (job.location || "").toLowerCase().includes("remote");
  const salaryCurrencyRequiresReview = Boolean(
    (job.salaryMin || job.salaryMax) &&
    (profile?.salaryExpectationMin || profile?.salaryExpectationMax) &&
    !areSalaryCurrenciesComparable(job.salaryCurrency, profile?.salaryExpectationCurrency)
  );
  const autonomousBlockers = autonomousDecision?.blockers || [];
  const hasAutonomousBlocker = (needle: string) =>
    autonomousBlockers.some((blocker) => blocker.toLowerCase().includes(needle));
  const blockers = uniqueCaseInsensitive([
    ...autonomousBlockers,
    !profile?.skills ? "Profile skills are incomplete" : "",
    !profile?.resumeUrl && !profile?.resumeFileKey && !hasAutonomousBlocker("resume is required")
      ? "Resume is required before submission"
      : "",
    !job.applicationUrl && !job.applicationEmail && !hasAutonomousBlocker("application destination")
      ? "No application destination found"
      : "",
    salaryFit === "gap" && !hasAutonomousBlocker("salary")
      ? "Salary range is below stated expectations"
      : "",
    salaryCurrencyRequiresReview
      ? `Salary is listed in ${normalizeSalaryCurrency(job.salaryCurrency) ?? "an unknown currency"} and needs review against the ${normalizeSalaryCurrency(profile?.salaryExpectationCurrency) ?? "unspecified"} expectation`
      : "",
    locationFit === "gap" && !hasAutonomousBlocker("location")
      ? "Location does not match stated preferences"
      : "",
  ].filter(Boolean));
  const reasons = uniqueCaseInsensitive([
    ...(autonomousDecision?.reasons || []),
    matchedSkills.length > 0 ? `${matchedSkills.length} required skill${matchedSkills.length === 1 ? "" : "s"} match the profile` : "",
    remoteFit ? "Remote-compatible role" : "",
    salaryFit === "fit" ? "Salary appears compatible with expectations" : "",
    locationFit === "fit" ? "Location appears compatible with preferences" : "",
  ].filter(Boolean)).slice(0, 6);
  const actionDecision = actionToDecision(autonomousDecision?.action);
  const persistedRecommendedDecision = persistedDecisionToRecommended(persistedDecision?.decision);

  let recommendedDecision: JobMatchRecommendedDecision = persistedRecommendedDecision || actionDecision || "save";
  if (!persistedRecommendedDecision && !actionDecision) {
    if (blockers.some((blocker) => blocker.includes("No application destination"))) {
      recommendedDecision = "ignore";
    } else if (matchScore >= 75) {
      recommendedDecision = "review";
    } else if (matchScore >= 55) {
      recommendedDecision = "save";
    } else {
      recommendedDecision = "ignore";
    }
  }

  const computedRiskLevel: JobMatchRiskLevel =
    blockers.length > 0 || recommendedDecision === "manual_apply"
      ? "high"
      : matchScore >= 80
        ? "low"
        : "medium";
  const riskLevel = coerceRiskLevel(persistedDecision?.riskLevel) || computedRiskLevel;
  const persistedReviewRequired = coerceReviewRequired(persistedDecision?.reviewRequired);
  const reviewRequired = persistedReviewRequired ?? autonomousDecision?.reviewRequired ?? recommendedDecision !== "ignore";
  const ledgerUpdatedAt = coerceDate(persistedDecision?.updatedAt);

  return {
    matchScore,
    confidence,
    matchedSkills: matchedSkills.slice(0, 8),
    missingSkills,
    salaryFit,
    locationFit,
    remoteFit,
    recommendedDecision,
    decisionLabel: decisionLabel(recommendedDecision),
    ledgerDecision: persistedDecision?.decision ?? null,
    ledgerDecisionLabel: persistedRecommendedDecision ? decisionLabel(persistedRecommendedDecision) : null,
    ledgerDecisionReason: persistedDecision?.decisionReason ?? null,
    ledgerReviewReason: persistedDecision?.reviewReason ?? null,
    ledgerUpdatedAt,
    isDecided: Boolean(persistedRecommendedDecision),
    riskLevel,
    reviewRequired,
    reasons,
    blockers,
    nextAction: persistedRecommendedDecision
      ? nextActionForPersistedDecision(persistedRecommendedDecision)
      : blockers.length > 0
      ? "Review blockers before preparing application materials."
      : recommendedDecision === "review"
        ? "Queue this job for review so materials can be prepared without an external submission."
        : recommendedDecision === "manual_apply"
          ? "Create a manual application task for this unsupported platform."
          : recommendedDecision === "save"
            ? "Save this job for later review instead of applying immediately."
            : "Ignore this job unless the role or profile data changes.",
  };
}
import { getLocationPreferenceFit } from "@shared/locationEligibility";
