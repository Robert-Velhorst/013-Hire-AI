import type {
  Application,
  ApplicationApproval,
  EmployerResponse,
  FollowUp,
  InterviewSchedule,
  UserProfile,
} from "../drizzle/schema";
import {
  getActiveJobs,
  getApplicationCampaign,
  getEducationEntries,
  getUnreadInterviewNotificationPage,
  getPendingInboxResponseCandidatePage,
  countUserAutonomousPreparationsSince,
  getUserApplicationPage,
  getUserApplicationSummary,
  getUserApplications,
  getUserApplicationsByIds,
  getUserApplicationsForJobs,
  getUserOperatingApplicationWindow,
  getUserApplicationDecisionsForJobs,
  getUserReviewDecisionPage,
  getUserOperatingApplicationApprovals,
  getUserEmployerResponsesForApplications,
  getUserProfile,
  getUserOfferAttributionReviewPage,
  getUserSuccessFeeOperatingItems,
  getUserSuccessFeeSummary,
  getUserSkills,
  getWorkExperiences,
  listUserConnectorAccounts,
  getUserAdminReviewPage,
  upsertApplicationCampaign,
} from "./db";
import {
  buildAutonomousPlan,
  parseAutonomousPreferences,
  type AutonomousPreferences,
} from "./autonomousOrchestrator";
import { calculateProfileReadiness } from "./profileReadiness";
import { getActiveResume } from "./resumeStorage";
import {
  getProfileEvidenceControlSummary,
  type ProfileEvidenceProvider,
} from "@shared/profileEvidence";
import { buildAutonomousEvidenceGates } from "@shared/autonomousEvidenceGates";
import { resolveProfileCandidateEvidence } from "@shared/profileSkillEvidence";
import {
  getUpcomingInterviewPreparationPage,
  getEmployerResponseReplyPage,
  getFollowUpDeliveryOperatingQueues,
  getFollowUpDraftingPage,
  getInterviewOutcomePage,
  getInterviewSchedulingPage,
  getUserFollowUpsForApplications,
  getUserInterviewSchedulesForApplications,
} from "./applicationFeatures";
import {
  getSuccessFeeComplianceQueue,
  getSuccessFeeComplianceSummaryFromAggregates,
} from "./successFeeCompliance";
import { getInterviewSchedulingRequirement } from "./interviewScheduling";

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function getLocationPolicyNextActions(plan: { nextActions: string[] }) {
  return plan.nextActions.filter((action) =>
    /^Excluded \d+ hybrid or on-site role(?:s)? under the remote-only campaign policy\.$/.test(action) ||
    /^Review \d+ role(?:s)? with unverified remote eligibility before preparation\.$/.test(action)
  );
}

function applicationStatusCount(
  applications: Array<{ status?: Application["status"] | null }>,
  statuses: string[]
): number {
  return applications.filter((application) => statuses.includes(application.status || "pending")).length;
}

function campaignTitle(profile?: Pick<UserProfile, "desiredJobTypes"> | null): string {
  const target = profile?.desiredJobTypes
    ?.split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)[0];
  return target ? `${target} campaign` : "Active job-search campaign";
}

type UserApplicationRecord = Awaited<ReturnType<typeof getUserApplications>>[number];

interface OperatingApplicationEvidence {
  followUpsByApplication: Map<number, FollowUp[]>;
  responsesByApplication: Map<number, EmployerResponse[]>;
  schedulesByApplication: Map<number, InterviewSchedule[]>;
}

function groupByApplicationId<T extends { applicationId: number }>(items: T[]) {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const existing = grouped.get(item.applicationId) ?? [];
    existing.push(item);
    grouped.set(item.applicationId, existing);
  }
  return grouped;
}

async function loadOperatingApplicationEvidence(
  applications: UserApplicationRecord[],
  userId: number
): Promise<OperatingApplicationEvidence> {
  const applicationIds = applications.map((application) => application.id);
  const [followUps, responses, schedules] = await Promise.all([
    getUserFollowUpsForApplications(userId, applicationIds),
    getUserEmployerResponsesForApplications(userId, applicationIds),
    getUserInterviewSchedulesForApplications(userId, applicationIds),
  ]);
  return {
    followUpsByApplication: groupByApplicationId(followUps),
    responsesByApplication: groupByApplicationId(responses),
    schedulesByApplication: groupByApplicationId(schedules),
  };
}

interface FollowUpDeliveryWorkItem {
  followUpId: number;
  applicationId: number;
  jobId: number;
  approvalId: number;
  approvalTitle: string;
  riskLevel: string;
  purpose: string;
  sourceResponseId: number | null;
  responseType: string | null;
  messagePreview: string;
  approvedAt: Date | null;
  deliveryState: "draft" | "sending" | "sent" | "failed" | "unknown";
  deliveryProvider: "gmail" | "outlook" | null;
  deliveryRecipient: string | null;
  deliveryFailureMessage: string | null;
  job: {
    id: number;
    title: string;
    company: string;
    location: string | null;
  } | null;
}

interface FollowUpSuppressionState {
  applicationsWithActiveDrafts: Set<number>;
  sourceResponsesWithActiveDrafts: Set<number>;
  approvedFollowUpsReadyToSend: FollowUpDeliveryWorkItem[];
  followUpDeliveryReconciliation: FollowUpDeliveryWorkItem[];
}

function parseFollowUpApprovalPayload(approval: Pick<ApplicationApproval, "payload">): {
  purpose?: string;
  sourceResponseId?: number | null;
  responseType?: string | null;
  message?: string | null;
} {
  if (!approval.payload) return {};

  try {
    const parsed = JSON.parse(approval.payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      purpose: typeof parsed.purpose === "string" ? parsed.purpose : undefined,
      sourceResponseId: typeof parsed.sourceResponseId === "number" ? parsed.sourceResponseId : null,
      responseType: typeof parsed.responseType === "string" ? parsed.responseType : null,
      message: typeof parsed.message === "string" ? parsed.message : null,
    };
  } catch {
    return {};
  }
}

