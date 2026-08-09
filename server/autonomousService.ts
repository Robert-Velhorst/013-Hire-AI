import type { AutonomousJobDecision, AutonomousPlan, AutonomousPreferences } from "./autonomousOrchestrator";
import { randomUUID } from "node:crypto";
import {
  buildAutonomousPlan,
  getExecutableDecisions,
  isJobCurrentForAutonomousProcessing,
  parseAutonomousPreferences,
} from "./autonomousOrchestrator";
import {
  createApplication,
  createApplicationApproval,
  createApplicationAttempt,
  createApplicationDecision,
  createApplicationMaterial,
  createAdminReviewItem,
  createAuditEvent,
  createJobMatch,
  acquireAutonomousRunLease,
  completeAutonomousRunLease,
  getActiveJobs,
  getAutonomousUserEligibility,
  getAutonomousJobSourceEligibility,
  getApplicationLedgerArtifacts,
  getApplicationCampaign,
  getJobById,
  getUserEmployerResponsesForApplications,
  getUserApplicationDecisions,
  getUserApplications,
  getUserProfile,
  getUserSkills,
  getWorkExperiences,
  renewAutonomousRunLease,
  skipAutonomousRunLease,
} from "./db";
import {
  createFollowUp,
  generateFollowUpEmail,
  getUserFollowUpsForApplications,
  getUserInterviewSchedulesForApplications,
} from "./applicationFeatures";
import { getUserOperatingLedger } from "./applicationCampaigns";
import { getInterviewSchedulingRequirement } from "./interviewScheduling";
import { AutonomousExecutionGuard } from "./autonomousExecutionGuard";
import { AutonomousRunRegistry } from "./autonomousRunRegistry";
import {
  countEvidenceGatedActions,
  type AutonomousEvidenceGate,
} from "../shared/autonomousEvidenceGates";
import { getAutonomousEvidenceContext } from "./autonomousEvidence";
import { getActiveResume } from "./resumeStorage";
import { buildEvidenceBoundApplicationDraft, type EvidenceBoundApplicationDraft } from "./applicationMaterialDraft";
import { monitorInboxResponses } from "./inboxResponseMonitoring";
import type { AutonomousJobSourceEligibility } from "./autonomousSourceEligibility";
import { resolveProfileCandidateEvidence } from "@shared/profileSkillEvidence";

export interface AutonomousRunResult extends AutonomousPlan {
  queuedApplicationRecords: number;
  queuedReviewRecords: number;
  queuedManualRecords: number;
  queuedFollowUps: number;
  skippedDuplicateFollowUps: number;
  skippedSafetyBlockedFollowUps: number;
  skippedResumeEvidenceActions: number;
  skippedProfileReadinessActions: number;
  skippedEvidenceGatedActions: number;
  skippedStaleJobActions: number;
  skippedEmptySourceActions: number;
  userDecisionLockedJobs: number;
  inboxProvidersScanned: number;
  inboxReauthorizationRequired: number;
  inboxCandidatesDiscovered: number;
  inboxMonitoringFailures: number;
  evidenceGates: AutonomousEvidenceGate[];
  failedActions: number;
  actionErrors: string[];
}

const activeRuns = new AutonomousRunRegistry<AutonomousRunResult | null>();

export const AUTONOMOUS_RUN_FAILURE =
  "Autonomous work could not complete. Review the operating ledger before retrying.";

function persistableRunSummary(result: AutonomousRunResult) {
  return {
    queuedApplicationRecords: result.queuedApplicationRecords,
    queuedReviewRecords: result.queuedReviewRecords,
    queuedManualRecords: result.queuedManualRecords,
    queuedFollowUps: result.queuedFollowUps,
    skippedDuplicateFollowUps: result.skippedDuplicateFollowUps,
    skippedSafetyBlockedFollowUps: result.skippedSafetyBlockedFollowUps,
    skippedResumeEvidenceActions: result.skippedResumeEvidenceActions,
    skippedProfileReadinessActions: result.skippedProfileReadinessActions,
    skippedEvidenceGatedActions: result.skippedEvidenceGatedActions,
    skippedStaleJobActions: result.skippedStaleJobActions,
    skippedEmptySourceActions: result.skippedEmptySourceActions,
    userDecisionLockedJobs: result.userDecisionLockedJobs,
    inboxProvidersScanned: result.inboxProvidersScanned,
    inboxReauthorizationRequired: result.inboxReauthorizationRequired,
    inboxCandidatesDiscovered: result.inboxCandidatesDiscovered,
    inboxMonitoringFailures: result.inboxMonitoringFailures,
    failedActions: result.failedActions,
  };
}

function wasNewApplication(result: unknown): boolean {
  return !(result && typeof result === "object" && "existing" in result && result.existing === true);
}

