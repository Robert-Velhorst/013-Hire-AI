import type { Application, Job, UserProfile } from "../drizzle/schema";
import { detectATSType, isAutomationSupported } from "./applicationAutomation";
import { normalizeExperienceLevel, normalizeLocation } from "./jobNormalization";
import { getLocationPreferenceFit } from "../shared/locationEligibility";
import { isJobListingCurrent } from "../shared/jobListingFreshness";
import { assessListingSafety } from "../shared/listingSafety";
import { areSalaryCurrenciesComparable, normalizeSalaryCurrency } from "../shared/salaryCurrency";

export type AutonomousMode = "review_first" | "auto_apply";

export interface AutonomousPreferences {
  autonomousEnabled?: boolean;
  mode?: AutonomousMode;
  minMatchScore?: number;
  dailyApplicationLimit?: number;
  remoteOnly?: boolean;
  requireHumanReview?: boolean;
  allowUnsupportedATS?: boolean;
  createFollowUps?: boolean;
  scanFrequency?: "continuous" | "hourly" | "twice-daily" | "daily";
}

export const AUTONOMOUS_SCAN_FREQUENCY_MS = {
  continuous: 15 * 60 * 1000,
  hourly: 60 * 60 * 1000,
  "twice-daily": 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
} as const;

export function getAutonomousScanIntervalMs(frequency?: AutonomousPreferences["scanFrequency"]) {
  return AUTONOMOUS_SCAN_FREQUENCY_MS[frequency || "daily"];
}

export function getNextAutonomousRunAt(
  lastCompletedAt: Date | null | undefined,
  frequency?: AutonomousPreferences["scanFrequency"]
) {
  if (!lastCompletedAt) return new Date();
  return new Date(lastCompletedAt.getTime() + getAutonomousScanIntervalMs(frequency));
}

export interface AutonomousJobDecision {
  jobId: number;
  title: string;
  company: string;
  matchScore: number;
  confidence: "high" | "medium" | "low";
  atsType: string;
  automationSupported: boolean;
  action: "auto_apply" | "queue_for_review" | "manual_apply" | "blocked" | "skip";
  priority: "urgent" | "high" | "normal" | "low";
  reasons: string[];
  blockers: string[];
  reviewRequired: boolean;
  automationNotes: string[];
  userDecisionLocked: boolean;
}

export interface AutonomousFollowUpDecision {
  applicationId: number;
  jobId: number;
  status: string;
  daysSinceActivity: number;
  action: "send_follow_up" | "wait" | "skip";
  messageType: "initial" | "reminder" | "thank_you" | "status_check";
  reason: string;
}

export interface AutonomousPlan {
  mode: AutonomousMode;
  summary: {
    scanned: number;
    expiredJobsSkipped: number;
    eligible: number;
    queuedForApply: number;
    queuedForReview: number;
    manualApply: number;
    blocked: number;
    skipped: number;
    followUpsDue: number;
    dailyRemaining: number;
    policyWarnings: number;
  };
  decisions: AutonomousJobDecision[];
  followUps: AutonomousFollowUpDecision[];
  nextActions: string[];
  policyWarnings: string[];
}

export interface AutonomousPlanningContext {
  autonomousPreparationsToday?: number;
}

/**
 * Keep a stale listing out of every autonomous path, even when a provider has
 * not yet refreshed its `isActive` flag.
 */
export function isJobCurrentForAutonomousProcessing(job: Job, now = new Date()): boolean {
  return isJobListingCurrent(job, now);
}

