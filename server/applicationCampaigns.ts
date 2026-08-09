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
  listUnreadInterviewNotifications,
  listPendingInboxResponseCandidates,
  getUserApplicationDecisions,
  getUserApplications,
  getUserEmployerResponsesForApplications,
  getUserProfile,
  getUserOfferAttributionReviews,
  getUserSuccessFees,
  getUserSkills,
  getWorkExperiences,
  listUserConnectorAccounts,
  listInterviewPreparationsForUser,
  listUserAdminReviewItems,
  listUserApplicationApprovals,
  upsertApplicationCampaign,
} from "./db";
import { buildAutonomousPlan, parseAutonomousPreferences } from "./autonomousOrchestrator";
import { calculateProfileReadiness } from "./profileReadiness";
import { getActiveResume } from "./resumeStorage";
import {
  getProfileEvidenceControlSummary,
  type ProfileEvidenceProvider,
} from "@shared/profileEvidence";
import { buildAutonomousEvidenceGates } from "@shared/autonomousEvidenceGates";
import { resolveProfileCandidateEvidence } from "@shared/profileSkillEvidence";
import {
  getUpcomingInterviews,
  getUserFollowUpsForApplications,
  getUserInterviewSchedulesForApplications,
} from "./applicationFeatures";
import {
  getSuccessFeeComplianceQueue,
  getSuccessFeeComplianceSummary,
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
  applications: UserApplicationRecord[],
  userId: number,
  evidence: OperatingApplicationEvidence
) {
  // Validate the complete bounded unread set before applying the command-center limit.
  // Legacy or concurrently retired notifications must not hide a newer verified invite.
  const notifications = await listUnreadInterviewNotifications(userId, 100);
  const applicationsById = new Map(applications.map((application) => [application.id, application]));

  const items = notifications.map((notification) => {
    const application = applicationsById.get(notification.applicationId);
    if (!application || application.status !== "interview") return null;

    const response = (evidence.responsesByApplication.get(application.id) ?? [])
      .find((item) => item.id === notification.employerResponseId);
    if (!response || response.responseType !== "interview_invite") return null;

    return {
      notificationId: notification.id,
      applicationId: application.id,
      jobId: application.jobId,
      employerResponseId: response.id,
      notificationType: notification.notificationType,
      createdAt: notification.createdAt,
      receivedAt: response.receivedAt,
      summary: response.summary,
      job: application.job ? {
        id: application.job.id,
        title: application.job.title,
        company: application.job.company,
        location: application.job.location,
      } : null,
    };
  });

  return items
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 5);
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
  const [upcomingInterviews, preparations] = await Promise.all([
    getUpcomingInterviews(userId),
    listInterviewPreparationsForUser(userId),
  ]);
  const preparedJobIds = new Set(preparations.map((preparation) => preparation.jobId));
  const items = upcomingInterviews.map((item) => {
    if (preparedJobIds.has(item.application.jobId)) return null;

    return {
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
    };
  });

  return items.filter((item): item is NonNullable<typeof item> => item !== null);
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