async function getCampaignExecutionBlock(userId: number): Promise<string | null> {
  const campaign = await getApplicationCampaign(userId);
  if (!campaign || campaign.status === "active") return null;
  return `The ${campaign.status} job-search campaign must be resumed before autonomous work can run.`;
}

function profileSnapshotForAutonomousRun(profile: unknown) {
  return JSON.stringify({
    source: "autonomousService",
    profile: profile ?? null,
  });
}

function riskForDecision(decision: AutonomousJobDecision, fallback: "medium" | "high" = "medium") {
  return decision.blockers.length > 0 ? "high" : fallback;
}

function autonomousMatchReasons(decision: AutonomousJobDecision) {
  return [
    "Autonomous profile match.",
    decision.reasons.length > 0 ? `Evidence: ${decision.reasons.join(" ")}` : "",
    decision.blockers.length > 0 ? `Review blockers: ${decision.blockers.join(" ")}` : "",
  ].filter(Boolean).join(" ");
}

function autonomousTerminalDecisionReason(decision: AutonomousJobDecision) {
  return [
    `Autonomous plan ${decision.action === "blocked" ? "blocked" : "did not prepare"} ${decision.title} at ${decision.company}.`,
    decision.reasons.length > 0 ? `Match evidence: ${decision.reasons.join(" ")}` : "",
    decision.blockers.length > 0 ? `Blockers: ${decision.blockers.join(" ")}` : "",
    decision.automationNotes.length > 0 ? `Operating notes: ${decision.automationNotes.join(" ")}` : "",
  ].filter(Boolean).join(" ");
}

function isDeferredByDailyLimit(decision: AutonomousJobDecision) {
  return decision.automationNotes.some((note) =>
    note.includes("Daily preparation limit reached")
  );
}

async function recordAutonomousTerminalDecision(userId: number, decision: AutonomousJobDecision) {
  const blocked = decision.action === "blocked";
  const deferred = isDeferredByDailyLimit(decision);
  const reviewReason = [
    ...decision.blockers,
    ...decision.automationNotes,
  ].filter(Boolean).join(" ");

  await createApplicationDecision({
    userId,
    jobId: decision.jobId,
    decision: blocked ? "review" : deferred ? "save" : "ignore",
    decisionReason: autonomousTerminalDecisionReason(decision),
    matchScore: decision.matchScore,
    riskLevel: blocked ? "high" : "low",
    reviewRequired: blocked ? 1 : 0,
    reviewReason: blocked ? reviewReason || "Resolve the recorded blockers before application preparation." : null,
    decidedBy: "system",
  });
}

async function getCurrentJobForAutonomousDecision(jobId: number) {
  const job = await getJobById(jobId);
  if (!job || !isJobCurrentForAutonomousProcessing(job)) {
    return { job: null, blockedByEmptySource: false, sourceEligibility: null };
  }

  const sourceEligibility = await getAutonomousJobSourceEligibility(jobId);
  return {
    job: sourceEligibility.eligible ? job : null,
    blockedByEmptySource: !sourceEligibility.eligible,
    sourceEligibility,
  };
}

async function recordStaleJobPreparationBlocked(userId: number, decision: AutonomousJobDecision) {
  await createAuditEvent({
    userId,
    entityType: "user",
    entityId: userId,
    action: "autonomous_application_preparation_blocked_stale_job",
    actor: "system",
    source: "autonomousService",
    afterState: JSON.stringify({
      jobId: decision.jobId,
      title: decision.title,
      company: decision.company,
      plannedAction: decision.action,
      externalSubmissionPerformed: false,
    }),
    riskLevel: "medium",
  });
}

async function recordEmptySourcePreparationBlocked(
  userId: number,
  decision: AutonomousJobDecision,
  sourceEligibility: AutonomousJobSourceEligibility
) {
  await createAuditEvent({
    userId,
    entityType: "user",
    entityId: userId,
    action: "autonomous_application_preparation_blocked_empty_source_scan",
    actor: "system",
    source: "autonomousService",
    afterState: JSON.stringify({
      jobId: decision.jobId,
      title: decision.title,
      company: decision.company,
      plannedAction: decision.action,
      sourcePlatformIds: sourceEligibility.sourcePlatformIds,
      emptySourcePlatformIds: sourceEligibility.emptySourcePlatformIds,
      staleEmptySourcePlatformIds: sourceEligibility.staleEmptySourcePlatformIds,
      reason: sourceEligibility.reason,
      externalSubmissionPerformed: false,
    }),
    riskLevel: "medium",
  });
}