function isActiveFollowUpSendApproval(approval: ApplicationApproval) {
  return (
    approval.entityType === "follow_up" &&
    approval.approvalType === "follow_up_send" &&
    ["pending", "approved"].includes(approval.status)
  );
}

function getFollowUpDeliveryWorkItem(
  application: UserApplicationRecord,
  followUp: FollowUp,
  approval: ApplicationApproval,
  payload: ReturnType<typeof parseFollowUpApprovalPayload>
): FollowUpDeliveryWorkItem {
  const message = followUp.message || payload.message || "";
  return {
    followUpId: followUp.id,
    applicationId: application.id,
    jobId: application.jobId,
    approvalId: approval.id,
    approvalTitle: approval.title,
    riskLevel: approval.riskLevel,
    purpose: payload.purpose || "routine_follow_up",
    sourceResponseId: payload.sourceResponseId ?? null,
    responseType: payload.responseType ?? null,
    messagePreview: message.length > 180 ? `${message.slice(0, 177)}...` : message,
    approvedAt: approval.decidedAt ?? null,
    deliveryState: followUp.deliveryState || "draft",
    deliveryProvider: followUp.deliveryProvider || null,
    deliveryRecipient: followUp.deliveryRecipient || null,
    deliveryFailureMessage: followUp.deliveryFailureMessage || null,
    job: application.job?.id != null && application.job.title != null && application.job.company != null ? {
      id: application.job.id,
      title: application.job.title,
      company: application.job.company,
      location: application.job.location,
    } : null,
  };
}

async function getFollowUpSuppressionState(
  applications: UserApplicationRecord[],
  approvals: ApplicationApproval[],
  evidence: OperatingApplicationEvidence
): Promise<FollowUpSuppressionState> {
  const activeFollowUpApprovalById = new Map(
    approvals
      .filter(isActiveFollowUpSendApproval)
      .map((approval) => [approval.entityId, approval])
  );
  const state: FollowUpSuppressionState = {
    applicationsWithActiveDrafts: new Set(),
    sourceResponsesWithActiveDrafts: new Set(),
    approvedFollowUpsReadyToSend: [],
    followUpDeliveryReconciliation: [],
  };

  if (activeFollowUpApprovalById.size === 0) return state;

  for (const application of applications) {
    const followUps = evidence.followUpsByApplication.get(application.id) ?? [];
    if (!["applied", "viewed", "interview"].includes(application.status || "pending")) {
      continue;
    }
    for (const followUp of followUps as FollowUp[]) {
      if (followUp.sentDate) continue;

      const approval = activeFollowUpApprovalById.get(followUp.id);
      if (!approval) continue;

      state.applicationsWithActiveDrafts.add(application.id);
      const payload = parseFollowUpApprovalPayload(approval);
      if (payload.purpose === "employer_reply" && typeof payload.sourceResponseId === "number") {
        state.sourceResponsesWithActiveDrafts.add(payload.sourceResponseId);
      }
      if (approval.status === "approved") {
        const workItem = getFollowUpDeliveryWorkItem(application, followUp, approval, payload);
        if (["sending", "unknown"].includes(workItem.deliveryState)) {
          state.followUpDeliveryReconciliation.push(workItem);
        } else {
          state.approvedFollowUpsReadyToSend.push(workItem);
        }
      }
    }
  }

  state.approvedFollowUpsReadyToSend.sort((a, b) =>
    (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0)
  );
  state.followUpDeliveryReconciliation.sort((a, b) =>
    (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0)
  );
  return state;
}

function getInterviewSchedulingQueue(
  applications: UserApplicationRecord[],
  evidence: OperatingApplicationEvidence
) {
  const interviewApplications = applications.filter((application) => application.status === "interview");
  const schedulingState = interviewApplications.map((application) => ({
    application,
    schedulingRequirement: getInterviewSchedulingRequirement(
      evidence.schedulesByApplication.get(application.id) ?? [],
      evidence.responsesByApplication.get(application.id) ?? []
    ),
  }));

  return schedulingState
    .filter((item) => item.schedulingRequirement !== null)
    .map(({ application, schedulingRequirement }) => ({
      applicationId: application.id,
      jobId: application.jobId,
      status: application.status,
      lastActivity: application.lastActivity,
      schedulingRequirement,
      job: application.job ? {
        id: application.job.id,
        title: application.job.title,
        company: application.job.company,
        location: application.job.location,
      } : null,
    }));
}

async function getInterviewNotificationQueue(
  userId: number
) {
  return await getUnreadInterviewNotificationPage(userId);
}

function getEmployerResponseQueue(
  applications: UserApplicationRecord[],
  suppressionState: FollowUpSuppressionState,
  evidence: OperatingApplicationEvidence
) {
  const actionableStatuses = new Set(["applied", "viewed", "interview"]);
  const responseState = applications.map((application) => {
    if (!actionableStatuses.has(application.status || "pending")) {
      return null;
    }

    const responses = evidence.responsesByApplication.get(application.id) ?? [];
    const latestResponse = responses[0];
    if (
      !latestResponse ||
      !["employer_question", "other"].includes(latestResponse.responseType) ||
      suppressionState.sourceResponsesWithActiveDrafts.has(latestResponse.id)
    ) {
      return null;
    }

    return {
      applicationId: application.id,
      jobId: application.jobId,
      responseId: latestResponse.id,
      responseType: latestResponse.responseType,
      source: latestResponse.source,
      summary: latestResponse.summary,
      receivedAt: latestResponse.receivedAt,
      status: application.status,
      job: application.job ? {
        id: application.job.id,
        title: application.job.title,
        company: application.job.company,
        location: application.job.location,
      } : null,
    };
  });

  return responseState.filter((item): item is NonNullable<typeof item> => item !== null);
}