export async function getUserOperatingLedger(userId: number, options: OperatingLedgerOptions = {}) {
  const [
    profile,
    workExperiences,
    educationEntries,
    skills,
    applications,
    jobs,
    allApprovals,
    adminReviews,
    decisions,
    successFees,
    connectorAccounts,
    activeResume,
    inboxResponseCandidates,
    existingCampaign,
  ] = await Promise.all([
    getUserProfile(userId),
    getWorkExperiences(userId),
    getEducationEntries(userId),
    getUserSkills(userId),
    getUserApplications(userId),
    getActiveJobs(250, 0),
    listUserApplicationApprovals(userId, "all"),
    options.includeAdminReviews
      ? listUserAdminReviewItems(userId, ["open", "in_progress"], 100)
      : Promise.resolve([]),
    getUserApplicationDecisions(userId),
    getUserSuccessFees(userId),
    listUserConnectorAccounts(userId),
    getActiveResume(userId),
    listPendingInboxResponseCandidates(userId),
    getApplicationCampaign(userId),
  ]);
  const approvals = allApprovals.filter((approval) => approval.status === "pending");
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
      .map((decision) => decision.jobId)
  );
  const userAdminReviews = options.includeAdminReviews
    ? adminReviews.filter((item) =>
        item.userId === userId && ["open", "in_progress"].includes(item.status)
      )
    : [];
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
  const submittedApplications = applications.filter((application) => application.status !== "pending");
  const responseCount = applicationStatusCount(applications, ["viewed", "interview", "offer", "accepted", "rejected"]);
  const operatingEvidence = await loadOperatingApplicationEvidence(applications, userId);
  const employerResponses = Array.from(operatingEvidence.responsesByApplication.values()).flat();
  const [
    followUpReadiness,
    offerAttributionReviews,
    interviewNotificationQueue,
    interviewPreparationQueue,
  ] = await Promise.all([
    getAutonomousFollowUpReadiness({
      applications,
      approvals: allApprovals,
      plan,
      userId,
      evidence: operatingEvidence,
    }),
    getUserOfferAttributionReviews(userId, {
      approvals: allApprovals,
      applications,
      employerResponses,
    }),
    getInterviewNotificationQueue(applications, userId, operatingEvidence),
    getInterviewPreparationQueue(userId),
  ]);
  const followUpSuppressionState = followUpReadiness.suppressionState;
  const interviewSchedulingQueue = followUpReadiness.interviewSchedulingQueue;
  const interviewOutcomeQueue = followUpReadiness.interviewOutcomeQueue;
  const employerResponseQueue = followUpReadiness.employerResponseQueue;
  const successFeeCompliance = getSuccessFeeComplianceSummary(successFees, offerAttributionReviews);
  const successFeeComplianceQueue = getSuccessFeeComplianceQueue(successFees, offerAttributionReviews);
  const followUpDueQueue = followUpReadiness.actionReadyQueue;
  const approvedFollowUpsReadyToSend = followUpSuppressionState.approvedFollowUpsReadyToSend;
  const followUpDeliveryReconciliation = followUpSuppressionState.followUpDeliveryReconciliation;
  const actionReadyPlanSummary = {
    ...plan.summary,
    followUpsActionReady: followUpReadiness.actionReadyCount,
    followUpsBlocked: followUpReadiness.blockedCount,
  };
  const connectorReadinessQueue = getConnectorReadinessQueue({
    profile,
    applications,
    providers: profileEvidence.providers,
    hasActiveResumeArtifact: Boolean(activeResume),
  });
  const inboxResponseCandidateQueue = inboxResponseCandidates.map((candidate) => {
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
    ...getLocationPolicyNextActions(plan),
    ...readiness.nextActions,
    ...getActionReadyFollowUpNextActions(plan, followUpReadiness),
    approvals.length > 0 ? `Resolve ${approvals.length} pending user approval${approvals.length === 1 ? "" : "s"}.` : "",
    userAdminReviews.length > 0
      ? `${userAdminReviews.length} item${userAdminReviews.length === 1 ? " needs" : "s need"} admin operating review.`
      : "",
    reviewDecisions.length > 0
      ? `Review ${reviewDecisions.length} saved application decision${reviewDecisions.length === 1 ? "" : "s"}.`
      : "",
    interviewSchedulingQueue.length > 0
      ? `Review ${interviewSchedulingQueue.length} interview scheduling item${interviewSchedulingQueue.length === 1 ? "" : "s"} before follow-up automation continues.`
      : "",
    interviewNotificationQueue.length > 0
      ? `Review ${interviewNotificationQueue.length} verified interview invite${interviewNotificationQueue.length === 1 ? "" : "s"}.`
      : "",
    inboxResponseCandidates.length > 0
      ? `Confirm or dismiss ${inboxResponseCandidates.length} inbox response candidate${inboxResponseCandidates.length === 1 ? "" : "s"} before changing application status.`
      : "",
    interviewPreparationQueue.length > 0
      ? `Prepare for ${interviewPreparationQueue.length} upcoming interview${interviewPreparationQueue.length === 1 ? "" : "s"}.`
      : "",
    interviewOutcomeQueue.length > 0
      ? `Record outcomes for ${interviewOutcomeQueue.length} completed interview${interviewOutcomeQueue.length === 1 ? "" : "s"} before routine follow-ups continue.`
      : "",
    employerResponseQueue.length > 0
      ? `Reply to ${employerResponseQueue.length} employer question${employerResponseQueue.length === 1 ? "" : "s"} before routine follow-ups continue.`
      : "",
    approvedFollowUpsReadyToSend.length > 0
      ? `Record send handoff for ${approvedFollowUpsReadyToSend.length} approved follow-up draft${approvedFollowUpsReadyToSend.length === 1 ? "" : "s"}.`
      : "",
    followUpDeliveryReconciliation.length > 0
      ? `Verify ${followUpDeliveryReconciliation.length} uncertain mailbox ${followUpDeliveryReconciliation.length === 1 ? "delivery" : "deliveries"} before any retry.`
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
    approvals.length > 0 ? "Pending user approvals" : "",
    userAdminReviews.length > 0 ? "Open admin review items" : "",
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
      total: applications.length,
      submitted: submittedApplications.length,
      active: applicationStatusCount(applications, ["pending", "applied", "viewed", "interview"]),
      interviewing: applicationStatusCount(applications, ["interview"]),
      recent: applications.slice(0, 10).map((application) => ({
        id: application.id,
        status: application.status,
        appliedDate: application.appliedDate,
        lastActivity: application.lastActivity,
        createdAt: application.createdAt,
        coverLetter: application.coverLetter,
        job: application.job,
      })),
    },
    planSummary: actionReadyPlanSummary,
    followUpReadiness: {
      candidateCount: followUpReadiness.candidateCount,
      actionReadyCount: followUpReadiness.actionReadyCount,
      blockedCount: followUpReadiness.blockedCount,
    },
    metrics: {
      trackedApplications: applications.length,
      preparedApplications: applicationStatusCount(applications, ["pending"]),
      submittedApplications: submittedApplications.length,
      employerResponses: responseCount,
      employerResponsesNeedingReply: employerResponseQueue.length,
      interviews: applicationStatusCount(applications, ["interview"]),
      unreadInterviewNotifications: interviewNotificationQueue.length,
      inboxResponseCandidates: inboxResponseCandidateQueue.length,
      interviewSchedulingNeeded: interviewSchedulingQueue.length,
      interviewPreparationNeeded: interviewPreparationQueue.length,
      interviewOutcomesNeeded: interviewOutcomeQueue.length,
      offers: applicationStatusCount(applications, ["offer", "accepted"]),
      activeSuccessFees: successFeeCompliance.activeFees,
      pendingOfferAttributions: successFeeCompliance.pendingOfferAttributions,
      pendingSuccessFeeVerifications: successFeeCompliance.pendingVerification,
      overdueSuccessFeeVerifications: successFeeCompliance.overdueVerifications,
      dueSoonSuccessFeeVerifications: successFeeCompliance.dueSoonVerifications,
      successFeeMonthlyCents: successFeeCompliance.monthlyFeeCents,
      pendingApprovals: approvals.length,
      approvedFollowUpsReadyToSend: approvedFollowUpsReadyToSend.length,
      followUpDeliveryReconciliation: followUpDeliveryReconciliation.length,
      evidenceGates: evidenceGates.length,
      connectorReadiness: connectorReadinessQueue.length,
      openAdminReviews: userAdminReviews.length,
      reviewRequiredDecisions: reviewDecisions.length,
      followUpsDue: followUpDueQueue.length,
      policyWarnings: plan.summary.policyWarnings,
      dailyRemaining: plan.summary.dailyRemaining,
    },
    queues: {
      pendingApprovals: approvals.slice(0, 5),
      adminReviews: userAdminReviews.slice(0, 5),
      reviewDecisions: reviewDecisionQueue.slice(0, 5),
      interviewNotifications: interviewNotificationQueue,
      inboxResponseCandidates: inboxResponseCandidateQueue.slice(0, 5),
      interviewScheduling: interviewSchedulingQueue.slice(0, 5),
      interviewPreparationNeeded: interviewPreparationQueue.slice(0, 5),
      interviewOutcomesNeeded: interviewOutcomeQueue.slice(0, 5),
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