async function recordAutonomousApplicationLedgerArtifacts({
  userId,
  applicationId,
  decision,
  profile,
  draft,
  resume,
  platformId,
  branch,
  approvalId,
}: {
  userId: number;
  applicationId: number;
  decision: AutonomousJobDecision;
  profile: unknown;
  draft: EvidenceBoundApplicationDraft;
  resume: { id: number; version: number; fileName: string; fileKey: string };
  platformId?: number | null;
  branch: "auto_apply" | "review" | "manual";
  approvalId: number;
}) {
  const riskLevel = branch === "manual" ? "high" : riskForDecision(decision);
  const attemptType = branch === "manual" ? "external_handoff" : "prepare";
  const confirmationText = branch === "manual"
    ? "Autonomous run prepared a manual application handoff. No external submission was performed."
    : "Autonomous run prepared application materials for review. No external submission was performed.";
  const action = branch === "manual"
    ? "autonomous_manual_task_prepared"
    : branch === "review"
      ? "autonomous_review_queued"
      : "autonomous_application_prepared";
  const draftAnswers = JSON.parse(draft.customAnswers) as Record<string, unknown>;
  const draftClaims = JSON.parse(draft.claimsMade) as Record<string, unknown>;

  const artifacts = await getApplicationLedgerArtifacts(applicationId, userId);
  if (!artifacts.material || artifacts.material.resumeId !== resume.id) {
    await createApplicationMaterial({
      applicationId,
      resumeId: resume.id,
      coverLetter: draft.coverLetter,
      customAnswers: JSON.stringify({
        ...draftAnswers,
        source: "autonomousService",
        action: decision.action,
        atsType: decision.atsType,
        automationSupported: decision.automationSupported,
        automationNotes: decision.automationNotes,
      }),
      claimsMade: JSON.stringify({
        ...draftClaims,
        supportedClaimsOnly: true,
        reasons: decision.reasons,
        blockers: decision.blockers,
      }),
      sourceProfileSnapshot: profileSnapshotForAutonomousRun(profile),
    });
  }

  const hasPreparationAttempt = artifacts.attempts.some((attempt) =>
    attempt.attemptType === attemptType && attempt.status === "review_required"
  );
  if (!hasPreparationAttempt) {
    await createApplicationAttempt({
      applicationId,
      userId,
      jobId: decision.jobId,
      platformId: platformId ?? undefined,
      attemptType,
      status: "review_required",
      finishedAt: new Date(),
      confirmationText,
      confirmationUrl: undefined,
      retryCount: 0,
    });
  }

  const hasPreparationAuditEvent = artifacts.auditEvents.some((event) =>
    event.action === action && event.approvalId === approvalId
  );
  if (!hasPreparationAuditEvent) {
    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: applicationId,
      action,
      actor: "system",
      source: "autonomousService",
      afterState: JSON.stringify({
        jobId: decision.jobId,
        title: decision.title,
        company: decision.company,
        matchScore: decision.matchScore,
        atsType: decision.atsType,
        reviewRequired: true,
        approvalId,
        resume: {
          id: resume.id,
          version: resume.version,
          fileName: resume.fileName,
          fileKey: resume.fileKey,
        },
        externalSubmissionPerformed: false,
      }),
      riskLevel,
      approvalId,
    });
  }

  await createAdminReviewItem({
    userId,
    entityType: "application",
    entityId: applicationId,
    category: "application_review",
    priority: riskLevel,
    title: branch === "manual"
      ? "Manual application task prepared by autonomous run"
      : "Autonomous application prepared for review",
    description: [
      `${decision.title} at ${decision.company} was prepared by the autonomous runner.`,
      `Match score: ${decision.matchScore}.`,
      decision.blockers.length > 0 ? `Blockers: ${decision.blockers.join("; ")}.` : "",
      "No external submission was performed.",
    ].filter(Boolean).join(" "),
  });
}

function groupApplicationEvidence<T extends { applicationId: number }>(items: T[]) {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const applicationItems = grouped.get(item.applicationId);
    if (applicationItems) applicationItems.push(item);
    else grouped.set(item.applicationId, [item]);
  }
  return grouped;
}