function getFollowUpDueQueue(
  applications: UserApplicationRecord[],
  plan: ReturnType<typeof buildAutonomousPlan>,
  excludedApplicationIds: Set<number> = new Set(),
  suppressionState: FollowUpSuppressionState = {
    applicationsWithActiveDrafts: new Set(),
    sourceResponsesWithActiveDrafts: new Set(),
    approvedFollowUpsReadyToSend: [],
    followUpDeliveryReconciliation: [],
  }
) {
  const applicationsById = new Map(applications.map((application) => [application.id, application]));
  return plan.followUps
    .filter((followUp) =>
      followUp.action === "send_follow_up" &&
      !excludedApplicationIds.has(followUp.applicationId) &&
      !suppressionState.applicationsWithActiveDrafts.has(followUp.applicationId)
    )
    .map((followUp) => {
      const application = applicationsById.get(followUp.applicationId);
      return {
        applicationId: followUp.applicationId,
        jobId: followUp.jobId,
        status: followUp.status,
        messageType: followUp.messageType,
        daysSinceActivity: followUp.daysSinceActivity,
        reason: followUp.reason,
        job: application?.job ? {
          id: application.job.id,
          title: application.job.title,
          company: application.job.company,
          location: application.job.location,
        } : null,
      };
    });
}

/**
 * Follow-up timing alone is not enough to make a draft actionable. Keep the
 * same response, interview, and active-draft suppression used by the ledger
 * available to every autonomous planning surface.
 */
export async function getAutonomousFollowUpReadiness({
  applications,
  approvals,
  plan,
  userId,
  evidence: suppliedEvidence,
}: {
  applications: UserApplicationRecord[];
  approvals: ApplicationApproval[];
  plan: ReturnType<typeof buildAutonomousPlan>;
  userId: number;
  evidence?: OperatingApplicationEvidence;
}) {
  const candidateCount = plan.summary.followUpsDue;
  const evidence = suppliedEvidence ?? await loadOperatingApplicationEvidence(applications, userId);
  const suppressionState = await getFollowUpSuppressionState(applications, approvals, evidence);
  const interviewSchedulingQueue = getInterviewSchedulingQueue(applications, evidence);
  const interviewOutcomeQueue = getInterviewOutcomeQueue(applications, evidence);
  const employerResponseQueue = getEmployerResponseQueue(
    applications,
    suppressionState,
    evidence
  );
  const excludedApplicationIds = new Set([
    ...interviewSchedulingQueue.map((item) => item.applicationId),
    ...interviewOutcomeQueue.map((item) => item.applicationId),
    ...employerResponseQueue.map((item) => item.applicationId),
  ]);
  const actionReadyQueue = candidateCount > 0
    ? getFollowUpDueQueue(applications, plan, excludedApplicationIds, suppressionState)
    : [];

  return {
    candidateCount,
    actionReadyCount: actionReadyQueue.length,
    blockedCount: Math.max(0, candidateCount - actionReadyQueue.length),
    actionReadyQueue,
    suppressionState,
    interviewSchedulingQueue,
    interviewOutcomeQueue,
    employerResponseQueue,
  };
}

export function getActionReadyFollowUpNextActions(
  plan: ReturnType<typeof buildAutonomousPlan>,
  readiness: Pick<Awaited<ReturnType<typeof getAutonomousFollowUpReadiness>>, "actionReadyCount" | "blockedCount">
): string[] {
  if (plan.summary.followUpsDue === 0) return plan.nextActions;

  const followUpAction = readiness.actionReadyCount > 0
    ? `Draft ${readiness.actionReadyCount} timely follow-up message${readiness.actionReadyCount === 1 ? "" : "s"}.`
    : readiness.blockedCount > 0
      ? `${readiness.blockedCount} follow-up candidate${readiness.blockedCount === 1 ? " is" : "s are"} held by an existing draft, response, or interview workflow.`
      : "";

  return unique([
    ...plan.nextActions.filter((action) => !action.startsWith("Draft ")),
    followUpAction,
  ]);
}

async function getInterviewPreparationQueue(userId: number) {
  const page = await getUpcomingInterviewPreparationPage(userId);
  return {
    ...page,
    items: page.items.map((item) => ({
      interviewId: item.interview.id,
      applicationId: item.application.id,
      jobId: item.application.jobId,
      scheduledAt: item.interview.scheduledAt,
      interviewType: item.interview.interviewType,
      status: item.interview.status,
      job: item.job ? {
        id: item.job.id,
        title: item.job.title,
        company: item.job.company,
      } : null,
    })),
  };
}

function getInterviewOutcomeQueue(
  applications: UserApplicationRecord[],
  evidence: OperatingApplicationEvidence
) {
  const interviewApplications = applications.filter((application) => application.status === "interview");
  const outcomeState = interviewApplications.map((application) => {
    const schedules = evidence.schedulesByApplication.get(application.id) ?? [];
    const responses = evidence.responsesByApplication.get(application.id) ?? [];
    const recordedOutcomeInterviewIds = new Set(
      responses
        .map((response) => response.interviewId)
        .filter((interviewId): interviewId is number => typeof interviewId === "number")
    );
    return schedules
      .filter((schedule) => schedule.status === "completed" && !recordedOutcomeInterviewIds.has(schedule.id))
      .map((schedule) => ({
        interviewId: schedule.id,
        applicationId: application.id,
        jobId: application.jobId,
        completedAt: schedule.updatedAt,
        interviewType: schedule.interviewType,
        status: application.status,
        job: application.job ? {
          id: application.job.id,
          title: application.job.title,
          company: application.job.company,
          location: application.job.location,
        } : null,
      }));
  });

  return outcomeState.flat();
}

