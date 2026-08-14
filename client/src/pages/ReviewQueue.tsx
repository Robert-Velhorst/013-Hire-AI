import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { getApplicationDeepLink } from "@/lib/applicationDeepLinks";
import { getInterviewSchedulingControl } from "@/lib/interviewSchedulingControl";
import { formatCalendarDate } from "@/lib/calendarDate";
import { useLocale, type TranslationKey } from "@/contexts/LocaleContext";
import { getApprovalEvidenceGateSummary } from "@/lib/applicationEvidenceGates";
import {
  getApplicationDecisionTranslationKey,
  getApprovalTypeTranslationKey,
  getReviewQueueActionCopy,
} from "@/lib/reviewQueueActionCopy";
import {
  formatApplicationDecision,
  formatApprovalType,
  getApprovalDecisionNote,
  getOperatingReviewQueueCounts,
  getReviewQueueActionSummary,
  getReviewQueueControlSummary,
  getReviewDecisionResolutionCopy,
  getReviewRiskBadgeClass,
  type ReviewQueueActionKind,
  type ReviewQueueActionSummary,
  type ReviewQueueControlCopyId,
  type ReviewDecisionResolution,
} from "@/lib/operatingReviewQueue";
import { toast } from "sonner";
import {
  AlertCircle,
  Briefcase,
  Calendar,
  CheckCircle,
  ClipboardCheck,
  DollarSign,
  History,
  Loader2,
  Mail,
  MessageSquare,
  Search,
  Shield,
  User,
  XCircle,
} from "lucide-react";

type ReviewQueueControlCopyDefinition = {
  label: TranslationKey;
  headline: TranslationKey;
  detail: TranslationKey;
  cta: TranslationKey;
};

const REVIEW_QUEUE_CONTROL_COPY = {
  pending_approvals: { label: "controlApprovalLabel", headline: "controlApprovalHeadline", detail: "controlApprovalDetail", cta: "controlApprovalCta" },
  delivery_reconciliation: { label: "controlDeliveryCheckLabel", headline: "controlDeliveryCheckHeadline", detail: "controlDeliveryCheckDetail", cta: "controlDeliveryCheckCta" },
  approved_delivery: { label: "controlApprovedDeliveryLabel", headline: "controlApprovedDeliveryHeadline", detail: "controlApprovedDeliveryDetail", cta: "controlApprovedDeliveryCta" },
  success_fee_compliance: { label: "controlSuccessFeeLabel", headline: "controlSuccessFeeHeadline", detail: "controlSuccessFeeDetail", cta: "controlSuccessFeeCta" },
  evidence_gates: { label: "controlEvidenceLabel", headline: "controlEvidenceHeadline", detail: "controlEvidenceDetail", cta: "controlEvidenceCta" },
  admin_reviews: { label: "controlAdminLabel", headline: "controlAdminHeadline", detail: "controlAdminDetail", cta: "controlAdminCta" },
  profile_blockers: { label: "controlProfileBlockerLabel", headline: "controlProfileBlockerHeadline", detail: "controlProfileBlockerDetail", cta: "controlProfileBlockerCta" },
  connector_readiness: { label: "controlConnectorLabel", headline: "controlConnectorHeadline", detail: "controlConnectorDetail", cta: "controlConnectorCta" },
  inbox_response_candidates: { label: "controlInboxLabel", headline: "controlInboxHeadline", detail: "controlInboxDetail", cta: "controlInboxCta" },
  employer_replies: { label: "controlEmployerReplyLabel", headline: "controlEmployerReplyHeadline", detail: "controlEmployerReplyDetail", cta: "controlEmployerReplyCta" },
  interview_scheduling: { label: "controlInterviewScheduleLabel", headline: "controlInterviewScheduleHeadline", detail: "controlInterviewScheduleDetail", cta: "controlInterviewScheduleCta" },
  interview_outcomes: { label: "controlInterviewOutcomeLabel", headline: "controlInterviewOutcomeHeadline", detail: "controlInterviewOutcomeDetail", cta: "controlInterviewOutcomeCta" },
  follow_up_drafting: { label: "reviewControlFollowUpLabel", headline: "reviewControlFollowUpHeadline", detail: "reviewControlFollowUpDetail", cta: "reviewControlFollowUpCta" },
  job_decisions: { label: "controlJobDecisionLabel", headline: "controlJobDecisionHeadline", detail: "controlJobDecisionDetail", cta: "controlJobDecisionCta" },
  interview_preparation: { label: "controlInterviewPrepLabel", headline: "controlInterviewPrepHeadline", detail: "controlInterviewPrepDetail", cta: "controlInterviewPrepCta" },
  profile_warnings: { label: "controlProfileWarningLabel", headline: "controlProfileWarningHeadline", detail: "controlProfileWarningDetail", cta: "controlProfileWarningCta" },
  queue_clear: { label: "controlQueueClearLabel", headline: "controlQueueClearHeadline", detail: "controlQueueClearDetail", cta: "controlQueueClearCta" },
} satisfies Record<ReviewQueueControlCopyId, ReviewQueueControlCopyDefinition>;

type InboxResponseType = "rejection" | "interview_invite" | "offer" | "employer_question" | "other";