async function getAutonomousFollowUpSafetyBlock(
  followUp: { applicationId: number; status: string },
  responses: Awaited<ReturnType<typeof getUserEmployerResponsesForApplications>>,
  schedules: Awaited<ReturnType<typeof getUserInterviewSchedulesForApplications>>
): Promise<string | null> {
  const latestResponse = responses[0];
  if (latestResponse && ["employer_question", "other"].includes(latestResponse.responseType)) {
    return "Employer response needs a reply before routine follow-up automation continues.";
  }

  if (followUp.status === "interview") {
    const completedInterviewNeedsOutcome = schedules.some((schedule) =>
      schedule.status === "completed" &&
      !responses.some((response) => response.interviewId === schedule.id)
    );
    if (completedInterviewNeedsOutcome) {
      return "A completed interview needs an outcome before routine follow-up automation continues.";
    }

    const schedulingRequirement = getInterviewSchedulingRequirement(schedules, responses);
    if (schedulingRequirement === "cancelled_schedule") {
      return "Interview schedule was cancelled and needs review before routine follow-up automation continues.";
    }
    if (schedulingRequirement === "new_invite") {
      return "A newer interview invite needs scheduling before routine follow-up automation continues.";
    }
    if (schedulingRequirement === "missing_schedule") {
      return "Interview invite needs scheduling before routine follow-up automation continues.";
    }
  }

  return null;
}