function activeResponseApplicationCount(applications: UserApplicationRecord[]) {
  return applications.filter((application) =>
    ["applied", "viewed", "interview"].includes(application.status || "pending")
  ).length;
}

function providerIsConnected(provider?: ProfileEvidenceProvider) {
  return provider?.status === "connected";
}

function providerNeedsCompletion(provider: ProfileEvidenceProvider) {
  return provider.connectionStatus === "connection_requested" ||
    provider.connectionStatus === "needs_reauth" ||
    provider.authorizationIncomplete === true;
}

function connectorReadinessItem(input: {
  id: string;
  label: string;
  detail: string;
  providerIds: string[];
  status: string;
  riskLevel?: "low" | "medium" | "high";
  affectedApplications?: number;
}) {
  return {
    ...input,
    riskLevel: input.riskLevel ?? "medium",
    route: "/profile",
  };
}

export function getConnectorReadinessQueue(input: {
  profile: UserProfile | null | undefined;
  applications: UserApplicationRecord[];
  providers: ProfileEvidenceProvider[];
  hasActiveResumeArtifact: boolean;
}) {
  const providerById = new Map(input.providers.map((provider) => [provider.id, provider]));
  const items = input.providers
    .filter((provider) =>
      ["inbox", "cloud_storage"].includes(provider.category) &&
      providerNeedsCompletion(provider)
    )
    .map((provider) => connectorReadinessItem({
      id: provider.id,
      label: `${provider.label} setup`,
      detail: provider.detail,
      providerIds: [provider.id],
      status: provider.connectionStatus || provider.status,
      riskLevel: provider.category === "inbox" ? "medium" : "low",
    }));

  const hasConnectedInbox = ["gmail", "outlook"].some((providerId) => {
    const provider = providerById.get(providerId as ProfileEvidenceProvider["id"]);
    return providerIsConnected(provider);
  });
  const responseApplications = activeResponseApplicationCount(input.applications);
  if (responseApplications > 0 && !hasConnectedInbox) {
    items.push(connectorReadinessItem({
      id: "inbox-response-monitoring",
      label: "Inbox response monitoring",
      detail: `Connect Gmail or Outlook before Hire.AI can scan for application-linked replies across ${responseApplications} active application${responseApplications === 1 ? "" : "s"}. Detected messages stay pending until you confirm them.`,
      providerIds: ["gmail", "outlook"],
      status: "not_connected",
      riskLevel: "medium",
      affectedApplications: responseApplications,
    }));
  }

  const hasResumeEvidence = input.hasActiveResumeArtifact;
  const hasConnectedCloud = ["google_drive", "dropbox"].some((providerId) => {
    const provider = providerById.get(providerId as ProfileEvidenceProvider["id"]);
    return providerIsConnected(provider);
  });
  if (!hasResumeEvidence && !hasConnectedCloud) {
    items.push(connectorReadinessItem({
      id: "cloud-resume-discovery",
      label: "Cloud resume discovery",
      detail: "Connect Google Drive or Dropbox, or upload a resume, before Hire.AI can discover candidate documents.",
      providerIds: ["google_drive", "dropbox"],
      status: "not_connected",
      riskLevel: "medium",
    }));
  }

  return items.slice(0, 5);
}

export interface OperatingLedgerOptions {
  includeAdminReviews?: boolean;
  persistCampaign?: boolean;
}