function splitList(value?: string | null): string[] {
  return (value || "")
    .split(/[,;\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function parseAutonomousPreferences(value?: string | null): AutonomousPreferences {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return {
      autonomousEnabled: parsed.autonomousEnabled === true,
      mode: parsed.mode === "auto_apply" ? "auto_apply" : "review_first",
      minMatchScore: typeof parsed.minMatchScore === "number"
        ? Math.min(100, Math.max(0, Math.round(parsed.minMatchScore)))
        : undefined,
      dailyApplicationLimit: typeof parsed.dailyApplicationLimit === "number"
        ? Math.min(25, Math.max(1, Math.round(parsed.dailyApplicationLimit)))
        : undefined,
      remoteOnly: typeof parsed.remoteOnly === "boolean" ? parsed.remoteOnly : undefined,
      requireHumanReview: typeof parsed.requireHumanReview === "boolean" ? parsed.requireHumanReview : undefined,
      allowUnsupportedATS: typeof parsed.allowUnsupportedATS === "boolean" ? parsed.allowUnsupportedATS : undefined,
      createFollowUps: typeof parsed.createFollowUps === "boolean" ? parsed.createFollowUps : undefined,
      scanFrequency: ["continuous", "hourly", "twice-daily", "daily"].includes(parsed.scanFrequency)
        ? parsed.scanFrequency
        : undefined,
    };
  } catch {
    return {};
  }
}

function hasOverlap(candidate: string[], target: string[]): number {
  if (candidate.length === 0 || target.length === 0) return 0;
  return candidate.filter((skill) =>
    target.some((jobSkill) => jobSkill.includes(skill) || skill.includes(jobSkill))
  ).length;
}

function canonicalTarget(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesTargetRole(job: Job, targets: string[]): boolean {
  if (targets.length === 0) return true;

  const jobTargets = [job.title, job.jobType]
    .filter((value): value is string => Boolean(value))
    .map(canonicalTarget)
    .filter(Boolean);

  return targets
    .map(canonicalTarget)
    .filter(Boolean)
    .some((target) => jobTargets.some((jobTarget) =>
      jobTarget.includes(target) || target.includes(jobTarget)
    ));
}

function daysSince(date?: Date | string | null): number {
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
}

function hasAppliedToday(application: Application): boolean {
  const createdAt = application.createdAt ? new Date(application.createdAt) : null;
  if (!createdAt) return false;
  const notes = application.notes?.toLowerCase() || "";
  const isAutonomousPreparation =
    application.isAutoApplied === 1 ||
    notes.includes("autonomous") ||
    notes.includes("manual apply queue");
  const today = new Date();
  return (
    createdAt.getFullYear() === today.getFullYear() &&
    createdAt.getMonth() === today.getMonth() &&
    createdAt.getDate() === today.getDate() &&
    isAutonomousPreparation
  );
}

export function scoreJobForProfile(job: Job, profile?: Partial<UserProfile> | null): {
  score: number;
  reasons: string[];
  blockers: string[];
} {
  const reasons: string[] = [];
  const blockers: string[] = [];
  let score = 35;

  const userSkills = splitList(profile?.skills);
  const jobSkills = splitList(job.skills);
  const skillMatches = hasOverlap(userSkills, jobSkills);
  if (userSkills.length > 0 && jobSkills.length > 0) {
    const skillScore = Math.round((skillMatches / Math.max(1, Math.min(userSkills.length, jobSkills.length))) * 35);
    score += Math.min(35, skillScore);
    if (skillMatches > 0) reasons.push(`${skillMatches} required skills match the profile`);
  } else {
    reasons.push("Profile or job skills are incomplete, using neutral skill score");
  }

  const normalizedLocation = normalizeLocation(job.location);
  const desiredLocations = splitList(profile?.desiredLocations);
  if (normalizedLocation.isRemote) {
    score += 12;
    reasons.push("Remote-compatible role");
  }
  if (desiredLocations.length > 0) {
    const locationFit = getLocationPreferenceFit(job.location, profile?.desiredLocations);
    if (locationFit === "fit") {
      score += 8;
      reasons.push("Location matches stated preferences");
    } else if (locationFit === "gap") {
      blockers.push("Location does not match the user's stated preferences");
      score -= 20;
    }
  }

  const desiredTargets = splitList(profile?.desiredJobTypes);
  if (desiredTargets.length > 0 && matchesTargetRole(job, desiredTargets)) {
    score += 8;
    reasons.push("Role or employment type matches target preferences");
  } else if (desiredTargets.length > 0) {
    blockers.push("Role does not match the user's target preferences");
    score -= 20;
  }

  const hasSalaryExpectation = Boolean(profile?.salaryExpectationMin || profile?.salaryExpectationMax);
  const hasJobSalary = Boolean(job.salaryMin || job.salaryMax);
  const salaryCurrenciesComparable = areSalaryCurrenciesComparable(
    job.salaryCurrency,
    profile?.salaryExpectationCurrency
  );
  if (hasSalaryExpectation && hasJobSalary && !salaryCurrenciesComparable) {
    blockers.push(
      `Salary is listed in ${normalizeSalaryCurrency(job.salaryCurrency)} and needs review against the ${normalizeSalaryCurrency(profile?.salaryExpectationCurrency)} expectation`
    );
  } else if (profile?.salaryExpectationMin && job.salaryMax && job.salaryMax < profile.salaryExpectationMin) {
    blockers.push("Salary range is below the user's minimum expectation");
    score -= 25;
  } else if (profile?.salaryExpectationMin && job.salaryMin && job.salaryMin >= profile.salaryExpectationMin) {
    score += 8;
    reasons.push("Salary meets stated expectations");
  }

  if (profile?.needsVisaSponsorship && !job.visaSponsorshipAvailable) {
    blockers.push("Visa sponsorship is not marked as available");
    score -= 20;
  }

  const experience = normalizeExperienceLevel(`${job.title} ${job.requirements || ""}`);
  if (experience !== "unknown") {
    reasons.push(`${experience} level detected`);
  }

  if (!job.applicationUrl && !job.applicationEmail) {
    blockers.push("No application destination found");
    score -= 30;
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    blockers,
  };
}

export function buildAutonomousPlan(
  jobs: Job[],
  profile?: Partial<UserProfile> | null,
  applications: Application[] = [],
  preferences: AutonomousPreferences = {},
  hasActiveResumeArtifact?: boolean,
  userDecisionJobIds: Iterable<number> = [],
  planningContext: AutonomousPlanningContext = {}
): AutonomousPlan {
  const mode = preferences.mode || "review_first";
  const minMatchScore = Math.min(100, Math.max(0, Math.round(preferences.minMatchScore ?? 70)));
  const dailyLimit = Math.min(25, Math.max(1, Math.round(preferences.dailyApplicationLimit ?? 12)));
  // Campaign persistence treats an omitted preference as remote-only. Keep the
  // planning layer aligned so legacy preference records cannot prepare hybrid
  // or on-site roles by accident.
  const remoteOnly = preferences.remoteOnly !== false;
  const requireHumanReview = preferences.requireHumanReview ?? true;
  const allowUnsupportedATS = preferences.allowUnsupportedATS ?? false;
  const now = new Date();
  const expiredJobsSkipped = jobs.filter((job) =>
    job.isActive === 1 && !isJobCurrentForAutonomousProcessing(job, now)
  ).length;
  const currentJobs = jobs.filter((job) => isJobCurrentForAutonomousProcessing(job, now));
  // A pending application is only a preparation record. It can be reconciled
  // after an interrupted run, while progressed or withdrawn records must never
  // be queued again as though no application history exists.
  const appliedJobIds = new Set(
    applications
      .filter((application) => (application.status || "pending") !== "pending")
      .map((application) => application.jobId)
  );
  const alreadyQueuedToday = planningContext.autonomousPreparationsToday ??
    applications.filter(hasAppliedToday).length;
  const dailyRemaining = Math.max(0, dailyLimit - alreadyQueuedToday);
  const policyWarnings: string[] = [];
  const hasResumeEvidence = hasActiveResumeArtifact ?? Boolean(profile?.resumeUrl || profile?.resumeFileKey);
  const userDecisionJobs = new Set(userDecisionJobIds);

  if (mode === "auto_apply" && requireHumanReview) {
    policyWarnings.push("Human review is enabled, so high-fit jobs will be queued for review before submission.");
  }
  if (!hasResumeEvidence) {
    policyWarnings.push("No active versioned resume is connected. Autonomous application preparation and submission are blocked.");
  }
  if (!profile?.skills) {
    policyWarnings.push("Profile skills are incomplete, reducing match confidence.");
  }

  const followUps: AutonomousFollowUpDecision[] = applications.map((application) => {
    const activityDate = application.lastActivity || application.appliedDate || application.createdAt;
    const age = daysSince(activityDate);
    const status = application.status || "pending";

    if (status === "interview") {
      const messageType = age >= 5 ? "status_check" : "thank_you";
      return {
        applicationId: application.id,
        jobId: application.jobId,
        status,
        daysSinceActivity: age,
        action: age >= 1 ? "send_follow_up" : "wait",
        messageType,
        reason: age >= 5
          ? "Interview-stage application has no recent activity and should receive a status check."
          : age >= 1
            ? "Interview-stage application should receive a thank-you note."
            : "Recently moved to interview stage.",
      };
    }

    if (["applied", "viewed"].includes(status)) {
      return {
        applicationId: application.id,
        jobId: application.jobId,
        status,
        daysSinceActivity: age,
        action: age >= 5 ? "send_follow_up" : "wait",
        messageType: age >= 10 ? "status_check" : "reminder",
        reason: age >= 5 ? "No recent activity after application submission." : "Follow-up window has not opened yet.",
      };
    }

    return {
      applicationId: application.id,
      jobId: application.jobId,
      status,
      daysSinceActivity: age,
      action: "skip",
      messageType: "status_check",
      reason: "Application status does not need autonomous follow-up.",
    };
  });

  const followUpsDue = preferences.createFollowUps
    ? followUps.filter((followUp) => followUp.action === "send_follow_up").length
    : 0;

  const rankedDecisions = currentJobs
    .map((job) => {
      const { score, reasons, blockers } = scoreJobForProfile(job, profile);
      const listingSafety = assessListingSafety(job, now);
      const normalizedLocation = normalizeLocation(job.location);
      const remoteEligibilityUnknown = remoteOnly && normalizedLocation.remoteType === "unknown";
      const support = job.applicationUrl
        ? isAutomationSupported(job.applicationUrl)
        : {
            supported: false,
            preparationSupported: false,
            atsType: "unknown",
            message: "No application URL",
          };
      const automationNotes: string[] = [support.message];

      if (listingSafety.status === "blocked") {
        blockers.push(...listingSafety.reasons);
      } else if (listingSafety.status === "review") {
        automationNotes.push(...listingSafety.reasons);
        automationNotes.push("Listing safety signals require review before any application preparation.");
      }

      if (appliedJobIds.has(job.id)) {
        blockers.push("Already applied to this job");
      }

      if (remoteOnly && ["hybrid", "onsite"].includes(normalizedLocation.remoteType)) {
        blockers.push("Remote-only policy excludes hybrid and on-site roles");
      }

      if (remoteEligibilityUnknown) {
        automationNotes.push("Remote eligibility is not explicit in the listing and requires review before preparation.");
      }

      if (!hasResumeEvidence) {
        blockers.push("Resume is required before autonomous submission");
      }

      if (!support.supported && !allowUnsupportedATS) {
        automationNotes.push("No unattended employer-portal integration is available. Review the prepared material and complete the employer handoff manually.");
      }

      let action: AutonomousJobDecision["action"] = "skip";
      const resumeMissing = blockers.includes("Resume is required before autonomous submission");
      const hardBlockers = blockers.filter((blocker) =>
        blocker !== "Resume is required before autonomous submission" &&
        !blocker.startsWith("Salary is listed in ")
      );
      const salaryCurrencyReviewRequired = blockers.some((blocker) => blocker.startsWith("Salary is listed in "));

      if (listingSafety.status === "blocked") {
        action = "blocked";
      } else if (score >= minMatchScore && hardBlockers.length === 0) {
        if (resumeMissing) {
          action = "blocked";
          automationNotes.push("An active versioned resume is required before Hire.AI can prepare application materials for this role.");
        } else if (listingSafety.status === "review" || remoteEligibilityUnknown || salaryCurrencyReviewRequired) {
          action = "queue_for_review";
        } else if (!support.supported && allowUnsupportedATS) {
          action = "manual_apply";
        } else if (mode === "auto_apply" && support.supported && !requireHumanReview) {
          action = "auto_apply";
        } else {
          action = "queue_for_review";
        }
      }

      const userDecisionLocked = userDecisionJobs.has(job.id);
      if (userDecisionLocked) {
        action = "skip";
        automationNotes.push("A user-owned ledger decision prevents autonomous preparation for this job.");
      }

      return {
        jobId: job.id,
        title: job.title,
        company: job.company,
        matchScore: score,
        confidence: score >= 80 ? "high" : score >= 65 ? "medium" : "low",
        atsType: detectATSType(job.applicationUrl || ""),
        automationSupported: support.supported,
        action,
        priority: score >= 85 ? "urgent" : score >= 75 ? "high" : score >= minMatchScore ? "normal" : "low",
        reasons: reasons.slice(0, 4),
        blockers,
        reviewRequired: requireHumanReview || !support.supported || listingSafety.status === "review" || remoteEligibilityUnknown || blockers.length > 0,
        automationNotes,
        userDecisionLocked,
      } satisfies AutonomousJobDecision;
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  let preparationSlots = dailyRemaining;
  const decisions = rankedDecisions.map((decision) => {
    if (!["auto_apply", "queue_for_review", "manual_apply"].includes(decision.action)) {
      return decision;
    }
    if (preparationSlots <= 0) {
      return {
        ...decision,
        action: "skip" as const,
        automationNotes: [
          ...decision.automationNotes,
          "Daily preparation limit reached; this job will be reconsidered on a future run.",
        ],
      };
    }
    preparationSlots -= 1;
    return decision;
  });

  const queuedForApply = decisions.filter((decision) => decision.action === "auto_apply").length;
  const queuedForReview = decisions.filter((decision) => decision.action === "queue_for_review").length;
  const manualApply = decisions.filter((decision) => decision.action === "manual_apply").length;
  const blocked = decisions.filter((decision) => decision.action === "blocked").length;
  const skipped = decisions.filter((decision) => decision.action === "skip").length;

  const nextActions: string[] = [];
  if (!hasResumeEvidence) {
    nextActions.push("Upload and select an active versioned resume before autonomous application preparation can run.");
  }
  if (blocked > 0) {
    nextActions.push(`Resolve profile evidence to reconsider ${blocked} high-fit role${blocked === 1 ? "" : "s"}.`);
  }
  if (queuedForReview > 0) {
    nextActions.push(`Review ${queuedForReview} high-fit jobs before submission.`);
  }
  if (queuedForApply > 0) {
    nextActions.push(`Queue ${queuedForApply} supported applications for autonomous submission.`);
  }
  if (manualApply > 0) {
    nextActions.push(`Prepare ${manualApply} manual application tasks for unsupported platforms.`);
  }
  if (followUpsDue > 0) {
    nextActions.push(`Draft ${followUpsDue} timely follow-up message${followUpsDue === 1 ? "" : "s"}.`);
  }
  const nonRemoteExcluded = decisions.filter((decision) =>
    decision.blockers.includes("Remote-only policy excludes hybrid and on-site roles")
  ).length;
  if (nonRemoteExcluded > 0) {
    nextActions.push(`Excluded ${nonRemoteExcluded} hybrid or on-site role${nonRemoteExcluded === 1 ? "" : "s"} under the remote-only campaign policy.`);
  }
  const remoteEligibilityReviews = decisions.filter((decision) =>
    decision.automationNotes.includes("Remote eligibility is not explicit in the listing and requires review before preparation.")
  ).length;
  if (remoteEligibilityReviews > 0) {
    nextActions.push(`Review ${remoteEligibilityReviews} role${remoteEligibilityReviews === 1 ? "" : "s"} with unverified remote eligibility before preparation.`);
  }
  if (expiredJobsSkipped > 0) {
    nextActions.push(`Excluded ${expiredJobsSkipped} expired or stale job posting${expiredJobsSkipped === 1 ? "" : "s"} from autonomous preparation.`);
  }
  if (nextActions.length === 0) {
    nextActions.push("Keep scouting and wait for stronger matches.");
  }

  return {
    mode,
    summary: {
      scanned: currentJobs.length,
      expiredJobsSkipped,
      eligible: decisions.filter((decision) => !["skip", "blocked"].includes(decision.action)).length,
      queuedForApply,
      queuedForReview,
      manualApply,
      blocked,
      skipped,
      followUpsDue,
      dailyRemaining,
      policyWarnings: policyWarnings.length,
    },
    decisions,
    followUps,
    nextActions,
    policyWarnings,
  };
}

export function getExecutableDecisions(plan: AutonomousPlan) {
  return {
    autoApply: plan.decisions.filter((decision) => decision.action === "auto_apply"),
    review: plan.decisions.filter((decision) => decision.action === "queue_for_review"),
    manual: plan.decisions.filter((decision) => decision.action === "manual_apply"),
    followUps: plan.summary.followUpsDue > 0
      ? plan.followUps.filter((followUp) => followUp.action === "send_follow_up")
      : [],
  };
}