async function executeAutonomousRun(
  userId: number,
  overrides: AutonomousPreferences = {},
  assertLeaseActive: () => void = () => {}
): Promise<AutonomousRunResult> {
  const [jobList, profile, applications, activeResume, existingDecisions, skills, workExperiences] = await Promise.all([
    getActiveJobs(250, 0),
    getUserProfile(userId),
    getUserApplications(userId),
    getActiveResume(userId),
    getUserApplicationDecisions(userId),
    getUserSkills(userId),
    getWorkExperiences(userId),
  ]);
  const profileForMatching = resolveProfileCandidateEvidence(profile, skills, workExperiences);
  const resolvedPreferences = {
    ...parseAutonomousPreferences(profile?.preferences),
    ...overrides,
  };
  const userDecisionJobIds = new Set(
    existingDecisions
      .filter((decision) => decision.decidedBy === "user")
      .map((decision) => decision.jobId)
  );
  const plan = buildAutonomousPlan(
    jobList,
    profileForMatching,
    applications as any,
    resolvedPreferences,
    Boolean(activeResume),
    userDecisionJobIds
  );
  const executable = getExecutableDecisions(plan);
  const evidenceContext = await getAutonomousEvidenceContext(userId, {
    profile,
    applications,
  });
  const evidenceGates = evidenceContext.evidenceGates;
  const evidenceGatedActions = countEvidenceGatedActions({
    gates: evidenceGates,
    applicationSubmissionCandidates: executable.autoApply.length,
    followUpSendCandidates: resolvedPreferences.createFollowUps ? executable.followUps.length : 0,
  });
  const applicationPreparationCandidates =
    executable.autoApply.length + executable.review.length + executable.manual.length + plan.summary.blocked;
  const profileReadinessBlockers = evidenceContext.readiness.blockers.filter((gap) => gap.key !== "resume");
  const skippedProfileReadinessActions = profileReadinessBlockers.length > 0
    ? applicationPreparationCandidates
    : 0;
  const skippedResumeEvidenceActions = activeResume ? 0 : applicationPreparationCandidates;
  const executableApplicationDecisions = activeResume && skippedProfileReadinessActions === 0
    ? executable
    : { ...executable, autoApply: [], review: [], manual: [] };
  let queuedApplicationRecords = 0;
  let queuedReviewRecords = 0;
  let queuedManualRecords = 0;
  let skippedStaleJobActions = 0;
  let skippedEmptySourceActions = 0;
  let inboxProvidersScanned = 0;
  let inboxReauthorizationRequired = 0;
  let inboxCandidatesDiscovered = 0;
  let inboxMonitoringFailures = 0;
  let completedActions = 0;
  const actionErrors: string[] = [];

  const recordFailure = (label: string) => {
    console.error(`[AutonomousService] ${label} failed for user ${userId}.`);
    actionErrors.push(`${label} failed`);
  };

  const userDecisionLockedJobs = plan.decisions.filter((decision) => decision.userDecisionLocked).length;

  // Keep autonomous scoring visible through the same canonical match ledger used by jobs.getMatches.
  for (const decision of plan.decisions) {
    assertLeaseActive();
    try {
      await createJobMatch({
        userId,
        jobId: decision.jobId,
        matchScore: decision.matchScore,
        matchReasons: autonomousMatchReasons(decision),
      });
    } catch {
      recordFailure(`Job ${decision.jobId} match persistence`);
    }
  }

  // Keep non-preparation outcomes explainable without creating a pending application record.
  for (const decision of plan.decisions) {
    if ((decision.action !== "blocked" && decision.action !== "skip") || userDecisionJobIds.has(decision.jobId)) {
      continue;
    }
    assertLeaseActive();
    try {
      await recordAutonomousTerminalDecision(userId, decision);
    } catch {
      recordFailure(`Job ${decision.jobId} terminal decision persistence`);
    }
  }

  if (evidenceGates.length > 0) {
    await createAuditEvent({
      userId,
      entityType: "user",
      entityId: userId,
      action: "autonomous_evidence_gates_detected",
      actor: "system",
      source: "autonomousService",
      afterState: JSON.stringify({
        gates: evidenceGates,
        gatedActions: evidenceGatedActions,
        externalSubmissionPerformed: false,
      }),
      riskLevel: evidenceGates.some((gate) => gate.severity === "high") ? "high" : "medium",
    });
  }

  if (skippedResumeEvidenceActions > 0) {
    await createAuditEvent({
      userId,
      entityType: "user",
      entityId: userId,
      action: "autonomous_application_preparation_blocked_missing_resume",
      actor: "system",
      source: "autonomousService",
      afterState: JSON.stringify({
        skippedApplicationPreparations: skippedResumeEvidenceActions,
        autoApplyCandidates: executable.autoApply.length,
        reviewCandidates: executable.review.length,
        manualCandidates: executable.manual.length,
        externalSubmissionPerformed: false,
      }),
      riskLevel: "high",
    });
  }

  if (skippedProfileReadinessActions > 0) {
    await createAuditEvent({
      userId,
      entityType: "user",
      entityId: userId,
      action: "autonomous_application_preparation_blocked_profile_readiness",
      actor: "system",
      source: "autonomousService",
      afterState: JSON.stringify({
        skippedApplicationPreparations: skippedProfileReadinessActions,
        blockers: profileReadinessBlockers.map((gap) => ({
          key: gap.key,
          label: gap.label,
          recommendation: gap.recommendation,
        })),
        autoApplyCandidates: executable.autoApply.length,
        reviewCandidates: executable.review.length,
        manualCandidates: executable.manual.length,
        externalSubmissionPerformed: false,
      }),
      riskLevel: "high",
    });
  }

  for (const decision of executableApplicationDecisions.autoApply) {
    assertLeaseActive();
    try {
      const currentJob = await getCurrentJobForAutonomousDecision(decision.jobId);
      if (!currentJob.job) {
        if (currentJob.blockedByEmptySource && currentJob.sourceEligibility) {
          skippedEmptySourceActions += 1;
          await recordEmptySourcePreparationBlocked(userId, decision, currentJob.sourceEligibility);
          continue;
        }
        skippedStaleJobActions += 1;
        await recordStaleJobPreparationBlocked(userId, decision);
        continue;
      }
      const job = currentJob.job;
      const draft = buildEvidenceBoundApplicationDraft(profileForMatching, job);
      const result = await createApplication({
        userId,
        jobId: decision.jobId,
        status: "pending",
        coverLetter: draft.coverLetter,
        notes: [
          "Autonomous queue: application materials prepared for final user review.",
          `Match score: ${decision.matchScore}.`,
          `Priority: ${decision.priority}.`,
          `ATS: ${decision.atsType}.`,
        ].join(" "),
        isAutoApplied: 0,
      });
      await createApplicationDecision({
        userId,
        jobId: decision.jobId,
        decision: "apply",
        decisionReason: `Autonomous plan queued ${decision.title} at ${decision.company} for final user review.`,
        matchScore: decision.matchScore,
        riskLevel: decision.blockers.length > 0 ? "high" : "medium",
        reviewRequired: decision.reviewRequired ? 1 : 0,
        reviewReason: decision.blockers.join("; ") || null,
        decidedBy: "system",
      });
      const applicationId = Number(result.insertId);
      const approval = await createApplicationApproval({
        userId,
        applicationId,
        entityType: "application",
        entityId: applicationId,
        approvalType: "application_submission",
        status: "pending",
        riskLevel: decision.blockers.length > 0 ? "high" : "medium",
        requestedBy: "system",
        title: "Approve autonomous application submission",
        description: `Autonomous plan prepared ${decision.title} at ${decision.company} for final user review.`,
        payload: JSON.stringify({
          jobId: decision.jobId,
          matchScore: decision.matchScore,
          priority: decision.priority,
          atsType: decision.atsType,
          source: "autonomous.autoApply",
        }),
      });
      await recordAutonomousApplicationLedgerArtifacts({
        userId,
        applicationId,
        decision,
        profile: profileForMatching,
        draft,
        resume: activeResume!,
        platformId: job.platformId,
        branch: "auto_apply",
        approvalId: Number(approval.insertId),
      });
      completedActions += 1;
      if (wasNewApplication(result)) queuedApplicationRecords += 1;
    } catch {
      recordFailure(`Job ${decision.jobId} preparation`);
    }
  }

  for (const decision of executableApplicationDecisions.review) {
    assertLeaseActive();
    try {
      const currentJob = await getCurrentJobForAutonomousDecision(decision.jobId);
      if (!currentJob.job) {
        if (currentJob.blockedByEmptySource && currentJob.sourceEligibility) {
          skippedEmptySourceActions += 1;
          await recordEmptySourcePreparationBlocked(userId, decision, currentJob.sourceEligibility);
          continue;
        }
        skippedStaleJobActions += 1;
        await recordStaleJobPreparationBlocked(userId, decision);
        continue;
      }
      const job = currentJob.job;
      const draft = buildEvidenceBoundApplicationDraft(profileForMatching, job);
      const result = await createApplication({
        userId,
        jobId: decision.jobId,
        status: "pending",
        coverLetter: draft.coverLetter,
        notes: [
          "Autonomous review queue.",
          `Match score: ${decision.matchScore}.`,
          `Priority: ${decision.priority}.`,
          decision.blockers.length > 0 ? `Review blockers: ${decision.blockers.join("; ")}.` : "",
        ].filter(Boolean).join(" "),
        isAutoApplied: 0,
      });
      await createApplicationDecision({
        userId,
        jobId: decision.jobId,
        decision: "review",
        decisionReason: `Autonomous plan requires review before applying to ${decision.title} at ${decision.company}.`,
        matchScore: decision.matchScore,
        riskLevel: decision.blockers.length > 0 ? "high" : "medium",
        reviewRequired: 1,
        reviewReason: decision.blockers.join("; ") || "Human review required by policy.",
        decidedBy: "system",
      });
      const applicationId = Number(result.insertId);
      const approval = await createApplicationApproval({
        userId,
        applicationId,
        entityType: "application",
        entityId: applicationId,
        approvalType: "application_submission",
        status: "pending",
        riskLevel: decision.blockers.length > 0 ? "high" : "medium",
        requestedBy: "system",
        title: "Approve reviewed application submission",
        description: `Autonomous plan requires review before applying to ${decision.title} at ${decision.company}.`,
        payload: JSON.stringify({
          jobId: decision.jobId,
          matchScore: decision.matchScore,
          priority: decision.priority,
          blockers: decision.blockers,
          source: "autonomous.review",
        }),
      });
      await recordAutonomousApplicationLedgerArtifacts({
        userId,
        applicationId,
        decision,
        profile: profileForMatching,
        draft,
        resume: activeResume!,
        platformId: job.platformId,
        branch: "review",
        approvalId: Number(approval.insertId),
      });
      completedActions += 1;
      if (wasNewApplication(result)) queuedReviewRecords += 1;
    } catch {
      recordFailure(`Job ${decision.jobId} review queue`);
    }
  }

  for (const decision of executableApplicationDecisions.manual) {
    assertLeaseActive();
    try {
      const currentJob = await getCurrentJobForAutonomousDecision(decision.jobId);
      if (!currentJob.job) {
        if (currentJob.blockedByEmptySource && currentJob.sourceEligibility) {
          skippedEmptySourceActions += 1;
          await recordEmptySourcePreparationBlocked(userId, decision, currentJob.sourceEligibility);
          continue;
        }
        skippedStaleJobActions += 1;
        await recordStaleJobPreparationBlocked(userId, decision);
        continue;
      }
      const job = currentJob.job;
      const draft = buildEvidenceBoundApplicationDraft(profileForMatching, job);
      const result = await createApplication({
        userId,
        jobId: decision.jobId,
        status: "pending",
        coverLetter: draft.coverLetter,
        notes: `Autonomous manual apply queue. Unsupported ATS/platform: ${decision.atsType}. Match score: ${decision.matchScore}.`,
        isAutoApplied: 0,
      });
      await createApplicationDecision({
        userId,
        jobId: decision.jobId,
        decision: "manual_apply",
        decisionReason: `Autonomous plan prepared a manual application task for ${decision.title} at ${decision.company}.`,
        matchScore: decision.matchScore,
        riskLevel: "high",
        reviewRequired: 1,
        reviewReason: `Unsupported ATS/platform: ${decision.atsType}.`,
        decidedBy: "system",
      });
      const applicationId = Number(result.insertId);
      const approval = await createApplicationApproval({
        userId,
        applicationId,
        entityType: "application",
        entityId: applicationId,
        approvalType: "application_submission",
        status: "pending",
        riskLevel: "high",
        requestedBy: "system",
        title: "Approve manual application handoff",
        description: `Unsupported ATS/platform ${decision.atsType} requires manual application approval for ${decision.title} at ${decision.company}.`,
        payload: JSON.stringify({
          jobId: decision.jobId,
          matchScore: decision.matchScore,
          priority: decision.priority,
          atsType: decision.atsType,
          source: "autonomous.manual",
        }),
      });
      await recordAutonomousApplicationLedgerArtifacts({
        userId,
        applicationId,
        decision,
        profile: profileForMatching,
        draft,
        resume: activeResume!,
        platformId: job.platformId,
        branch: "manual",
        approvalId: Number(approval.insertId),
      });
      completedActions += 1;
      if (wasNewApplication(result)) queuedManualRecords += 1;
    } catch {
      recordFailure(`Job ${decision.jobId} manual queue`);
    }
  }

  let queuedFollowUps = 0;
  let skippedDuplicateFollowUps = 0;
  let skippedSafetyBlockedFollowUps = 0;
  if (resolvedPreferences.createFollowUps) {
    const followUpApplicationIds = executable.followUps.map((followUp) => followUp.applicationId);
    const interviewApplicationIds = executable.followUps
      .filter((followUp) => followUp.status === "interview")
      .map((followUp) => followUp.applicationId);
    const [followUpResponses, interviewSchedules, existingFollowUps] = await Promise.all([
      getUserEmployerResponsesForApplications(userId, followUpApplicationIds),
      getUserInterviewSchedulesForApplications(userId, interviewApplicationIds),
      getUserFollowUpsForApplications(userId, followUpApplicationIds),
    ]);
    const responsesByApplication = groupApplicationEvidence(followUpResponses);
    const schedulesByApplication = groupApplicationEvidence(interviewSchedules);
    const followUpsByApplication = groupApplicationEvidence(existingFollowUps);

    for (const followUp of executable.followUps) {
      assertLeaseActive();
      try {
        const safetyBlock = await getAutonomousFollowUpSafetyBlock(
          followUp,
          responsesByApplication.get(followUp.applicationId) ?? [],
          schedulesByApplication.get(followUp.applicationId) ?? []
        );
        if (safetyBlock) {
          skippedSafetyBlockedFollowUps += 1;
          await createAuditEvent({
            userId,
            entityType: "application",
            entityId: followUp.applicationId,
            action: "autonomous_follow_up_safety_blocked",
            actor: "system",
            source: "autonomousService",
            afterState: JSON.stringify({
              applicationId: followUp.applicationId,
              jobId: followUp.jobId,
              status: followUp.status,
              reason: safetyBlock,
              externalMessageSent: false,
            }),
            riskLevel: "medium",
          });
          continue;
        }

        const applicationFollowUps = followUpsByApplication.get(followUp.applicationId) ?? [];
        const cooldownStartedAt = Date.now() - 5 * 86400000;
        const hasBlockingFollowUp = applicationFollowUps.some((existing) =>
          !existing.sentDate ||
          Boolean(existing.sentDate && new Date(existing.sentDate).getTime() >= cooldownStartedAt) ||
          existing.responseReceived === 1
        );
        if (hasBlockingFollowUp) {
          skippedDuplicateFollowUps += 1;
          continue;
        }

        assertLeaseActive();
        const email = await generateFollowUpEmail(followUp.applicationId, followUp.messageType, userId);
        assertLeaseActive();
        await createFollowUp({
          applicationId: followUp.applicationId,
          message: email,
        }, userId);
        completedActions += 1;
        queuedFollowUps += 1;
      } catch {
        recordFailure(`Application ${followUp.applicationId} follow-up`);
      }
    }
  }

  // Read-only inbox monitoring is consent-gated and only creates pending review candidates.
  assertLeaseActive();
  const inboxMonitoring = await monitorInboxResponses(userId);
  inboxProvidersScanned = inboxMonitoring.providersScanned;
  inboxReauthorizationRequired = inboxMonitoring.inboxReauthorizationRequired;
  inboxCandidatesDiscovered = inboxMonitoring.candidatesDiscovered;
  inboxMonitoringFailures = inboxMonitoring.monitoringFailures;

  if (actionErrors.length > 0 && completedActions === 0) {
    throw new Error(`Autonomous run failed all actions (${actionErrors.length} failures).`);
  }

  return {
    ...plan,
    queuedApplicationRecords,
    queuedReviewRecords,
    queuedManualRecords,
    queuedFollowUps,
    skippedDuplicateFollowUps,
    skippedSafetyBlockedFollowUps,
    skippedResumeEvidenceActions,
    skippedProfileReadinessActions,
    skippedEvidenceGatedActions: evidenceGatedActions.total,
    skippedStaleJobActions,
    skippedEmptySourceActions,
    userDecisionLockedJobs,
    inboxProvidersScanned,
    inboxReauthorizationRequired,
    inboxCandidatesDiscovered,
    inboxMonitoringFailures,
    evidenceGates,
    failedActions: actionErrors.length,
    actionErrors,
  };
}