export async function getUserAutonomousPlanPreview(
  userId: number,
  overrides: AutonomousPreferences = {}
) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [
    profile,
    workExperiences,
    educationEntries,
    skills,
    applicationWindow,
    jobs,
    autonomousPreparationsToday,
    connectorAccounts,
    activeResume,
  ] = await Promise.all([
    getUserProfile(userId),
    getWorkExperiences(userId),
    getEducationEntries(userId),
    getUserSkills(userId),
    getUserOperatingApplicationWindow(userId),
    getActiveJobs(250, 0),
    countUserAutonomousPreparationsSince(userId, startOfToday),
    listUserConnectorAccounts(userId),
    getActiveResume(userId),
  ]);
  const jobIds = jobs.map((job) => job.id);
  const [currentJobApplications, decisions] = await Promise.all([
    getUserApplicationsForJobs(userId, jobIds),
    getUserApplicationDecisionsForJobs(userId, jobIds),
  ]);
  const initialApplications = Array.from(new Map(
    [...applicationWindow.items, ...currentJobApplications]
      .map((application) => [application.id, application] as const)
  ).values()) as UserApplicationRecord[];
  const approvalSet = await getUserOperatingApplicationApprovals(
    userId,
    initialApplications.map((application) => application.id)
  );
  const approvalApplicationIds = approvalSet.items.flatMap((approval) => {
    const applicationId = approval.applicationId ??
      (approval.entityType === "application" ? approval.entityId : null);
    return applicationId ? [applicationId] : [];
  });
  const approvalApplications = await getUserApplicationsByIds(userId, approvalApplicationIds);
  const applications = Array.from(new Map(
    [...initialApplications, ...approvalApplications]
      .map((application) => [application.id, application] as const)
  ).values()) as UserApplicationRecord[];

  const readiness = calculateProfileReadiness({
    profile: profile ?? undefined,
    workExperiences,
    educationEntries,
    skills,
    hasActiveResumeArtifact: Boolean(activeResume),
  });
  const profileForMatching = resolveProfileCandidateEvidence(profile, skills, workExperiences);
  const profileEvidence = getProfileEvidenceControlSummary({
    profile,
    readiness,
    hasActiveResumeArtifact: Boolean(activeResume),
    connectorAccounts: connectorAccounts.map((account) => ({
      provider: account.provider,
      status: account.status,
      externalAccountLabel: account.externalAccountLabel,
      consentScopes: account.consentScopes,
      lastVerifiedAt: account.lastVerifiedAt,
    })),
  });
  const connectorReadiness = getConnectorReadinessQueue({
    profile,
    applications,
    providers: profileEvidence.providers,
    hasActiveResumeArtifact: Boolean(activeResume),
  });
  const evidenceGates = buildAutonomousEvidenceGates({ profileEvidence, connectorReadiness });
  const resolvedPreferences = {
    ...parseAutonomousPreferences(profile?.preferences),
    ...overrides,
  };
  const plan = buildAutonomousPlan(
    jobs,
    profileForMatching,
    applications as Application[],
    resolvedPreferences,
    readiness.signals.hasResume,
    decisions
      .filter((decision) => decision.decidedBy === "user")
      .map((decision) => decision.jobId),
    { autonomousPreparationsToday }
  );
  const followUpReadiness = await getAutonomousFollowUpReadiness({
    applications,
    approvals: approvalSet.items,
    plan,
    userId,
  });

  return {
    ...plan,
    summary: {
      ...plan.summary,
      followUpsActionReady: followUpReadiness.actionReadyCount,
      followUpsBlocked: followUpReadiness.blockedCount,
    },
    nextActions: getActionReadyFollowUpNextActions(plan, followUpReadiness),
    profileEvidence,
    connectorReadiness,
    evidenceGates,
    operatingScope: {
      applicationsLoaded: applications.length,
      applicationLimit: applicationWindow.limit,
      applicationsTruncated: applicationWindow.hasMore,
      jobsLoaded: jobs.length,
      pendingApprovalsLoaded: approvalSet.items.filter((approval) => approval.status === "pending").length,
      pendingApprovalsTotal: approvalSet.pendingTotal,
      pendingApprovalsTruncated: approvalSet.pendingHasMore,
    },
  };
}