export default function ReviewQueue() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { locale, t } = useLocale();
  const formatLocalizedApprovalType = (value?: string | null) => {
    const key = getApprovalTypeTranslationKey(value);
    return key ? t(key) : formatApprovalType(value);
  };
  const formatLocalizedDecision = (value?: string | null) => {
    const key = getApplicationDecisionTranslationKey(value);
    return key ? t(key) : formatApplicationDecision(value);
  };
  const getLocalizedInterviewSchedulingControl = (requirement?: string | null) => {
    const control = getInterviewSchedulingControl(
      requirement as Parameters<typeof getInterviewSchedulingControl>[0]
    );
    if (requirement === "new_invite") {
      return {
        ...control,
        badgeLabel: t("newInterviewRound"),
        description: t("interviewNeedsSchedulingDetail"),
        actionLabel: t("interviewNeedsScheduling"),
      };
    }
    if (requirement === "cancelled_schedule") {
      return {
        ...control,
        badgeLabel: t("scheduleCancelled"),
        description: t("interviewCancelledScheduleDetail"),
        actionLabel: t("recordNewInvitation"),
      };
    }
    return {
      ...control,
      badgeLabel: t("invitationEvidenceMissing"),
      description: t("interviewMissingScheduleDetail"),
      actionLabel: t("recordInvitation"),
    };
  };
  const [sendHandoff, setSendHandoff] = useState<{ followUpId: number; label: string } | null>(null);
  const [deliveryConfirmation, setDeliveryConfirmation] = useState("");
  const [inboxResponseTypeOverrides, setInboxResponseTypeOverrides] = useState<Record<number, InboxResponseType>>({});
  const {
    data: operatingLedger,
    isLoading,
    refetch,
  } = trpc.applications.getOperatingLedger.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const {
    data: auditTrail,
    refetch: refetchAuditTrail,
  } = trpc.audit.getForUser.useQuery(
    { limit: 8 },
    { enabled: Boolean(user) }
  );
  const resolveApproval = trpc.applications.resolveApproval.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(t(variables.status === "approved" ? "approvalRecorded" : "approvalRejected"));
      await Promise.all([refetch(), refetchAuditTrail()]);
    },
    onError: (error) => {
      toast.error(error.message || t("approvalResolveFailed"));
    },
  });
  const resolveDecision = trpc.applications.decide.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(
        variables.decision === "save"
          ? t("jobSavedForReview")
          : t("jobIgnoredFromQueue")
      );
      await Promise.all([refetch(), refetchAuditTrail()]);
    },
    onError: (error) => {
      toast.error(error.message || t("jobDecisionResolveFailed"));
    },
  });
  const generateInterviewPreparation = trpc.applications.generateInterviewPreparation.useMutation({
    onSuccess: async (result) => {
      toast.success(t(result.existing ? "interviewPrepAlreadyExists" : "interviewPrepGenerated"));
      await Promise.all([refetch(), refetchAuditTrail()]);
    },
    onError: (error) => {
      toast.error(error.message || t("interviewPrepGenerateFailed"));
    },
  });
  const markFollowUpSent = trpc.applications.markFollowUpSent.useMutation({
    onSuccess: async () => {
      toast.success(t("followUpHandoffRecorded"));
      setSendHandoff(null);
      setDeliveryConfirmation("");
      await Promise.all([refetch(), refetchAuditTrail()]);
    },
    onError: (error) => {
      toast.error(error.message || t("followUpHandoffFailed"));
    },
  });
  const ingestInboxResponse = trpc.applications.ingestInboxResponse.useMutation({
    onSuccess: async (result) => {
      toast.success(t(result.existing ? "existingEmployerResponseKept" : "responseRecorded"));
      setInboxResponseTypeOverrides({});
      await Promise.all([refetch(), refetchAuditTrail()]);
    },
    onError: (error) => {
      toast.error(error.message || t("inboxResponseConfirmFailed"));
    },
  });
  const dismissInboxResponseCandidate = trpc.applications.dismissInboxResponseCandidate.useMutation({
    onSuccess: async () => {
      toast.success(t("inboxCandidateDismissed"));
      setInboxResponseTypeOverrides({});
      await Promise.all([refetch(), refetchAuditTrail()]);
    },
    onError: (error) => {
      toast.error(error.message || t("inboxCandidateDismissFailed"));
    },
  });

  const counts = useMemo(
    () => getOperatingReviewQueueCounts(operatingLedger),
    [operatingLedger]
  );
  const queueControl = useMemo(
    () => getReviewQueueControlSummary(operatingLedger),
    [operatingLedger]
  );
  const queueControlCopy = REVIEW_QUEUE_CONTROL_COPY[queueControl.copyId];
  const canReviewAdminItems = operatingLedger?.canReviewAdminItems === true;
  const summaryItems = [
    [t("pipelineApprovals"), counts.pendingApprovals],
    [t("jobDecisions"), counts.reviewDecisions],
    [t("pipelineInterviews"), counts.interviewScheduling],
    [t("interviewPrepLabel"), counts.interviewPreparationNeeded],
    [t("outcomesLabel"), counts.interviewOutcomesNeeded],
    [t("inboxResponsesLabel"), counts.inboxResponseCandidates],
    [t("evidenceGatesLabel"), counts.evidenceGates],
    [t("connectorsLabel"), counts.connectorReadiness],
    [t("employerRepliesLabel"), counts.employerResponsesNeedingReply],
    [t("followUpsHeading"), counts.followUpsDue],
    [t("deliveryChecksLabel"), counts.followUpDeliveryReconciliation],
    [t("sendHandoffsLabel"), counts.approvedFollowUpsReadyToSend],
    [t("successFeesLabel"), counts.successFeeCompliance],
    [t("profileBlockersLabel"), counts.profileBlockers],
    [t("profileWarningsLabel"), counts.profileWarnings],
    ...(canReviewAdminItems ? [[t("adminReviewsLabel"), counts.adminReviews]] : []),
  ];

  const handleResolveApproval = (
    approval: { id: number; approvalType?: string | null },
    status: "approved" | "rejected"
  ) => {
    resolveApproval.mutate({
      approvalId: approval.id,
      status,
      decisionNote: getApprovalDecisionNote(approval.approvalType, status),
    });
  };

  const handleResolveDecision = (
    decision: {
      jobId: number;
      decision?: string | null;
      decisionReason?: string | null;
      reviewReason?: string | null;
      matchScore?: number | null;
    },
    resolution: ReviewDecisionResolution
  ) => {
    resolveDecision.mutate({
      jobId: decision.jobId,
      decision: resolution,
      decisionReason: getReviewDecisionResolutionCopy(decision, resolution),
      matchScore: decision.matchScore ?? undefined,
      riskLevel: "low",
      reviewRequired: false,
    });
  };

  const getQueueAction = (kind: ReviewQueueActionKind, item: unknown) =>
    getReviewQueueActionSummary(kind, item as Record<string, unknown>);

  const openSendHandoff = (followUpId: number, label: string) => {
    setDeliveryConfirmation("");
    setSendHandoff({ followUpId, label });
  };

  const confirmInboxResponseCandidate = (candidate: {
    id: number;
    applicationId: number;
    provider: "gmail" | "outlook";
    messageId: string;
    suggestedResponseType: InboxResponseType;
    subject: string;
    preview: string;
    receivedAt: Date | string;
  }, responseType: InboxResponseType) => {
    ingestInboxResponse.mutate({
      candidateId: candidate.id,
      responseType,
    });
  };

  const scrollToQueueSection = (section: string) => {
    const target = document.getElementById(`review-queue-section-${section}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    setLocation(queueControl.route);
  };

  if (authLoading || isLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ClipboardCheck className="h-4 w-4" />
              {t("applicationOperatingLedger")}
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t("reviewQueueTitle")}</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {t(canReviewAdminItems ? "reviewQueueDescriptionAdmin" : "reviewQueueDescription")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setLocation("/dashboard")}>
              <Shield className="mr-2 h-4 w-4" />
              {t("dashboard")}
            </Button>
            <Button variant="outline" onClick={() => setLocation("/applications")}>
              <Briefcase className="mr-2 h-4 w-4" />
              {t("applicationLedger")}
            </Button>
          </div>
        </div>

        <Card data-testid="review-queue-control">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={getReviewRiskBadgeClass(queueControl.risk)}>
                    {t(queueControlCopy.label)}
                  </Badge>
                  <Badge variant="outline">
                    {t("reviewItemsCount", { count: queueControl.count })}
                  </Badge>
                  {queueControl.approvalGated && (
                    <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
                      {t("approvalGated")}
                    </Badge>
                  )}
                  {queueControl.externalAction === "approved_delivery" && (
                    <Badge variant="outline" className="border-blue-500/40 text-blue-300">
                      {t("deliveryReady")}
                    </Badge>
                  )}
                  {queueControl.externalAction === "delivery_reconciliation" && (
                    <Badge variant="outline" className="border-red-500/40 text-red-300">
                      {t("doNotRetry")}
                    </Badge>
                  )}
                  {queueControl.externalAction === "blocked_until_evidence" && (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                      {t("evidenceGated")}
                    </Badge>
                  )}
                </div>
                <h2 className="text-xl font-semibold tracking-tight">{t("reviewQueueControl")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(queueControlCopy.headline, { count: queueControl.count })}
                </p>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t(queueControlCopy.detail)}</p>
              </div>
              <Button
                data-testid="review-queue-primary"
                className="lg:w-56"
                disabled={queueControl.status === "clear" && counts.total === 0}
                onClick={() => scrollToQueueSection(queueControl.section)}
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                {t(queueControlCopy.cta)}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          {summaryItems.map(([label, value]) => (
            <div key={label} className="rounded-md border bg-card p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>

        {counts.total === 0 ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              {t("reviewQueueClear")}
            </div>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <div className="space-y-6">
              <section id="review-queue-section-approvals" data-testid="review-queue-section-approvals" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("userApprovalGates")}</h2>
                  <Badge variant="outline">{counts.pendingApprovals}</Badge>
                </div>
                {operatingLedger?.queues.pendingApprovals.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.pendingApprovals.map((approval) => {
                      const evidenceGate = getApprovalEvidenceGateSummary(
                        approval,
                        operatingLedger.queues.evidenceGates
                      );
                      const evidenceBlocked = evidenceGate.count > 0;

                      return (
                      <Card key={approval.id}>
                        <CardHeader className="pb-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <CardTitle className="text-base">{approval.title}</CardTitle>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {formatLocalizedApprovalType(approval.approvalType)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={getReviewRiskBadgeClass(approval.riskLevel)}
                            >
                              {approval.riskLevel}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {approval.description && (
                            <p className="text-sm text-muted-foreground">{approval.description}</p>
                          )}
                          <QueueActionStrip
                            summary={getQueueAction("approval", approval)}
                            onOpen={setLocation}
                          />
                          {evidenceBlocked && (
                            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
                              {evidenceGate.detail}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              data-testid="approval-approve"
                              data-approval-type={approval.approvalType}
                              disabled={resolveApproval.isPending || evidenceBlocked}
                              title={evidenceBlocked ? evidenceGate.detail : undefined}
                              onClick={() => handleResolveApproval(approval, "approved")}
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              {t("approveAction")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid="approval-reject"
                              data-approval-type={approval.approvalType}
                              className="border-destructive/50 text-destructive"
                              disabled={resolveApproval.isPending}
                              onClick={() => handleResolveApproval(approval, "rejected")}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              {t("rejectAction")}
                            </Button>
                            {evidenceBlocked && (
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid={`approval-resolve-evidence-${approval.id}`}
                                onClick={() => setLocation(evidenceGate.route)}
                              >
                                <User className="mr-2 h-4 w-4" />
                                {t("resolveEvidence")}
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noPendingApprovals")} />
                )}
              </section>

              <section id="review-queue-section-delivery-reconciliation" data-testid="review-queue-section-delivery-reconciliation" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("deliveryVerification")}</h2>
                  <Badge variant="outline" className="border-red-500/40 text-red-300">{counts.followUpDeliveryReconciliation}</Badge>
                </div>
                {operatingLedger?.queues.followUpDeliveryReconciliation.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.followUpDeliveryReconciliation.map((item) => (
                      <Card key={item.followUpId} data-testid={`follow-up-delivery-reconciliation-${item.followUpId}`} className="border-red-500/30">
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">{item.job?.title || t("applicationNumber", { id: item.applicationId })}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.job?.company || t("employerFallback")}
                                {item.deliveryProvider ? ` - ${item.deliveryProvider}` : ""}
                                {item.deliveryRecipient ? ` ${t("toRecipient", { recipient: item.deliveryRecipient })}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="border-red-500/40 text-red-300">
                              {t("deliveryOutcome", { state: item.deliveryState })}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {t("deliveryVerificationDetail")}
                          </p>
                          {item.deliveryFailureMessage && (
                            <p className="rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-100">
                              {item.deliveryFailureMessage}
                            </p>
                          )}
                          <QueueActionStrip summary={getQueueAction("delivery_reconciliation", item)} onOpen={setLocation} />
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-500/40 text-red-200"
                            onClick={() => setLocation(getApplicationDeepLink(item.applicationId, "send-follow-up"))}
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            {t("verifyDelivery")}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noDeliveryVerification")} />
                )}
              </section>

              <section id="review-queue-section-send-handoffs" data-testid="review-queue-section-send-handoffs" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("approvedSendHandoffs")}</h2>
                  <Badge variant="outline">{counts.approvedFollowUpsReadyToSend}</Badge>
                </div>
                {operatingLedger?.queues.approvedFollowUpsReadyToSend.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.approvedFollowUpsReadyToSend.map((item) => (
                      <Card key={item.followUpId}>
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">
                                {item.job?.title || t("applicationNumber", { id: item.applicationId })}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.job?.company || t("employerFallback")}
                                {item.job?.location ? ` - ${item.job.location}` : ""}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={getReviewRiskBadgeClass(item.riskLevel)}
                            >
                              {item.purpose === "employer_reply" ? t("employerReplyLabel") : t("followUpLabel")}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {t("approvedHandoffDetail")}
                          </p>
                          {item.messagePreview && (
                            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                              {item.messagePreview}
                            </p>
                          )}
                          <QueueActionStrip
                            summary={getQueueAction("send_handoff", item)}
                            onOpen={setLocation}
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              data-testid="mark-follow-up-sent"
                              disabled={markFollowUpSent.isPending}
                              onClick={() => openSendHandoff(
                                item.followUpId,
                                item.purpose === "employer_reply"
                                  ? t("employerReplyLabel").toLowerCase()
                                  : t("followUpLabel").toLowerCase()
                              )}
                            >
                              {markFollowUpSent.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle className="mr-2 h-4 w-4" />
                              )}
                              {t("recordManualSend")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setLocation(getApplicationDeepLink(item.applicationId, "send-follow-up"))}
                            >
                              <Mail className="mr-2 h-4 w-4" />
                              {t("sendConnectedMailbox")}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noApprovedSendHandoffs")} />
                )}
              </section>

              <section id="review-queue-section-evidence-gates" data-testid="review-queue-section-evidence-gates" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("autonomousEvidenceGates")}</h2>
                  <Badge variant="outline">{counts.evidenceGates}</Badge>
                </div>
                {operatingLedger?.queues.evidenceGates.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.evidenceGates.map((item) => (
                      <Card key={item.id} data-testid={`review-evidence-gate-${item.id}`}>
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">{item.label}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {(item.blocks || []).map((block) => String(block).replace(/_/g, " ")).join(", ") || t("externalWork")}
                                {typeof item.affectedApplications === "number"
                                  ? ` - ${t("activeApplicationsCount", { count: item.affectedApplications })}`
                                  : ""}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={getReviewRiskBadgeClass(item.severity)}
                            >
                              {item.severity}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{item.detail}</p>
                          <QueueActionStrip
                            summary={getQueueAction("evidence_gate", item)}
                            onOpen={setLocation}
                            showAction={false}
                          />
                          <Button variant="outline" size="sm" onClick={() => setLocation(item.route || "/profile")}>
                            <User className="mr-2 h-4 w-4" />
                            {t("resolveEvidence")}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noAutonomousEvidenceGates")} />
                )}
              </section>

              <section id="review-queue-section-connector-readiness" data-testid="review-queue-section-connector-readiness" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("connectorReadiness")}</h2>
                  <Badge variant="outline">{counts.connectorReadiness}</Badge>
                </div>
                {operatingLedger?.queues.connectorReadiness.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.connectorReadiness.map((item) => (
                      <Card key={item.id} data-testid={`review-connector-readiness-${item.id}`}>
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">{item.label}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.providerIds?.join(", ") || t("connectorSetup")}
                                {typeof item.affectedApplications === "number"
                                  ? ` - ${t("activeApplicationsCount", { count: item.affectedApplications })}`
                                  : ""}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={getReviewRiskBadgeClass(item.riskLevel)}
                            >
                              {String(item.status).replace(/_/g, " ")}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{item.detail}</p>
                          <QueueActionStrip
                            summary={getQueueAction("connector_readiness", item)}
                            onOpen={setLocation}
                            showAction={false}
                          />
                          <Button variant="outline" size="sm" onClick={() => setLocation("/profile")}>
                            <User className="mr-2 h-4 w-4" />
                            {t("openProfileEvidence")}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noConnectorSetupItems")} />
                )}
              </section>

              <section id="review-queue-section-job-decisions" data-testid="review-queue-section-job-decisions" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("jobDecisionsHeading")}</h2>
                  <Badge variant="outline">{counts.reviewDecisions}</Badge>
                </div>
                {operatingLedger?.queues.reviewDecisions.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.reviewDecisions.map((decision) => {
                      const actionSummary = getQueueAction("job_decision", decision);
                      const actionCopy = getReviewQueueActionCopy(actionSummary);
                      const jobTitle = decision.job?.title || `Job #${decision.jobId}`;
                      const company = decision.job?.company ? ` ${t("atCompany", { company: decision.job.company })}` : "";

                      return (
                        <Card key={decision.id} data-testid="review-decision-card">
                          <CardContent className="space-y-4 pt-6">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-medium">{t("jobNeedsReview", { job: jobTitle, company })}</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {formatLocalizedDecision(decision.decision)}
                                  {decision.matchScore != null ? ` - ${t("matchPercent", { score: decision.matchScore })}` : ""}
                                  {decision.applicationId ? ` - ${t("applicationNumber", { id: decision.applicationId })}` : ""}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2 sm:justify-end">
                                <Badge
                                  variant="outline"
                                  className={getReviewRiskBadgeClass(decision.riskLevel)}
                                >
                                  {decision.riskLevel}
                                </Badge>
                                {actionSummary.approvalGated && (
                                  <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
                                    {t("reviewBlocksExecution")}
                                  </Badge>
                                )}
                                {actionSummary.externalAction === "manual_handoff" && (
                                  <Badge variant="outline" className="border-blue-500/40 text-blue-300">
                                    {t("manualAtsHandoff")}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {decision.reviewReason || decision.decisionReason || t("reviewDecisionBeforeExecution")}
                            </p>
                            <QueueActionStrip
                              summary={actionSummary}
                              onOpen={setLocation}
                              showAction={false}
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                data-testid="review-decision-save"
                                disabled={resolveDecision.isPending}
                                onClick={() => handleResolveDecision(decision, "save")}
                              >
                                <Briefcase className="mr-2 h-4 w-4" />
                                {t("saveForLater")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid="review-decision-ignore"
                                className="border-destructive/50 text-destructive"
                                disabled={resolveDecision.isPending}
                                onClick={() => handleResolveDecision(decision, "ignore")}
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                {t("ignoreAction")}
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setLocation(actionSummary.route)}>
                                <Search className="mr-2 h-4 w-4" />
                                {t(actionCopy.cta)}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noJobDecisionsReview")} />
                )}
              </section>

              <section id="review-queue-section-interview-scheduling" data-testid="review-queue-section-interview-scheduling" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("interviewSchedulingHeading")}</h2>
                  <Badge variant="outline">{counts.interviewScheduling}</Badge>
                </div>
                {operatingLedger?.queues.interviewScheduling.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.interviewScheduling.map((item) => (
                      <Card key={item.applicationId}>
                        <CardContent className="space-y-4 pt-6">
                          {(() => {
                            const control = getLocalizedInterviewSchedulingControl(item.schedulingRequirement);
                            return <>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">
                                {item.job?.title || t("applicationNumber", { id: item.applicationId })}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.job?.company || t("employerFallback")}
                                {item.job?.location ? ` - ${item.job.location}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className={control.badgeClassName}>
                              {control.badgeLabel}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {control.description}
                          </p>
                          <QueueActionStrip
                            summary={getQueueAction("interview_scheduling", item)}
                            onOpen={setLocation}
                            showAction={false}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLocation(getApplicationDeepLink(item.applicationId, control.action))}
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            {control.actionLabel}
                          </Button>
                            </>;
                          })()}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noInterviewInvitesScheduling")} />
                )}
              </section>

              <section id="review-queue-section-interview-preparation" data-testid="review-queue-section-interview-preparation" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("interviewPreparationHeading")}</h2>
                  <Badge variant="outline">{counts.interviewPreparationNeeded}</Badge>
                </div>
                {operatingLedger?.queues.interviewPreparationNeeded.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.interviewPreparationNeeded.map((item) => (
                      <Card key={item.interviewId}>
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">
                                {item.job?.title || t("applicationNumber", { id: item.applicationId })}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.job?.company || t("employerFallback")}
                                {item.scheduledAt ? ` - ${new Date(item.scheduledAt).toLocaleString(locale)}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                              {String(item.interviewType || "interview").replace(/_/g, " ")}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {t("interviewPreparationInstruction")}
                          </p>
                          <QueueActionStrip
                            summary={getQueueAction("interview_preparation", item)}
                            onOpen={setLocation}
                            showAction={false}
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={generateInterviewPreparation.isPending}
                              onClick={() => generateInterviewPreparation.mutate({ applicationId: item.applicationId })}
                            >
                              {generateInterviewPreparation.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <ClipboardCheck className="mr-2 h-4 w-4" />
                              )}
                              {t("generatePrep")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setLocation(getApplicationDeepLink(item.applicationId, "view"))}
                            >
                              <Briefcase className="mr-2 h-4 w-4" />
                              {t("openApplication")}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noInterviewPreparationNeeded")} />
                )}
              </section>

              <section id="review-queue-section-interview-outcomes" data-testid="review-queue-section-interview-outcomes" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("interviewOutcomesHeading")}</h2>
                  <Badge variant="outline">{counts.interviewOutcomesNeeded}</Badge>
                </div>
                {operatingLedger?.queues.interviewOutcomesNeeded.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.interviewOutcomesNeeded.map((item) => (
                      <Card key={item.interviewId}>
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">
                                {item.job?.title || t("applicationNumber", { id: item.applicationId })}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.job?.company || t("employerFallback")}
                                {item.completedAt ? ` - ${t("completedLabel")} ${new Date(item.completedAt).toLocaleDateString(locale)}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                              {t("outcomeNeeded")}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {t("interviewOutcomeInstruction")}
                          </p>
                          <QueueActionStrip
                            summary={getQueueAction("interview_outcome", item)}
                            onOpen={setLocation}
                            showAction={false}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLocation(getApplicationDeepLink(item.applicationId, "record-interview-outcome", item.interviewId))}
                          >
                            <Briefcase className="mr-2 h-4 w-4" />
                            {t("recordOutcome")}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noInterviewOutcomesNeeded")} />
                )}
              </section>

              <section id="review-queue-section-inbox-response-candidates" data-testid="review-queue-section-inbox-response-candidates" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("inboxResponseCandidatesHeading")}</h2>
                  <Badge variant="outline">{counts.inboxResponseCandidates}</Badge>
                </div>
                {operatingLedger?.queues.inboxResponseCandidates.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.inboxResponseCandidates.map((candidate) => (
                      <Card key={candidate.id} data-testid={`review-inbox-response-candidate-${candidate.id}`}>
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{candidate.job?.title || t("applicationNumber", { id: candidate.applicationId })}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {candidate.job?.company || t("employerFallback")}
                                {candidate.job?.location ? ` - ${candidate.job.location}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                              {candidate.suggestedResponseType.replace(/_/g, " ")}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{candidate.subject || t("applicationInboxMessage")}</p>
                          {candidate.preview ? (
                            <p className="line-clamp-3 text-sm text-muted-foreground">{candidate.preview}</p>
                          ) : null}
                          <QueueActionStrip
                            summary={getQueueAction("inbox_response_candidate", candidate)}
                            onOpen={setLocation}
                            showAction={false}
                          />
                          <div className="max-w-xs space-y-2">
                            <label className="text-sm font-medium" htmlFor={`inbox-response-type-${candidate.id}`}>
                              {t("confirmAs")}
                            </label>
                            <Select
                              value={inboxResponseTypeOverrides[candidate.id] ?? candidate.suggestedResponseType}
                              onValueChange={(value: InboxResponseType) => setInboxResponseTypeOverrides((current) => ({
                                ...current,
                                [candidate.id]: value,
                              }))}
                            >
                              <SelectTrigger id={`inbox-response-type-${candidate.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="interview_invite">{t("responseTypeInterviewInvite")}</SelectItem>
                                <SelectItem value="offer">{t("responseTypeOffer")}</SelectItem>
                                <SelectItem value="employer_question">{t("responseTypeEmployerQuestion")}</SelectItem>
                                <SelectItem value="rejection">{t("responseTypeRejection")}</SelectItem>
                                <SelectItem value="other">{t("responseTypeOther")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => confirmInboxResponseCandidate(
                                candidate,
                                inboxResponseTypeOverrides[candidate.id] ?? candidate.suggestedResponseType
                              )}
                              disabled={ingestInboxResponse.isPending || dismissInboxResponseCandidate.isPending}
                            >
                              {ingestInboxResponse.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                              {t("confirmClassification")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => dismissInboxResponseCandidate.mutate({ candidateId: candidate.id })}
                              disabled={ingestInboxResponse.isPending || dismissInboxResponseCandidate.isPending}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              {t("dismissAction")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setLocation(getApplicationDeepLink(candidate.applicationId, "view"))}
                            >
                              <Briefcase className="mr-2 h-4 w-4" />
                              {t("sendViaConnectedMailbox")}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noInboxConfirmations")} />
                )}
              </section>

              <section id="review-queue-section-employer-replies" data-testid="review-queue-section-employer-replies" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("employerRepliesHeading")}</h2>
                  <Badge variant="outline">{counts.employerResponsesNeedingReply}</Badge>
                </div>
                {operatingLedger?.queues.employerResponsesNeedingReply.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.employerResponsesNeedingReply.map((item) => (
                      <Card key={item.responseId}>
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">
                                {item.job?.title || t("applicationNumber", { id: item.applicationId })}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.job?.company || t("employerFallback")}
                                {item.job?.location ? ` - ${item.job.location}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="border-blue-500/40 text-blue-300">
                              {item.responseType ? String(item.responseType).replace(/_/g, " ") : t("employerResponseFallback")}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {item.summary || t("employerResponseReviewInstruction")}
                          </p>
                          <QueueActionStrip
                            summary={getQueueAction("employer_reply", item)}
                            onOpen={setLocation}
                            showAction={false}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLocation(getApplicationDeepLink(item.applicationId, "employer-response"))}
                          >
                            <MessageSquare className="mr-2 h-4 w-4" />
                            {t("openEmployerResponse")}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noEmployerRepliesNeeded")} />
                )}
              </section>

              <section id="review-queue-section-follow-ups" data-testid="review-queue-section-follow-ups" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("followUpDraftingHeading")}</h2>
                  <Badge variant="outline">{counts.followUpsDue}</Badge>
                </div>
                {operatingLedger?.queues.followUpsDue.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.followUpsDue.map((item) => (
                      <Card key={item.applicationId}>
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">
                                {item.job?.title || t("applicationNumber", { id: item.applicationId })}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.job?.company || t("employerFallback")}
                                {item.job?.location ? ` - ${item.job.location}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
                              {String(item.messageType || "follow-up").replace(/_/g, " ")}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {item.reason || t("followUpReasonFallback")}
                            {typeof item.daysSinceActivity === "number"
                              ? ` ${t("lastActivityDaysAgo", { count: item.daysSinceActivity })}`
                              : ""}
                          </p>
                          <QueueActionStrip
                            summary={getQueueAction("follow_up", item)}
                            onOpen={setLocation}
                            showAction={false}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLocation(getApplicationDeepLink(item.applicationId, "follow-up"))}
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            {t("openFollowUp")}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noFollowUpsDue")} />
                )}
              </section>

              <section id="review-queue-section-success-fees" data-testid="review-queue-section-success-fees" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("successFeeComplianceHeading")}</h2>
                  <Badge variant="outline">{counts.successFeeCompliance}</Badge>
                </div>
                {operatingLedger?.queues.successFeeCompliance.length ? (
                  <div className="space-y-3">
                    {operatingLedger.queues.successFeeCompliance.map((item, index) => (
                      <Card key={`${item.type}-${item.successFeeId || item.approvalId || index}`}>
                        <CardContent className="space-y-4 pt-6">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">
                                {item.employerName || t("successFeeReviewFallback")}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.jobTitle || item.action}
                                {item.nextVerificationDue
                                  ? ` - ${t("dueLabel")} ${formatCalendarDate(item.nextVerificationDue, locale)}`
                                  : ""}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={getReviewRiskBadgeClass(item.priority)}
                            >
                              {String(item.type).replace(/_/g, " ")}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {item.action}
                            {typeof item.daysUntilDue === "number"
                              ? ` ${item.daysUntilDue < 0
                                  ? t("daysOverdue", { count: Math.abs(item.daysUntilDue) })
                                  : t("daysRemaining", { count: item.daysUntilDue })}`
                              : ""}
                          </p>
                          {item.responseSummary && (
                            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                              {item.responseSummary}
                            </p>
                          )}
                          <QueueActionStrip
                            summary={getQueueAction("success_fee", item)}
                            onOpen={setLocation}
                            showAction={false}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (item.applicationId) {
                                setLocation(getApplicationDeepLink(item.applicationId, "view"));
                                return;
                              }
                              setLocation("/billing");
                            }}
                          >
                            <DollarSign className="mr-2 h-4 w-4" />
                            {t(item.type === "offer_attribution" ? "openOfferReview" : "openBilling")}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noSuccessFeeReview")} />
                )}
              </section>
            </div>

            <div className="space-y-6">
              <section id="review-queue-section-profile-readiness" data-testid="review-queue-section-profile-readiness" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("profileReadinessHeading")}</h2>
                  <Badge variant="outline">
                    {counts.profileBlockers + counts.profileWarnings}
                  </Badge>
                </div>
                <div className="rounded-md border bg-card p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("readinessScore")}</span>
                    <span className="font-medium">{operatingLedger?.readiness.score ?? 0}%</span>
                  </div>
                  <Separator className="my-4" />
                  <div className="space-y-3">
                    {operatingLedger?.readiness.blockers.map((gap) => (
                      <ReadinessGap key={gap.key} tone="blocker" label={gap.label} text={gap.recommendation} />
                    ))}
                    {operatingLedger?.readiness.warnings.map((gap) => (
                      <ReadinessGap key={gap.key} tone="warning" label={gap.label} text={gap.recommendation} />
                    ))}
                    {!counts.profileBlockers && !counts.profileWarnings && (
                      <EmptyQueueLine label={t("noProfileReadinessGaps")} />
                    )}
                  </div>
                  {(counts.profileBlockers > 0 || counts.profileWarnings > 0) && (
                    <QueueActionStrip
                      summary={getQueueAction("profile_gap", {})}
                      onOpen={setLocation}
                      showAction={false}
                      className="mt-4"
                    />
                  )}
                  {(counts.profileBlockers > 0 || counts.profileWarnings > 0) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 w-full"
                      onClick={() => setLocation("/profile")}
                    >
                      <User className="mr-2 h-4 w-4" />
                      {t("improveProfile")}
                    </Button>
                  )}
                </div>
              </section>

              {canReviewAdminItems && (
                <section id="review-queue-section-admin-reviews" data-testid="review-queue-section-admin-reviews" className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">{t("adminOperatingReviews")}</h2>
                    <Badge variant="outline">{counts.adminReviews}</Badge>
                  </div>
                  {operatingLedger?.queues.adminReviews.length ? (
                    <div className="space-y-3">
                      {operatingLedger.queues.adminReviews.map((review) => (
                        <Card key={review.id}>
                          <CardContent className="space-y-4 pt-6">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">{review.title}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{review.category}</p>
                              </div>
                              <Badge
                                variant="outline"
                                className={getReviewRiskBadgeClass(review.priority)}
                              >
                                {review.priority}
                              </Badge>
                            </div>
                            {review.description && (
                              <p className="text-sm text-muted-foreground">{review.description}</p>
                            )}
                            <QueueActionStrip
                              summary={getQueueAction("admin_review", review)}
                              onOpen={setLocation}
                              showAction={false}
                            />
                            <Button variant="outline" size="sm" onClick={() => setLocation("/admin")}>
                              <Shield className="mr-2 h-4 w-4" />
                              {t("openAdminPanel")}
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <EmptyQueueLine label={t("noAdminOperatingReviews")} />
                  )}
                </section>
              )}

              <section id="review-queue-section-audit" data-testid="review-queue-section-audit" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <History className="h-4 w-4" />
                    {t("recentAuditTrailHeading")}
                  </h2>
                  <Badge variant="outline">{auditTrail?.length ?? 0}</Badge>
                </div>
                {auditTrail?.length ? (
                  <div className="space-y-3">
                    {auditTrail.map((event) => (
                      <Card key={event.id}>
                        <CardContent className="space-y-3 pt-6">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">{formatAuditAction(event.action)}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {event.entityType} #{event.entityId} - {event.actor}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={getReviewRiskBadgeClass(event.riskLevel)}
                            >
                              {event.riskLevel}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(event.createdAt).toLocaleString(locale)}
                            {event.source ? ` - ${event.source}` : ""}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyQueueLine label={t("noAuditEvents")} />
                )}
              </section>
            </div>
          </div>
        )}
      </div>
      <Dialog
        open={sendHandoff !== null}
        onOpenChange={(open) => {
          if (!open && !markFollowUpSent.isPending) {
            setSendHandoff(null);
            setDeliveryConfirmation("");
          }
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">{t("confirmExternalDelivery")}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {t("confirmExternalDeliveryDescription", {
                kind: sendHandoff?.label || t("followUpLabel").toLowerCase(),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-200" htmlFor="follow-up-delivery-confirmation">
              {t("deliveryConfirmation")}
            </label>
            <Textarea
              id="follow-up-delivery-confirmation"
              value={deliveryConfirmation}
              onChange={(event) => setDeliveryConfirmation(event.target.value)}
              placeholder={t("manualDeliveryPlaceholder")}
              className="min-h-24 bg-slate-800 border-slate-700 text-white"
              maxLength={1000}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={markFollowUpSent.isPending}
              onClick={() => {
                setSendHandoff(null);
                setDeliveryConfirmation("");
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={markFollowUpSent.isPending || deliveryConfirmation.trim().length < 8 || !sendHandoff}
              onClick={() => {
                if (!sendHandoff) return;
                markFollowUpSent.mutate({
                  followUpId: sendHandoff.followUpId,
                  deliveryConfirmation,
                });
              }}
            >
              {markFollowUpSent.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              {t("recordManualSend")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
function formatAuditAction(action: string) {
  return action
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function QueueActionStrip({
  summary,
  onOpen,
  className = "",
  showAction = true,
}: {
  summary: ReviewQueueActionSummary;
  onOpen: (route: string) => void;
  className?: string;
  showAction?: boolean;
}) {
  const { t } = useLocale();
  const copy = getReviewQueueActionCopy(summary);
  const externalLabel = summary.externalAction === "delivery_reconciliation"
    ? t("verificationRequired")
    : summary.externalAction === "approved_delivery"
    ? t("controlApprovedDeliveryLabel")
    : summary.externalAction === "manual_handoff"
    ? t("manualHandoffLabel")
    : summary.externalAction === "blocked_until_approved"
      ? t("blockedUntilApproved")
      : t("internalActionLabel");

  return (
    <div
      data-testid="review-queue-action"
      data-action-label={summary.copyId}
      className={`rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3 ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-cyan-200">{t(copy.label)}</p>
            <Badge variant="outline" className={getReviewRiskBadgeClass(summary.risk)}>
              {summary.risk}
            </Badge>
            <Badge variant="outline" className="border-slate-600 text-slate-300">
              {summary.approvalGated ? t("approvalGated") : externalLabel}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {summary.detailOverride || t(copy.detail)}
          </p>
        </div>
        {showAction && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => onOpen(summary.route)}
          >
            <ClipboardCheck className="mr-2 h-4 w-4" />
            {t(copy.cta)}
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyQueueLine({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function ReadinessGap({
  tone,
  label,
  text,
}: {
  tone: "blocker" | "warning";
  label: string;
  text: string;
}) {
  const toneClass = tone === "blocker"
    ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
    : "border-slate-700 bg-background text-muted-foreground";

  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 text-sm">{text}</p>
        </div>
      </div>
    </div>
  );
}