export function runAutonomousForUser(
  userId: number,
  overrides: AutonomousPreferences = {}
): Promise<AutonomousRunResult> {
  const activeRun = activeRuns.get(userId);
  if (activeRun) {
    if (Object.keys(overrides).length > 0) {
      return activeRun.then(
        () => runAutonomousForUser(userId, overrides),
        () => runAutonomousForUser(userId, overrides)
      );
    }
    return activeRun.then((result) =>
      result ?? runAutonomousForUser(userId, overrides)
    );
  }

  return activeRuns.track(
    userId,
    runWithLease(userId, overrides, 0, false)
  ).then((result) => {
    if (!result) {
      throw new Error("The autonomous run ended without a result.");
    }
    return result;
  });
}

export async function runScheduledAutonomousForUser(
  userId: number,
  minimumIntervalMs: number
): Promise<AutonomousRunResult | null> {
  if (activeRuns.has(userId)) return null;

  return await activeRuns.track(
    userId,
    runWithLease(userId, {}, minimumIntervalMs, true)
  );
}

async function runWithLease(
  userId: number,
  overrides: AutonomousPreferences,
  minimumIntervalMs: number,
  skipIfUnavailable: boolean
): Promise<AutonomousRunResult | null> {
  const eligibility = await getAutonomousUserEligibility(userId);
  if (!eligibility.eligible) {
    if (skipIfUnavailable) return null;
    throw new Error(eligibility.reason || "This account is not eligible for autonomous actions.");
  }

  const campaignBlock = await getCampaignExecutionBlock(userId);
  if (campaignBlock) {
    if (skipIfUnavailable) return null;
    throw new Error(campaignBlock);
  }

  if (skipIfUnavailable) {
    const profile = await getUserProfile(userId);
    const preferences = parseAutonomousPreferences(profile?.preferences);
    if (!preferences.autonomousEnabled) {
      return null;
    }
  }

  const leaseToken = randomUUID();
  const acquired = await acquireAutonomousRunLease(userId, leaseToken, minimumIntervalMs);
  if (!acquired) {
    if (skipIfUnavailable) return null;
    throw new Error("An autonomous run is already active for this account.");
  }

  const campaignBlockAfterLease = await getCampaignExecutionBlock(userId);
  if (campaignBlockAfterLease) {
    await skipAutonomousRunLease(userId, leaseToken, campaignBlockAfterLease);
    if (skipIfUnavailable) return null;
    throw new Error(campaignBlockAfterLease);
  }

  if (skipIfUnavailable) {
    try {
      const profile = await getUserProfile(userId);
      const preferences = parseAutonomousPreferences(profile?.preferences);
      if (!preferences.autonomousEnabled) {
        await skipAutonomousRunLease(
          userId,
          leaseToken,
          "Autonomous scheduling was disabled before execution started."
        );
        return null;
      }
    } catch {
      try {
        await completeAutonomousRunLease(userId, leaseToken, AUTONOMOUS_RUN_FAILURE);
      } catch {
        console.error(`[AutonomousService] Failed to release preflight lease for user ${userId}.`);
      }
      throw new Error(AUTONOMOUS_RUN_FAILURE);
    }
  }

  const executionGuard = new AutonomousExecutionGuard();
  const leaseRenewal = setInterval(() => {
    void renewAutonomousRunLease(userId, leaseToken)
      .then((renewed) => {
        if (!renewed) {
          executionGuard.markLeaseLost();
          console.error(`[AutonomousService] Lease ownership lost for user ${userId}.`);
        }
      })
      .catch(() => {
        executionGuard.markLeaseLost(
          "The autonomous run stopped because its execution lease could not be verified."
        );
        console.error(`[AutonomousService] Failed to renew lease for user ${userId}.`);
      });
  }, 5 * 60 * 1000);
  leaseRenewal.unref();

  try {
    let result: AutonomousRunResult;
    try {
      result = await executeAutonomousRun(
        userId,
        overrides,
        () => executionGuard.assertLeaseActive()
      );
      executionGuard.assertLeaseActive();
    } catch {
      try {
        await completeAutonomousRunLease(userId, leaseToken, AUTONOMOUS_RUN_FAILURE);
      } catch {
        console.error(`[AutonomousService] Failed to finalize failed run for user ${userId}.`);
      }
      throw new Error(AUTONOMOUS_RUN_FAILURE);
    }

    try {
      const completed = await completeAutonomousRunLease(
        userId,
        leaseToken,
        undefined,
        persistableRunSummary(result)
      );
      if (!completed) {
        throw new Error("The autonomous run lost its execution lease before completion.");
      }
      await getUserOperatingLedger(userId);
    } catch {
      console.error(`[AutonomousService] Failed to finalize successful run for user ${userId}.`);
      throw new Error("Autonomous actions completed, but the run state could not be finalized.");
    }
    return result;
  } finally {
    clearInterval(leaseRenewal);
  }
}