export async function getUserOperatingLedger(userId: number, options: OperatingLedgerOptions = {}) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [
    profile,
    workExperiences,
    educationEntries,
    skills,
    applicationWindow,
    recentApplicationPage,
    applicationSummary,
    autonomousPreparationsToday,
    jobs,
    adminReviewPage,
    reviewDecisionPage,
    successFeeSummary,
    offerAttributionPage,
    connectorAccounts,
    activeResume,
    inboxResponseCandidatePage,
    existingCampaign,
  ] = await Promise.all([
    getUserProfile(userId),
    getWorkExperiences(userId),
    getEducationEntries(userId),
    getUserSkills(userId),
    getUserOperatingApplicationWindow(userId),
    getUserApplicationPage(userId, { limit: 10 }),
    getUserApplicationSummary(userId),
    countUserAutonomousPreparationsSince(userId, startOfToday),
    getActiveJobs(250, 0),
    options.includeAdminReviews
      ? getUserAdminReviewPage(userId, ["open", "in_progress"], 5)
      : Promise.resolve({ items: [], total: 0, limit: 5, hasMore: false }),
    getUserReviewDecisionPage(userId, 5),
    getUserSuccessFeeSummary(userId),
    getUserOfferAttributionReviewPage(userId, 5),
    listUserConnectorAccounts(userId),
    getActiveResume(userId),
    getPendingInboxResponseCandidatePage(userId),
    getApplicationCampaign(userId),
  ]);
  const [currentJobApplications, currentJobDecisions] = await Promise.all([
    getUserApplicationsForJobs(userId, jobs.map((job) => job.id)),
    getUserApplicationDecisionsForJobs(userId, jobs.map((job) => job.id)),
  ]);
  const initialApplications = Array.from(new Map(
    [...applicationWindow.items, ...currentJobApplications]
      .map((application) => [application.id, application] as const)
  ).values()) as UserApplicationRecord[];
  const approvalSet = await getUserOperatingApplicationApprovals(
    userId,
    initialApplications.map((application) => application.id)
  );
  const approvalApplicationIds = approvalSet.items.flatMap((approval) => {
    const applicationId = approval.applicationId ??
      (approval.entityType === "application" ? approval.entityId : null);
    return applicationId ? [applicationId] : [];
  });
  const approvalApplications = await getUserApplicationsByIds(userId, approvalApplicationIds);
  const applications = Array.from(new Map(
    [...initialApplications, ...approvalApplications]
      .map((application) => [application.id, application] as const)
  ).values()) as UserApplicationRecord[];
  const decisions = Array.from(new Map(
    [...reviewDecisionPage.items, ...currentJobDecisions]
      .map((decision) => [decision.id, decision] as const)
  ).values());
  const allApprovals = approvalSet.items;
  const approvals = allApprovals.filter((approval) => approval.status === "pending");
  const pendingApprovalCount = approvalSet.pendingTotal;
  const campaignStatus = existingCampaign?.status ?? "active";

  const readiness = calculateProfileReadiness({
    profile: profile ?? undefined,
    workExperiences,
    educationEntries,
    skills,
    hasActiveResumeArtifact: Boolean(activeResume),
  });
  const profileEvidence = getProfileEvidenceControlSummary({
    profile,
    readiness,
    hasActiveResumeArtifact: Boolean(activeResume),
    connectorAccounts: connectorAccounts.map((account) => ({
      provider: account.provider,
      status: account.status,
      externalAccountLabel: account.externalAccountLabel,
      consentScopes: account.consentScopes,
      lastVerifiedAt: account.lastVerifiedAt,
    })),
  });
  const preferences = parseAutonomousPreferences(profile?.preferences);
  const profileForMatching = resolveProfileCandidateEvidence(profile, skills, workExperiences);
  const plan = buildAutonomousPlan(
    jobs,
    profileForMatching,
    applications as Application[],
    preferences,
    Boolean(activeResume),
    decisions
      .filter((decision) => decision.decidedBy === "user")
      .map((decision) => decision.jobId),
    { autonomousPreparationsToday }
  );
  const userAdminReviews = options.includeAdminReviews ? adminReviewPage.items : [];
  const reviewDecisions = decisions.filter((decision) =>
    decision.reviewRequired === 1 || ["review", "manual_apply"].includes(decision.decision)
  );
  const applicationsByJobId = new Map(applications.map((application) => [application.jobId, application]));
  const applicationsById = new Map(applications.map((application) => [application.id, application]));
  const reviewDecisionQueue = reviewDecisions.map((decision) => {
    const application = applicationsByJobId.get(decision.jobId);

    return {
      ...decision,
      applicationId: application?.id ?? null,
      application: application
        ? {
            id: application.id,
            status: application.status,
            appliedDate: application.appliedDate,
            lastActivity: application.lastActivity,
          }
        : null,
    };
  });
  const operatingEvidence = await loadOperatingApplicationEvidence(applications, userId);
  const [
    followUpReadiness,
    interviewNotificationQueue,
    interviewSchedulingPage,
    employerResponseReplyPage,
    followUpDeliveryQueues,
    followUpDraftingPage,
    interviewPreparationQueue,
    interviewOutcomePage,
    successFeeOperatingSet,
  ] = await Promise.all([
    getAutonomousFollowUpReadiness({
      applications,
      approvals: allApprovals,
      plan,
      userId,
      evidence: operatingEvidence,
    }),
    getInterviewNotificationQueue(userId),
    getInterviewSchedulingPage(userId, 5),
    getEmployerResponseReplyPage(userId, 5),
    getFollowUpDeliveryOperatingQueues(userId, 5),
    preferences.createFollowUps === true
      ? getFollowUpDraftingPage(userId, 5, now)
      : Promise.resolve({ items: [], total: 0, limit: 5, hasMore: false }),
    getInterviewPreparationQueue(userId),
    getInterviewOutcomePage(userId, 5),
    getUserSuccessFeeOperatingItems(userId),
  ]);
  const interviewSchedulingQueue = followUpReadiness.interviewSchedulingQueue;
  const interviewOutcomeQueue = followUpReadiness.interviewOutcomeQueue;
  const employerResponseQueue = employerResponseReplyPage.items;
  const successFeeCompliance = getSuccessFeeComplianceSummaryFromAggregates(
    successFeeSummary,
    offerAttributionPage.total
  );
  const successFeeComplianceQueue = getSuccessFeeComplianceQueue(successFeeOperatingSet.items, offerAttributionPage.items);
  const followUpDueQueue = followUpDraftingPage.items;
  const approvedFollowUpsReadyToSend = followUpDeliveryQueues.ready.items;
  const followUpDeliveryReconciliation = followUpDeliveryQueues.reconciliation.items;
  const actionReadyPlanSummary = {
    ...plan.summary,
    followUpsActionReady: followUpDraftingPage.total,
    followUpsBlocked: followUpReadiness.blockedCount,
  };
  const connectorReadinessQueue = getConnectorReadinessQueue({
    profile,
    applications,
    providers: profileEvidence.providers,
    hasActiveResumeArtifact: Boolean(activeResume),
  });
  const inboxResponseCandidateQueue = inboxResponseCandidatePage.items.map((candidate) => {
    const application = applicationsById.get(candidate.applicationId);
    return {
      ...candidate,
      job: application?.job ? {
        id: application.job.id,
        title: application.job.title,
        company: application.job.company,
        location: application.job.location,
      } : null,
    };
  });
  const evidenceGates = buildAutonomousEvidenceGates({
    profileEvidence,
    connectorReadiness: connectorReadinessQueue,
  });

  const nextActions = unique([
    campaignStatus === "paused"
      ? "Resume the paused campaign before autonomous work can run."
      : "",
    applicationWindow.hasMore
      ? `Processing is safely limited to the ${applicationWindow.limit} oldest active applications in this cycle.`
      : "",
    ...getLocationPolicyNextActions(plan),
    ...readiness.nextActions,
    ...(followUpDraftingPage.total > 0
      ? [`Draft ${followUpDraftingPage.total} timely follow-up message${followUpDraftingPage.total === 1 ? "" : "s"}.`]
      : getActionReadyFollowUpNextActions(plan, followUpReadiness)),
    pendingApprovalCount > 0 ? `Resolve ${pendingApprovalCount} pending user approval${pendingApprovalCount === 1 ? "" : "s"}.` : "",
    adminReviewPage.total > 0
      ? `${adminReviewPage.total} item${adminReviewPage.total === 1 ? " needs" : "s need"} admin operating review.`
      : "",
    reviewDecisionPage.total > 0
      ? `Review ${reviewDecisionPage.total} saved application decision${reviewDecisionPage.total === 1 ? "" : "s"}.`
      : "",
    interviewSchedulingPage.total > 0
      ? `Review ${interviewSchedulingPage.total} interview scheduling item${interviewSchedulingPage.total === 1 ? "" : "s"} before follow-up automation continues.`
      : "",
    interviewNotificationQueue.total > 0
      ? `Review ${interviewNotificationQueue.total} verified interview invite${interviewNotificationQueue.total === 1 ? "" : "s"}.`
      : "",
    inboxResponseCandidatePage.total > 0
      ? `Confirm or dismiss ${inboxResponseCandidatePage.total} inbox response candidate${inboxResponseCandidatePage.total === 1 ? "" : "s"} before changing application status.`
      : "",
    interviewPreparationQueue.total > 0
      ? `Prepare for ${interviewPreparationQueue.total} upcoming interview${interviewPreparationQueue.total === 1 ? "" : "s"}.`
      : "",
    interviewOutcomePage.total > 0
      ? `Record outcomes for ${interviewOutcomePage.total} completed interview${interviewOutcomePage.total === 1 ? "" : "s"} before routine follow-ups continue.`
      : "",
    employerResponseReplyPage.total > 0
      ? `Reply to ${employerResponseReplyPage.total} employer question${employerResponseReplyPage.total === 1 ? "" : "s"} before routine follow-ups continue.`
      : "",
    followUpDeliveryQueues.ready.total > 0
      ? `Record send handoff for ${followUpDeliveryQueues.ready.total} approved follow-up draft${followUpDeliveryQueues.ready.total === 1 ? "" : "s"}.`
      : "",
    followUpDeliveryQueues.reconciliation.total > 0
      ? `Verify ${followUpDeliveryQueues.reconciliation.total} uncertain mailbox ${followUpDeliveryQueues.reconciliation.total === 1 ? "delivery" : "deliveries"} before any retry.`
      : "",
    successFeeCompliance.status === "needs_attention" || successFeeCompliance.status === "due_soon"
      ? successFeeCompliance.nextAction
      : "",
    connectorReadinessQueue.length > 0
      ? `Complete ${connectorReadinessQueue.length} connector setup item${connectorReadinessQueue.length === 1 ? "" : "s"} before relying on external inbox or cloud evidence.`
      : "",
    evidenceGates.length > 0
      ? `Resolve ${evidenceGates.length} autonomous evidence gate${evidenceGates.length === 1 ? "" : "s"} before external application or follow-up execution.`
      : "",
  ]).slice(0, 8);
  const blockers = unique([
    campaignStatus === "paused" ? "Campaign is paused" : "",
    ...readiness.blockers.map((gap) => gap.label),
    ...plan.policyWarnings,
    ...evidenceGates
      .filter((gate) => gate.severity === "high")
      .map((gate) => gate.label),
    pendingApprovalCount > 0 ? "Pending user approvals" : "",
    adminReviewPage.total > 0 ? "Open admin review items" : "",
    successFeeCompliance.status === "needs_attention" ? "Success-fee compliance needs attention" : "",
  ]);

  let campaignWrite: Awaited<ReturnType<typeof upsertApplicationCampaign>> | null = null;
  let campaign = existingCampaign;
  if (options.persistCampaign !== false) {
    campaignWrite = await upsertApplicationCampaign({
      userId,
      status: campaignStatus,
      title: campaignTitle(profile),
      targetRoles: profile?.desiredJobTypes ?? null,
      targetLocations: profile?.desiredLocations ?? null,
      salaryMin: profile?.salaryExpectationMin ?? null,
      salaryMax: profile?.salaryExpectationMax ?? null,
      remoteOnly: preferences.remoteOnly === false ? 0 : 1,
      automationMode: plan.mode,
      dailyApplicationLimit: preferences.dailyApplicationLimit ?? 12,
      minMatchScore: preferences.minMatchScore ?? 70,
      readinessScore: readiness.score,
      autoApplyEligible: readiness.autoApplyEligible ? 1 : 0,
      blockers: JSON.stringify(blockers),
      nextActions: JSON.stringify(nextActions),
      lastPlanSummary: JSON.stringify(actionReadyPlanSummary),
      lastSyncedAt: new Date(),
    }, { preserveStatus: true });
    campaign = await getApplicationCampaign(userId);
  }

  return {
    campaign: campaign ?? {
      id: campaignWrite ? Number(campaignWrite.insertId) : 0,
      userId,
      status: "active",
      title: campaignTitle(profile),
      targetRoles: profile?.desiredJobTypes ?? null,
      targetLocations: profile?.desiredLocations ?? null,
      salaryMin: profile?.salaryExpectationMin ?? null,
      salaryMax: profile?.salaryExpectationMax ?? null,
      remoteOnly: preferences.remoteOnly === false ? 0 : 1,
      automationMode: plan.mode,
      dailyApplicationLimit: preferences.dailyApplicationLimit ?? 12,
      minMatchScore: preferences.minMatchScore ?? 70,
      readinessScore: readiness.score,
      autoApplyEligible: readiness.autoApplyEligible ? 1 : 0,
      blockers: JSON.stringify(blockers),
      nextActions: JSON.stringify(nextActions),
      lastPlanSummary: JSON.stringify(actionReadyPlanSummary),
      lastSyncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    readiness,
    plan: {
      mode: plan.mode,
      summary: actionReadyPlanSummary,
      nextActions: plan.nextActions,
      policyWarnings: plan.policyWarnings,
      evidenceGates,
    },
    applicationOverview: {
      total: applicationSummary.total,
      submitted: applicationSummary.submitted,
      active: applicationSummary.active,
      interviewing: applicationSummary.interview,
      operatingWindow: {
        loaded: applicationWindow.items.length,
        limit: applicationWindow.limit,
        hasMore: applicationWindow.hasMore,
      },
      recent: recentApplicationPage.items.map((application) => ({
        id: application.id,
        status: application.status,
        appliedDate: application.appliedDate,
        lastActivity: application.lastActivity,
        createdAt: application.createdAt,
        coverLetter: application.coverLetter,
        job: application.job,
      })),
    },
    successFeeOperatingScope: {
      loaded: successFeeOperatingSet.items.length,
      limit: successFeeOperatingSet.limit,
      hasMore: successFeeOperatingSet.hasMore,
    },
    offerAttributionScope: {
      loaded: offerAttributionPage.items.length,
      limit: offerAttributionPage.limit,
      hasMore: offerAttributionPage.hasMore,
    },
    inboxResponseCandidateScope: {
      loaded: inboxResponseCandidatePage.items.length,
      limit: inboxResponseCandidatePage.limit,
      hasMore: inboxResponseCandidatePage.hasMore,
    },
    interviewPreparationScope: {
      loaded: interviewPreparationQueue.items.length,
      limit: interviewPreparationQueue.limit,
      hasMore: interviewPreparationQueue.hasMore,
    },
    interviewNotificationScope: {
      loaded: interviewNotificationQueue.items.length,
      limit: interviewNotificationQueue.limit,
      hasMore: interviewNotificationQueue.hasMore,
    },
    interviewSchedulingScope: {
      loaded: interviewSchedulingPage.items.length,
      limit: interviewSchedulingPage.limit,
      hasMore: interviewSchedulingPage.hasMore,
    },
    employerResponseReplyScope: {
      loaded: employerResponseReplyPage.items.length,
      limit: employerResponseReplyPage.limit,
      hasMore: employerResponseReplyPage.hasMore,
    },
    followUpDeliveryScope: {
      ready: {
        loaded: followUpDeliveryQueues.ready.items.length,
        limit: followUpDeliveryQueues.ready.limit,
        hasMore: followUpDeliveryQueues.ready.hasMore,
      },
      reconciliation: {
        loaded: followUpDeliveryQueues.reconciliation.items.length,
        limit: followUpDeliveryQueues.reconciliation.limit,
        hasMore: followUpDeliveryQueues.reconciliation.hasMore,
      },
    },
    followUpDraftingScope: {
      loaded: followUpDraftingPage.items.length,
      limit: followUpDraftingPage.limit,
      hasMore: followUpDraftingPage.hasMore,
    },
    interviewOutcomeScope: {
      loaded: interviewOutcomePage.items.length,
      limit: interviewOutcomePage.limit,
      hasMore: interviewOutcomePage.hasMore,
    },
    adminReviewScope: {
      loaded: adminReviewPage.items.length,
      limit: adminReviewPage.limit,
      hasMore: adminReviewPage.hasMore,
    },
    reviewDecisionScope: {
      loaded: reviewDecisionPage.items.length,
      limit: reviewDecisionPage.limit,
      hasMore: reviewDecisionPage.hasMore,
    },
    planSummary: actionReadyPlanSummary,
    followUpReadiness: {
      candidateCount: followUpReadiness.candidateCount,
      actionReadyCount: followUpReadiness.actionReadyCount,
      blockedCount: followUpReadiness.blockedCount,
    },
    metrics: {
      trackedApplications: applicationSummary.total,
      preparedApplications: applicationSummary.prepared,
      submittedApplications: applicationSummary.submitted,
      employerResponses: applicationSummary.responseSignals,
      employerResponsesNeedingReply: employerResponseReplyPage.total,
      interviews: applicationSummary.interview,
      unreadInterviewNotifications: interviewNotificationQueue.total,
      inboxResponseCandidates: inboxResponseCandidatePage.total,
      interviewSchedulingNeeded: interviewSchedulingPage.total,
      interviewPreparationNeeded: interviewPreparationQueue.total,
      interviewOutcomesNeeded: interviewOutcomePage.total,
      offers: applicationSummary.offered,
      activeSuccessFees: successFeeCompliance.activeFees,
      pendingOfferAttributions: successFeeCompliance.pendingOfferAttributions,
      pendingSuccessFeeVerifications: successFeeCompliance.pendingVerification,
      overdueSuccessFeeVerifications: successFeeCompliance.overdueVerifications,
      dueSoonSuccessFeeVerifications: successFeeCompliance.dueSoonVerifications,
      successFeeMonthlyCents: successFeeCompliance.monthlyFeeCents,
      pendingApprovals: pendingApprovalCount,
      approvedFollowUpsReadyToSend: followUpDeliveryQueues.ready.total,
      followUpDeliveryReconciliation: followUpDeliveryQueues.reconciliation.total,
      evidenceGates: evidenceGates.length,
      connectorReadiness: connectorReadinessQueue.length,
      openAdminReviews: adminReviewPage.total,
      reviewRequiredDecisions: reviewDecisionPage.total,
      followUpsDue: followUpDraftingPage.total,
      policyWarnings: plan.summary.policyWarnings,
      dailyRemaining: plan.summary.dailyRemaining,
    },
    queues: {
      pendingApprovals: approvals.slice(0, 5),
      adminReviews: userAdminReviews,
      reviewDecisions: reviewDecisionQueue,
      interviewNotifications: interviewNotificationQueue.items,
      inboxResponseCandidates: inboxResponseCandidateQueue.slice(0, 5),
      interviewScheduling: interviewSchedulingPage.items,
      interviewPreparationNeeded: interviewPreparationQueue.items.slice(0, 5),
      interviewOutcomesNeeded: interviewOutcomePage.items,
      employerResponsesNeedingReply: employerResponseQueue.slice(0, 5),
      followUpsDue: followUpDueQueue.slice(0, 5),
      approvedFollowUpsReadyToSend: approvedFollowUpsReadyToSend.slice(0, 5),
      followUpDeliveryReconciliation: followUpDeliveryReconciliation.slice(0, 5),
      evidenceGates,
      successFeeCompliance: successFeeComplianceQueue.slice(0, 5),
      connectorReadiness: connectorReadinessQueue,
    },
    successFeeCompliance,
    profileEvidence,
    canReviewAdminItems: options.includeAdminReviews === true,
    nextActions,
    blockers,
  };
}
