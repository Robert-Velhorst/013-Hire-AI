import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { parseApplicationDeepLink } from "@/lib/applicationDeepLinks";
import {
  getApplicationPipelineControlSummary,
  type ApplicationPipelineTab,
} from "@/lib/applicationPipelineControl";
import { getApplicationLedgerSummary } from "@/lib/applicationLedgerSummary";
import { getApplicationMaterialEvidenceSummary } from "@/lib/applicationMaterialEvidence";
import { getInterviewOperatingSummary } from "@/lib/interviewOperatingSummary";
import { getInterviewSchedulingControl } from "@/lib/interviewSchedulingControl";
import { getOfferOperatingSummary } from "@/lib/offerOperatingSummary";
import { getApplicationNextActions, type ApplicationNextActionId } from "@/lib/applicationNextActions";
import { getApplicationEvidenceGateSummary } from "@/lib/applicationEvidenceGates";
import { getSafeExternalUrl, openExternalUrl } from "@/lib/externalUrl";
import { formatJobSalary } from "@/lib/jobSalary";
import { formatCalendarDate } from "@/lib/calendarDate";
import { useLocale } from "@/contexts/LocaleContext";
import { APPLICATION_LEDGER_WINDOW_LIMITS } from "@shared/applicationLedgerWindow";
import { useLocation } from "wouter";
import AppHeader from "@/components/AppHeader";
import { ReportHireDialog } from "@/components/ReportHireDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Activity,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  MessageSquare,
  Calendar,
  Building2,
  MapPin,
  DollarSign,
  FileText,
  ExternalLink,
  Loader2,
  RefreshCw,
  TrendingUp,
  Target,
  AlertCircle,
  Mail,
  User,
} from "lucide-react";

type ApplicationStatus = "pending" | "applied" | "viewed" | "interview" | "offer" | "rejected" | "accepted" | "withdrawn";
type SubmissionEvidenceSource = "manual" | "employer_portal" | "email_confirmation" | "ats_confirmation";
type EmployerResponseType = "viewed" | "rejection" | "interview_invite" | "offer" | "employer_question" | "other";
type EmployerResponseSource = "email" | "employer_portal" | "linkedin" | "phone" | "other";
type InterviewType = "phone" | "video" | "onsite" | "technical" | "behavioral" | "panel";
type InterviewOutcomeType = "next_round" | "offer" | "rejection" | "no_response" | "other";
type FollowUpMessageType = "reminder" | "thank_you" | "status_check";

function getFollowUpType(status?: string | null): FollowUpMessageType {
  if (status === "interview") return "thank_you";
  if (status === "viewed") return "status_check";
  return "reminder";
}

function canGenerateFollowUp(status?: string | null) {
  return !["pending", "withdrawn", "rejected", "offer", "accepted"].includes(status || "");
}

function parsePreparationList(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item).trim()).filter(Boolean)
      : [];
  } catch {
    return value
      .split(/\n+/)
      .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
      .filter(Boolean);
  }
}

function toDateTimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

function defaultInterviewDateTimeLocal() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return toDateTimeLocalValue(date);
}

export default function Applications() {
  const { user, loading: authLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const { locale, t } = useLocale();
  const applicationDeepLink = useMemo(() => {
    const source = location.includes("?") ? location : window.location.search;
    return parseApplicationDeepLink(source);
  }, [location]);
  const [selectedApplication, setSelectedApplication] = useState<any>(null);
  const [handledDeepLink, setHandledDeepLink] = useState("");
  const [activeTab, setActiveTab] = useState<ApplicationPipelineTab>("all");
  const [followUpDraft, setFollowUpDraft] = useState("");
  const [followUpApplicationId, setFollowUpApplicationId] = useState<number | null>(null);
  const [followUpDraftPurpose, setFollowUpDraftPurpose] = useState<"routine_follow_up" | "employer_reply">("routine_follow_up");
  const [followUpSourceResponseId, setFollowUpSourceResponseId] = useState<number | null>(null);
  const [confirmingFollowUpSentId, setConfirmingFollowUpSentId] = useState<number | null>(null);
  const [followUpDeliveryConfirmation, setFollowUpDeliveryConfirmation] = useState("");
  const [followUpMailProvider, setFollowUpMailProvider] = useState<"gmail" | "outlook">("gmail");
  const [followUpMailRecipient, setFollowUpMailRecipient] = useState("");
  const [pendingFollowUpSendApplicationId, setPendingFollowUpSendApplicationId] = useState<number | null>(null);
  const [pendingEmployerReplyApplicationId, setPendingEmployerReplyApplicationId] = useState<number | null>(null);
  const [confirmingApplication, setConfirmingApplication] = useState<any>(null);
  const [submissionSource, setSubmissionSource] = useState<SubmissionEvidenceSource>("employer_portal");
  const [submissionEvidence, setSubmissionEvidence] = useState("");
  const [submissionConfirmationUrl, setSubmissionConfirmationUrl] = useState("");
  const [responseApplication, setResponseApplication] = useState<any>(null);
  const [employerResponseType, setEmployerResponseType] = useState<EmployerResponseType>("viewed");
  const [employerResponseSource, setEmployerResponseSource] = useState<EmployerResponseSource>("email");
  const [employerResponseSourceReference, setEmployerResponseSourceReference] = useState("");
  const [employerResponseSummary, setEmployerResponseSummary] = useState("");
  const [schedulingApplication, setSchedulingApplication] = useState<any>(null);
  const [interviewType, setInterviewType] = useState<InterviewType>("video");
  const [interviewScheduledAt, setInterviewScheduledAt] = useState(defaultInterviewDateTimeLocal);
  const [interviewDuration, setInterviewDuration] = useState("60");
  const [interviewLocation, setInterviewLocation] = useState("");
  const [interviewMeetingLink, setInterviewMeetingLink] = useState("");
  const [interviewerName, setInterviewerName] = useState("");
  const [interviewerTitle, setInterviewerTitle] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [outcomeInterview, setOutcomeInterview] = useState<any>(null);
  const [pendingOutcomeInterviewId, setPendingOutcomeInterviewId] = useState<number | null>(null);
  const [interviewOutcome, setInterviewOutcome] = useState<InterviewOutcomeType>("next_round");
  const [interviewOutcomeSource, setInterviewOutcomeSource] = useState<EmployerResponseSource>("email");
  const [interviewOutcomeSourceReference, setInterviewOutcomeSourceReference] = useState("");
  const [interviewOutcomeSummary, setInterviewOutcomeSummary] = useState("");
  const [reportHireOpen, setReportHireOpen] = useState(false);
  const [reportHireApplicationId, setReportHireApplicationId] = useState<number | undefined>(undefined);
  const [acceptingOfferApplication, setAcceptingOfferApplication] = useState<any>(null);
  const [offerAcceptanceConfirmed, setOfferAcceptanceConfirmed] = useState(false);
  const [offerAcceptanceNote, setOfferAcceptanceNote] = useState("");
  const [decliningOfferApplication, setDecliningOfferApplication] = useState<any>(null);
  const [offerDeclineConfirmed, setOfferDeclineConfirmed] = useState(false);
  const [offerDeclineNote, setOfferDeclineNote] = useState("");

  const {
    data: applicationPages,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = trpc.applications.listPage.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined }
  );
  const applications = useMemo(
    () => applicationPages?.pages.map((page) => page.items).flat() ?? [],
    [applicationPages]
  );
  const { data: applicationSummary } = trpc.applications.getSummary.useQuery();
  const { data: deepLinkedApplication } = trpc.applications.getById.useQuery(
    { applicationId: applicationDeepLink?.applicationId ?? 1 },
    { enabled: Boolean(applicationDeepLink) }
  );
  const approvalApplicationIds = useMemo(
    () => Array.from(new Set([
      selectedApplication?.id,
      deepLinkedApplication?.id,
      ...applications.map((application) => application.id),
    ].filter((applicationId): applicationId is number =>
      typeof applicationId === "number" && Number.isInteger(applicationId) && applicationId > 0
    ))).slice(0, 250),
    [applications, deepLinkedApplication?.id, selectedApplication?.id]
  );
  const {
    data: followUpPages,
    isFetchingNextPage: followUpsFetchingNextPage,
    hasNextPage: followUpsHasNextPage,
    fetchNextPage: fetchNextFollowUpsPage,
    refetch: refetchFollowUps,
  } = trpc.applications.getFollowUpPage.useInfiniteQuery(
    { applicationId: selectedApplication?.id || 1, limit: 10 },
    {
      enabled: Boolean(selectedApplication?.id),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  );
  const followUps = useMemo(
    () => followUpPages?.pages.flatMap((page) => page.items) ?? [],
    [followUpPages]
  );
  const {
    data: ledgerArtifacts,
    isLoading: ledgerArtifactsLoading,
    refetch: refetchLedgerArtifacts,
  } = trpc.applications.getLedgerArtifacts.useQuery(
    { applicationId: selectedApplication?.id || 0 },
    { enabled: Boolean(selectedApplication?.id) }
  );
  const {
    data: interviewPages,
    isLoading: interviewsLoading,
    refetch: refetchInterviews,
    hasNextPage: hasEarlierInterviewHistory,
    fetchNextPage: fetchEarlierInterviewHistory,
    isFetchingNextPage: isFetchingEarlierInterviewHistory,
  } = trpc.applications.getInterviewPage.useInfiniteQuery(
    {
      applicationId: selectedApplication?.id || 0,
      historyLimit: 10,
    },
    {
      enabled: Boolean(selectedApplication?.id),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  );
  const interviews = useMemo(
    () => [
      ...(interviewPages?.pages[0]?.activeItems ?? []),
      ...(interviewPages?.pages.flatMap((page) => page.historyItems) ?? []),
    ],
    [interviewPages]
  );
  const activeInterviewWindowTruncated = interviewPages?.pages[0]?.activeHasMore === true;
  const {
    data: approvals,
    refetch: refetchApprovals,
  } = trpc.applications.listApprovals.useQuery(
    { applicationIds: approvalApplicationIds },
    { enabled: Boolean(user) && approvalApplicationIds.length > 0 }
  );
  const {
    data: operatingLedger,
    refetch: refetchOperatingLedger,
  } = trpc.applications.getOperatingLedger.useQuery(undefined, { enabled: Boolean(user) });
  const {
    data: successFees = [],
    refetch: refetchSuccessFees,
  } = trpc.successFees.listForApplications.useQuery(
    { applicationIds: approvalApplicationIds },
    { enabled: Boolean(user) && approvalApplicationIds.length > 0 }
  );
  const {
    data: offerAttributionReviews = [],
    refetch: refetchOfferAttributionReviews,
  } = trpc.successFees.listOfferAttributionReviewsForApplications.useQuery(
    { applicationIds: approvalApplicationIds },
    { enabled: Boolean(user) && approvalApplicationIds.length > 0 }
  );

  // Update status mutation (for withdraw)
  const updateStatusMutation = trpc.applications.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Application updated");
      setSelectedApplication(null);
      refetch();
      refetchOperatingLedger();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update application");
    },
  });
  const confirmOfferAcceptanceMutation = trpc.applications.confirmOfferAcceptance.useMutation({
    onSuccess: () => {
      toast.success("Offer acceptance recorded");
      setAcceptingOfferApplication(null);
      setOfferAcceptanceConfirmed(false);
      setOfferAcceptanceNote("");
      setSelectedApplication(null);
      refetch();
      refetchLedgerArtifacts();
      refetchOfferAttributionReviews();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to record offer acceptance"),
  });
  const declineOfferMutation = trpc.applications.declineOffer.useMutation({
    onSuccess: () => {
      toast.success("Offer decline recorded");
      setDecliningOfferApplication(null);
      setOfferDeclineConfirmed(false);
      setOfferDeclineNote("");
      setSelectedApplication(null);
      refetch();
      refetchApprovals();
      refetchLedgerArtifacts();
      refetchOfferAttributionReviews();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to record offer decline"),
  });
  const generateFollowUpMutation = trpc.applications.generateFollowUpEmail.useMutation({
    onSuccess: ({ email }, variables) => {
      setFollowUpDraft(email);
      setFollowUpApplicationId(variables.applicationId);
      setFollowUpDraftPurpose("routine_follow_up");
      setFollowUpSourceResponseId(null);
    },
    onError: (error) => toast.error(error.message || "Failed to generate follow-up"),
  });
  const generateEmployerReplyMutation = trpc.applications.generateEmployerReplyEmail.useMutation({
    onSuccess: ({ email, responseId }, variables) => {
      setFollowUpDraft(email);
      setFollowUpApplicationId(variables.applicationId);
      setFollowUpDraftPurpose("employer_reply");
      setFollowUpSourceResponseId(responseId);
    },
    onError: (error) => toast.error(error.message || "Failed to generate employer reply"),
  });
  const createFollowUpMutation = trpc.applications.createFollowUp.useMutation({
    onSuccess: () => {
      toast.success(followUpDraftPurpose === "employer_reply" ? "Employer reply draft saved" : "Follow-up draft saved");
      setFollowUpDraft("");
      setFollowUpApplicationId(null);
      setFollowUpDraftPurpose("routine_follow_up");
      setFollowUpSourceResponseId(null);
      refetchFollowUps();
      refetchApprovals();
      refetchLedgerArtifacts();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to save follow-up"),
  });
  const markFollowUpSentMutation = trpc.applications.markFollowUpSent.useMutation({
    onSuccess: () => {
      toast.success("Follow-up marked as sent");
      setConfirmingFollowUpSentId(null);
      setFollowUpDeliveryConfirmation("");
      refetchFollowUps();
      refetchApprovals();
      refetch();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to update follow-up"),
  });
  const sendFollowUpMutation = trpc.applications.sendFollowUp.useMutation({
    onSuccess: (result) => {
      toast.success(result.existing ? "Follow-up was already sent" : `Follow-up sent through ${result.provider === "gmail" ? "Gmail" : "Outlook"}`);
      setConfirmingFollowUpSentId(null);
      setFollowUpDeliveryConfirmation("");
      setFollowUpMailRecipient("");
      refetchFollowUps();
      refetchApprovals();
      refetch();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Unable to send follow-up"),
  });
  const markFollowUpResponseMutation = trpc.applications.markFollowUpResponse.useMutation({
    onSuccess: () => {
      toast.success("Response recorded");
      refetchFollowUps();
      refetch();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to record response"),
  });
  const confirmSubmissionMutation = trpc.applications.confirmSubmission.useMutation({
    onSuccess: () => {
      toast.success("Submission confirmed with evidence");
      setConfirmingApplication(null);
      setSelectedApplication(null);
      setSubmissionEvidence("");
      setSubmissionConfirmationUrl("");
      refetch();
      refetchApprovals();
      refetchLedgerArtifacts();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to confirm submission"),
  });
  const recordResponseMutation = trpc.applications.recordResponse.useMutation({
    onSuccess: (result) => {
      toast.success(result.existing ? "Existing employer response kept" : "Employer response recorded");
      setResponseApplication(null);
      setSelectedApplication(null);
      setEmployerResponseType("viewed");
      setEmployerResponseSource("email");
      setEmployerResponseSourceReference("");
      setEmployerResponseSummary("");
      refetch();
      refetchApprovals();
      refetchLedgerArtifacts();
      refetchOfferAttributionReviews();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to record employer response"),
  });
  const scheduleInterviewMutation = trpc.applications.scheduleInterview.useMutation({
    onSuccess: () => {
      toast.success("Interview scheduled");
      setSchedulingApplication(null);
      setInterviewScheduledAt(defaultInterviewDateTimeLocal());
      setInterviewDuration("60");
      setInterviewLocation("");
      setInterviewMeetingLink("");
      setInterviewerName("");
      setInterviewerTitle("");
      setInterviewNotes("");
      refetchInterviews();
      refetchLedgerArtifacts();
      refetch();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to schedule interview"),
  });
  const updateInterviewStatusMutation = trpc.applications.updateInterviewStatus.useMutation({
    onSuccess: (_, variables) => {
      toast.success(variables.status === "completed" ? "Interview marked completed" : "Interview updated");
      refetchInterviews();
      refetchLedgerArtifacts();
      refetch();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to update interview"),
  });
  const recordInterviewOutcomeMutation = trpc.applications.recordInterviewOutcome.useMutation({
    onSuccess: (result) => {
      toast.success(result.outcome === "offer" ? "Interview outcome recorded; offer review queued" : "Interview outcome recorded");
      setOutcomeInterview(null);
      setInterviewOutcome("next_round");
      setInterviewOutcomeSource("email");
      setInterviewOutcomeSourceReference("");
      setInterviewOutcomeSummary("");
      refetchInterviews();
      refetchLedgerArtifacts();
      refetchApprovals();
      refetchOfferAttributionReviews();
      refetch();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to record interview outcome"),
  });
  const resolveApprovalMutation = trpc.applications.resolveApproval.useMutation({
    onSuccess: (_, variables) => {
      toast.success(variables.status === "approved" ? "Approval recorded" : "Approval rejected");
      refetchApprovals();
      refetchFollowUps();
      refetchLedgerArtifacts();
      refetchOfferAttributionReviews();
      refetchSuccessFees();
      refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Failed to update approval"),
  });

  const getStatusColor = (status: ApplicationStatus) => {
    switch (status) {
      case "pending":
        return "bg-slate-500/20 text-slate-400 border-slate-500/30";
      case "applied":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "viewed":
        return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      case "interview":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      case "offer":
      case "accepted":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case "rejected":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "withdrawn":
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
      default:
        return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    }
  };

  const getStatusIcon = (status: ApplicationStatus) => {
    switch (status) {
      case "pending":
        return <Clock className="w-4 h-4" />;
      case "applied":
        return <Send className="w-4 h-4" />;
      case "viewed":
        return <Target className="w-4 h-4" />;
      case "interview":
        return <MessageSquare className="w-4 h-4" />;
      case "offer":
      case "accepted":
        return <CheckCircle className="w-4 h-4" />;
      case "rejected":
        return <XCircle className="w-4 h-4" />;
      case "withdrawn":
        return <AlertCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getLedgerSummaryBadgeClass = (status: string) => {
    switch (status) {
      case "approval_blocked":
      case "evidence_required":
        return "border-amber-500/30 text-amber-300";
      case "offer_action":
      case "response_received":
        return "border-emerald-500/30 text-emerald-300";
      case "closed":
        return "border-slate-600 text-slate-300";
      case "follow_up_review":
      case "follow_up_due":
        return "border-blue-500/30 text-blue-300";
      default:
        return "border-cyan-500/30 text-cyan-300";
    }
  };

  const getInterviewSummaryBadgeClass = (status: string) => {
    switch (status) {
      case "needs_scheduling":
      case "cancelled":
        return "border-amber-500/30 text-amber-300";
      case "scheduled":
        return "border-emerald-500/30 text-emerald-300";
      case "completed":
        return "border-blue-500/30 text-blue-300";
      default:
        return "border-slate-600 text-slate-300";
    }
  };

  const getOfferSummaryBadgeClass = (status: string) => {
    switch (status) {
      case "attribution_review":
      case "report_hire":
      case "offer_decision":
        return "border-amber-500/30 text-amber-300";
      case "verification_pending":
        return "border-blue-500/30 text-blue-300";
      case "fee_active":
        return "border-emerald-500/30 text-emerald-300";
      case "fee_attention":
        return "border-red-500/30 text-red-300";
      case "fee_closed":
        return "border-slate-600 text-slate-300";
      default:
        return "border-slate-600 text-slate-300";
    }
  };

  const getStatusLabel = (status: ApplicationStatus) => ({
    pending: t("queuedLabel"),
    applied: t("appliedLabel"),
    viewed: t("statusViewed"),
    interview: t("statusInterview"),
    offer: t("statusOffer"),
    rejected: t("statusRejected"),
    accepted: t("statusAccepted"),
    withdrawn: t("statusWithdrawn"),
  })[status];

  const getApplicationDateLabel = (application: any) => {
    const date = application.appliedDate || application.createdAt;
    const prefix = application.status === "pending" ? t("queuedLabel") : t("appliedLabel");
    return `${prefix} ${new Date(date).toLocaleDateString(locale)}`;
  };

  const formatAttemptDate = (date?: string | Date | null) =>
    date ? new Date(date).toLocaleString(locale) : t("inProgress");

  const getFollowUpApproval = (followUpId: number) =>
    approvals?.find((approval) =>
      approval.entityType === "follow_up" &&
      approval.entityId === followUpId &&
      approval.approvalType === "follow_up_send"
    );

  const getApplicationSubmissionApproval = (applicationId: number) =>
    approvals?.find((approval) =>
      approval.entityType === "application" &&
      approval.entityId === applicationId &&
      approval.approvalType === "application_submission"
    );

  const getOfferAttributionApplicationId = (review: any) => {
    if (typeof review?.approval?.applicationId === "number") return review.approval.applicationId;
    if (review?.approval?.entityType === "application" && typeof review.approval.entityId === "number") {
      return review.approval.entityId;
    }
    if (typeof review?.application?.id === "number") return review.application.id;
    return null;
  };

  const getOfferAttributionReview = (applicationId: number) =>
    offerAttributionReviews.find((review: any) =>
      getOfferAttributionApplicationId(review) === applicationId
    );

  const getApplicationSuccessFee = (applicationId: number) =>
    successFees.find((fee: any) => fee.applicationId === applicationId);

  const selectedSubmissionApproval = selectedApplication
    ? getApplicationSubmissionApproval(selectedApplication.id)
    : null;
  const selectedOfferAttributionReview = selectedApplication
    ? getOfferAttributionReview(selectedApplication.id)
    : null;
  const selectedSuccessFee = selectedApplication
    ? getApplicationSuccessFee(selectedApplication.id)
    : null;
  const selectedLedgerSummary = selectedApplication
    ? getApplicationLedgerSummary(
      selectedApplication,
      ledgerArtifacts,
      selectedSubmissionApproval,
      followUps || []
    )
    : null;
  const selectedMaterialEvidence = ledgerArtifacts?.material
    ? getApplicationMaterialEvidenceSummary(ledgerArtifacts.material)
    : null;
  const selectedInterviewPreparation = ledgerArtifacts?.interviewPreparation
    ? {
        questions: parsePreparationList(ledgerArtifacts.interviewPreparation.questions),
        tips: parsePreparationList(ledgerArtifacts.interviewPreparation.coachingTips),
        companyInsights: ledgerArtifacts.interviewPreparation.companyInsights || "",
      }
    : null;
  const selectedInterviewSummary = selectedApplication
    ? getInterviewOperatingSummary(selectedApplication, interviews || [])
    : null;
  const selectedInterviewSchedulingItem = selectedApplication
    ? operatingLedger?.queues.interviewScheduling.find((item) => item.applicationId === selectedApplication.id)
    : null;
  const selectedInterviewSchedulingControl = selectedInterviewSchedulingItem
    ? getInterviewSchedulingControl(selectedInterviewSchedulingItem.schedulingRequirement)
    : null;
  const canScheduleSelectedInterview = selectedInterviewSchedulingControl?.canSchedule === true;
  const selectedInterviewSummaryForActions = selectedInterviewSummary
    ? { ...selectedInterviewSummary, canSchedule: canScheduleSelectedInterview }
    : null;
  const selectedOfferSummary = selectedApplication
    ? getOfferOperatingSummary(selectedApplication, selectedOfferAttributionReview, selectedSuccessFee)
    : null;
  const selectedEvidenceGateSummary = selectedApplication
    ? getApplicationEvidenceGateSummary(
      selectedApplication,
      operatingLedger?.queues.evidenceGates || []
    )
    : null;
  const approvedFollowUpReadyToSend = (followUps || []).some((followUp: any) =>
    !followUp.sentDate && getFollowUpApproval(followUp.id)?.status === "approved"
  );
  const selectedNextActions = selectedApplication
    ? getApplicationNextActions({
      application: selectedApplication,
      ledgerSummary: selectedLedgerSummary,
      interviewSummary: selectedInterviewSummaryForActions,
      offerSummary: selectedOfferSummary,
      canGenerateFollowUp: canGenerateFollowUp(selectedApplication.status),
      approvedFollowUpReadyToSend,
      evidenceGateCount: selectedEvidenceGateSummary?.count || 0,
    })
    : null;

  const handleGenerateFollowUp = () => {
    if (!selectedApplication) return;
    generateFollowUpMutation.mutate({
      applicationId: selectedApplication.id,
      type: getFollowUpType(selectedApplication.status),
    });
  };

  const handleGenerateEmployerReply = (responseId?: number) => {
    if (!selectedApplication) return;
    generateEmployerReplyMutation.mutate({
      applicationId: selectedApplication.id,
      responseId,
    });
  };

  const handleViewJob = () => {
    const url = selectedApplication?.job?.applicationUrl || selectedApplication?.job?.sourceUrl;
    if (!openExternalUrl(url)) toast.error("This job link is invalid or unsafe");
  };

  const openSubmissionConfirmation = (application: any) => {
    setConfirmingApplication(application);
    setSelectedApplication(null);
    setSubmissionSource("employer_portal");
    setSubmissionEvidence("");
    setSubmissionConfirmationUrl(
      getSafeExternalUrl(application.job?.applicationUrl || application.job?.sourceUrl) || ""
    );
  };

  const openEmployerResponseDialog = (application: any, responseType?: EmployerResponseType) => {
    setResponseApplication(application);
    setSelectedApplication(null);
    setEmployerResponseType(responseType || (application.status === "interview" ? "offer" : "viewed"));
    setEmployerResponseSource("email");
    setEmployerResponseSourceReference("");
    setEmployerResponseSummary("");
  };

  const openScheduleInterviewDialog = (application: any) => {
    setSchedulingApplication(application);
    setSelectedApplication(null);
    setInterviewType("video");
    setInterviewScheduledAt(defaultInterviewDateTimeLocal());
    setInterviewDuration("60");
    setInterviewLocation("");
    setInterviewMeetingLink("");
    setInterviewerName("");
    setInterviewerTitle("");
    setInterviewNotes("");
  };

  const openOfferAcceptanceDialog = (application: any) => {
    setAcceptingOfferApplication(application);
    setOfferAcceptanceConfirmed(false);
    setOfferAcceptanceNote("");
  };

  const openOfferDeclineDialog = (application: any) => {
    setDecliningOfferApplication(application);
    setOfferDeclineConfirmed(false);
    setOfferDeclineNote("");
  };

  const getNextActionIcon = (actionId: ApplicationNextActionId) => {
    switch (actionId) {
      case "review_queue":
        return <AlertCircle className="h-4 w-4" />;
      case "resolve_evidence":
        return <User className="h-4 w-4" />;
      case "confirm_submission":
        return <CheckCircle className="h-4 w-4" />;
      case "record_response":
        return <MessageSquare className="h-4 w-4" />;
      case "draft_follow_up":
        return <Mail className="h-4 w-4" />;
      case "schedule_interview":
        return <Calendar className="h-4 w-4" />;
      case "report_hire":
        return <DollarSign className="h-4 w-4" />;
      case "view_audit":
        return <Activity className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const runApplicationNextAction = (actionId: ApplicationNextActionId) => {
    if (!selectedApplication) return;

    switch (actionId) {
      case "review_queue":
        setSelectedApplication(null);
        setLocation("/review-queue");
        return;
      case "resolve_evidence":
        setSelectedApplication(null);
        setLocation(selectedEvidenceGateSummary?.route || "/profile");
        return;
      case "confirm_submission":
        openSubmissionConfirmation(selectedApplication);
        return;
      case "record_response":
        openEmployerResponseDialog(selectedApplication);
        return;
      case "draft_follow_up":
        handleGenerateFollowUp();
        return;
      case "schedule_interview":
        openScheduleInterviewDialog(selectedApplication);
        return;
      case "confirm_offer_acceptance":
        openOfferAcceptanceDialog(selectedApplication);
        return;
      case "report_hire":
        setReportHireApplicationId(selectedApplication.id);
        setReportHireOpen(true);
        return;
      case "view_audit":
        document.querySelector('[data-testid="application-ledger-section"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      default:
        toast.info("No user action is due for this application right now");
    }
  };

  useEffect(() => {
    const deepLink = applicationDeepLink;
    if (!deepLink) return;

    const signature = `${deepLink.applicationId}:${deepLink.action}:${deepLink.interviewId ?? ""}`;
    if (handledDeepLink === signature) return;

    const application = applications.find((item: any) => item.id === deepLink.applicationId)
      ?? deepLinkedApplication;
    if (!application) return;

    setHandledDeepLink(signature);
    const applicationStatus = application.status || "pending";
    if (applicationStatus === "interview") {
      setActiveTab("interviewing");
    } else if (["offer", "accepted"].includes(applicationStatus)) {
      setActiveTab("offered");
    } else if (["rejected", "withdrawn"].includes(applicationStatus)) {
      setActiveTab("closed");
    } else {
      setActiveTab("active");
    }

    if (deepLink.action === "schedule-interview") {
      openScheduleInterviewDialog(application);
      return;
    }

    if (deepLink.action === "record-interview-invitation") {
      openEmployerResponseDialog(application, "interview_invite");
      return;
    }

    setSelectedApplication(application);
    if (deepLink.action === "record-interview-outcome" && deepLink.interviewId) {
      setPendingOutcomeInterviewId(deepLink.interviewId);
    } else if (deepLink.action === "send-follow-up") {
      setPendingFollowUpSendApplicationId(application.id);
    } else if (deepLink.action === "follow-up" && canGenerateFollowUp(application.status)) {
      generateFollowUpMutation.mutate({
        applicationId: application.id,
        type: getFollowUpType(application.status),
      });
    } else if (deepLink.action === "employer-response") {
      setPendingEmployerReplyApplicationId(application.id);
    }
  }, [applicationDeepLink, applications, deepLinkedApplication, handledDeepLink]);

  useEffect(() => {
    if (
      pendingFollowUpSendApplicationId === null ||
      selectedApplication?.id !== pendingFollowUpSendApplicationId ||
      !followUps
    ) {
      return;
    }

    const followUp = followUps.find((item: any) => !item.sentDate);
    const approval = followUp
      ? approvals?.find((item: any) => item.entityType === "follow_up" && item.entityId === followUp.id && item.approvalType === "follow_up_send")
      : null;

    setPendingFollowUpSendApplicationId(null);
    if (!followUp || approval?.status !== "approved") {
      toast.info("An approved follow-up draft is required before mailbox delivery can start.");
      return;
    }

    setFollowUpDeliveryConfirmation("");
    setFollowUpMailRecipient("");
    setConfirmingFollowUpSentId(followUp.id);
  }, [approvals, followUps, pendingFollowUpSendApplicationId, selectedApplication?.id]);

  useEffect(() => {
    if (pendingOutcomeInterviewId === null || !selectedApplication || !interviews) {
      return;
    }

    const interview = interviews.find((item: any) =>
      item.id === pendingOutcomeInterviewId && item.status === "completed"
    );
    setPendingOutcomeInterviewId(null);
    if (!interview) {
      toast.error("The requested interview is no longer eligible for outcome recording.");
      return;
    }

    setOutcomeInterview(interview);
    setInterviewOutcome("next_round");
    setInterviewOutcomeSource("email");
    setInterviewOutcomeSummary("");
  }, [interviews, pendingOutcomeInterviewId, selectedApplication]);

  useEffect(() => {
    if (
      pendingEmployerReplyApplicationId === null ||
      !selectedApplication ||
      selectedApplication.id !== pendingEmployerReplyApplicationId ||
      generateEmployerReplyMutation.isPending
    ) {
      return;
    }

    const response = ledgerArtifacts?.employerResponses?.find((item) =>
      item.responseType === "employer_question" || item.responseType === "other"
    );
    if (!response) {
      if (ledgerArtifacts) {
        setPendingEmployerReplyApplicationId(null);
      }
      return;
    }

    setPendingEmployerReplyApplicationId(null);
    generateEmployerReplyMutation.mutate({
      applicationId: selectedApplication.id,
      responseId: response.id,
    });
  }, [
    generateEmployerReplyMutation,
    ledgerArtifacts,
    pendingEmployerReplyApplicationId,
    selectedApplication,
  ]);

  const submitInterviewSchedule = () => {
    if (!schedulingApplication) return;
    const scheduledAt = new Date(interviewScheduledAt);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      toast.error("Choose a future interview time");
      return;
    }

    const duration = Number.parseInt(interviewDuration, 10);
    scheduleInterviewMutation.mutate({
      applicationId: schedulingApplication.id,
      interviewType,
      scheduledAt: scheduledAt.toISOString(),
      duration: Number.isFinite(duration) ? duration : 60,
      location: interviewLocation.trim() || undefined,
      meetingLink: interviewMeetingLink.trim() || undefined,
      interviewerName: interviewerName.trim() || undefined,
      interviewerTitle: interviewerTitle.trim() || undefined,
      notes: interviewNotes.trim() || undefined,
    });
  };

  const pipelineSummary = getApplicationPipelineControlSummary(applications || [], approvals || []);
  const applicationRecords = applications || [];
  const approvalBlockedApplicationIds = new Set(pipelineSummary.approvalBlockedApplicationIds);
  const evidenceNeededApplicationIds = new Set(pipelineSummary.evidenceNeededApplicationIds);

  // Keep pipeline shortcuts and rendered tabs on the same ledger criteria.
  const groupedApplications: Record<ApplicationPipelineTab, any[]> = {
    all: applicationRecords,
    active: applicationRecords.filter((a: any) =>
      ["pending", "applied", "viewed", "interview"].includes(a.status)
    ),
    approvals: applicationRecords.filter((a: any) => approvalBlockedApplicationIds.has(a.id)),
    evidence: applicationRecords.filter((a: any) => evidenceNeededApplicationIds.has(a.id)),
    interviewing: applicationRecords.filter((a: any) => a.status === "interview"),
    offered: applicationRecords.filter((a: any) => ["offer", "accepted"].includes(a.status)),
    closed: applicationRecords.filter((a: any) =>
      ["rejected", "withdrawn"].includes(a.status)
    ),
  };

  // Calculate stats
  const stats = {
    total: applicationSummary?.total ?? applications.length,
    active: applicationSummary?.active ?? groupedApplications.active.length,
    responseRate: applicationSummary?.submitted
      ? Math.round((applicationSummary.responded / applicationSummary.submitted) * 100)
      : 0,
    interviewRate: applicationSummary?.submitted
      ? Math.round((applicationSummary.interviewing / applicationSummary.submitted) * 100)
      : 0,
  };
  const tabCounts: Record<ApplicationPipelineTab, number> = {
    all: applicationSummary?.total ?? groupedApplications.all.length,
    active: applicationSummary?.active ?? groupedApplications.active.length,
    approvals: groupedApplications.approvals.length,
    evidence: groupedApplications.evidence.length,
    interviewing: applicationSummary?.interview ?? groupedApplications.interviewing.length,
    offered: applicationSummary?.offered ?? groupedApplications.offered.length,
    closed: applicationSummary?.closed ?? groupedApplications.closed.length,
  };
  const pipelineTone = {
    empty: "border-slate-700 bg-slate-900/50",
    approval_blocked: "border-amber-500/40 bg-amber-500/10",
    evidence_needed: "border-orange-500/40 bg-orange-500/10",
    offer_action: "border-emerald-500/40 bg-emerald-500/10",
    response_active: "border-blue-500/40 bg-blue-500/10",
    follow_up_candidate: "border-cyan-500/40 bg-cyan-500/10",
    clear: "border-slate-700 bg-slate-900/50",
  }[pipelineSummary.status];
  const pipelineBadgeTone = {
    empty: "border-slate-600 text-slate-300",
    approval_blocked: "border-amber-500/40 text-amber-300",
    evidence_needed: "border-orange-500/40 text-orange-300",
    offer_action: "border-emerald-500/40 text-emerald-300",
    response_active: "border-blue-500/40 text-blue-300",
    follow_up_candidate: "border-cyan-500/40 text-cyan-300",
    clear: "border-slate-600 text-slate-300",
  }[pipelineSummary.status];
  const pipelineCopy = ({
    empty: {
      label: t("pipelineEmptyLabel"), headline: t("pipelineEmptyHeadline"),
      nextAction: t("pipelineEmptyAction"), cta: t("pipelineAllApplications"),
    },
    approval_blocked: {
      label: t("pipelineApprovalBlockedLabel"), headline: t("pipelineApprovalBlockedHeadline", { count: pipelineSummary.approvalBlocked }),
      nextAction: t("pipelineApprovalBlockedAction"), cta: t("pipelineReviewApprovals"),
    },
    evidence_needed: {
      label: t("pipelineEvidenceNeededLabel"), headline: t("pipelineEvidenceNeededHeadline", { count: pipelineSummary.evidenceNeeded }),
      nextAction: t("pipelineEvidenceNeededAction"), cta: t("pipelineReviewPrepared"),
    },
    offer_action: {
      label: t("pipelineOfferActionLabel"), headline: t("pipelineOfferActionHeadline", { count: pipelineSummary.offerActions }),
      nextAction: t("pipelineOfferActionAction"), cta: t("pipelineReviewOffers"),
    },
    response_active: {
      label: t("pipelineResponsesActiveLabel"), headline: t("pipelineResponsesActiveHeadline", { count: pipelineSummary.responseActive }),
      nextAction: t("pipelineResponsesActiveAction"), cta: t(pipelineSummary.primaryTab === "interviewing" ? "pipelineOpenInterviews" : "pipelineOpenActive"),
    },
    follow_up_candidate: {
      label: t("pipelineFollowUpLabel"), headline: t("pipelineFollowUpHeadline", { count: pipelineSummary.followUpCandidates }),
      nextAction: t("pipelineFollowUpAction"), cta: t("pipelineReviewActive"),
    },
    clear: {
      label: t("pipelineCurrentLabel"), headline: t("pipelineCurrentHeadline"),
      nextAction: t("pipelineCurrentAction"), cta: t(pipelineSummary.primaryTab === "active" ? "pipelineOpenActive" : "pipelineAllApplications"),
    },
  } as const)[pipelineSummary.status];

  const renderApplicationCard = (application: any) => (
    <Card
      key={application.id}
      data-testid="application-card"
      data-application-id={application.id}
      data-application-status={application.status}
      className="group hover:border-cyan-500/50 transition-all duration-300 cursor-pointer bg-slate-900/50 border-slate-700/50"
      onClick={() => setSelectedApplication(application)}
    >
      <CardContent className="p-4">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-white truncate">
                {application.job?.title || t("jobTitleFallback")}
              </h3>
              <Badge variant="outline" className={getStatusColor(application.status)}>
                {getStatusIcon(application.status)}
                <span className="ml-1">{getStatusLabel(application.status)}</span>
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-400 mb-2">
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {application.job?.company || t("companyFallback")}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {application.job?.location || t("remoteFallback")}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Calendar className="w-3 h-3" />
              {getApplicationDateLabel(application)}
              {application.job?.platformName && (
                <Badge
                  data-testid="application-card-platform"
                  variant="outline"
                  className="border-slate-600 text-slate-300"
                >
                  {application.job.platformName}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <AppHeader />
        <div className="flex items-center justify-center h-[calc(100vh-80px)]">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <AppHeader />
      <div className="container mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{t("applicationsTitle")}</h1>
            <p className="text-slate-400">{t("applicationsDescription")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetch();
              refetchOperatingLedger();
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {t("refreshApplications")}
          </Button>
        </div>

        <Card data-testid="application-pipeline-control" className={`${pipelineTone}`}>
          <CardContent className="p-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={pipelineBadgeTone}>
                    {pipelineCopy.label}
                  </Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">
                    {t("trackedApplicationsCount", { count: pipelineSummary.trackedApplications })}
                  </Badge>
                </div>
                <h2 className="text-xl font-semibold text-white">{t("applicationPipelineControl")}</h2>
                <p className="mt-1 text-sm text-slate-300">{pipelineCopy.headline}</p>
                <p className="mt-2 max-w-3xl text-sm text-slate-400">{pipelineCopy.nextAction}</p>
              </div>
              <Button
                data-testid="application-pipeline-primary"
                className="bg-cyan-600 hover:bg-cyan-500 lg:w-56"
                onClick={() => setActiveTab(pipelineSummary.primaryTab)}
              >
                <Target className="mr-2 h-4 w-4" />
                {pipelineCopy.cta}
              </Button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              {([
                [t("pipelineApprovals"), pipelineSummary.approvalBlocked, "approvals"],
                [t("pipelineEvidence"), pipelineSummary.evidenceNeeded, "evidence"],
                [t("pipelineActive"), pipelineSummary.activeApplications, "active"],
                [t("pipelineResponses"), pipelineSummary.responseActive, "active"],
                [t("pipelineInterviews"), pipelineSummary.interviewPipeline, "interviewing"],
                [t("pipelineOffers"), pipelineSummary.offerActions, "offered"],
                [t("pipelineClosed"), pipelineSummary.closedApplications, "closed"],
              ] as Array<[string, number, ApplicationPipelineTab]>).map(([label, value, tab]) => (
                <button
                  key={String(label)}
                  type="button"
                  data-testid={`application-pipeline-metric-${String(label).toLowerCase()}`}
                  className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-left transition hover:border-cyan-500/50 hover:bg-slate-900"
                  onClick={() => setActiveTab(tab)}
                >
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{value}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-slate-900/50 border-slate-700/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">{t("trackedJobs")}</p>
                  <p className="text-2xl font-bold text-white">{stats.total}</p>
                </div>
                <Send className="w-8 h-8 text-cyan-500/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-700/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">{t("pipelineActive")}</p>
                  <p className="text-2xl font-bold text-white">{stats.active}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-blue-500/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-700/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">{t("responseRate")}</p>
                  <p className="text-2xl font-bold text-white">{stats.responseRate}%</p>
                </div>
                <Target className="w-8 h-8 text-purple-500/50" />
              </div>
              <Progress value={stats.responseRate} className="mt-2 h-1" />
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-700/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">{t("interviewRate")}</p>
                  <p className="text-2xl font-bold text-white">{stats.interviewRate}%</p>
                </div>
                <MessageSquare className="w-8 h-8 text-amber-500/50" />
              </div>
              <Progress value={stats.interviewRate} className="mt-2 h-1" />
            </CardContent>
          </Card>
        </div>

        {/* Application Tabs */}
        <Tabs value={activeTab} onValueChange={(tab) => setActiveTab(tab as ApplicationPipelineTab)}>
          <TabsList className="h-auto flex-wrap justify-start bg-slate-800/50 border border-slate-700">
            <TabsTrigger value="all" className="data-[state=active]:bg-slate-700">
              {t("applicationsAllCount", { count: tabCounts.all })}
            </TabsTrigger>
            <TabsTrigger value="active" className="data-[state=active]:bg-blue-900/50">
              {t("applicationsActiveCount", { count: tabCounts.active })}
            </TabsTrigger>
            <TabsTrigger value="approvals" className="data-[state=active]:bg-amber-900/50">
              {t("applicationsApprovalsCount", { count: tabCounts.approvals })}
            </TabsTrigger>
            <TabsTrigger value="evidence" className="data-[state=active]:bg-amber-900/50">
              {t("applicationsEvidenceCount", { count: tabCounts.evidence })}
            </TabsTrigger>
            <TabsTrigger value="interviewing" className="data-[state=active]:bg-amber-900/50">
              {t("applicationsInterviewingCount", { count: tabCounts.interviewing })}
            </TabsTrigger>
            <TabsTrigger value="offered" className="data-[state=active]:bg-emerald-900/50">
              {t("applicationsOfferedCount", { count: tabCounts.offered })}
            </TabsTrigger>
            <TabsTrigger value="closed" className="data-[state=active]:bg-slate-700">
              {t("applicationsClosedCount", { count: tabCounts.closed })}
            </TabsTrigger>
          </TabsList>

          <div className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
              </div>
            ) : (
              <>
                {(["all", "active", "approvals", "evidence", "interviewing", "offered", "closed"] as ApplicationPipelineTab[]).map((tab) => (
                  <TabsContent key={tab} value={tab} className="mt-0">
                    <div className="grid gap-3">
                      {groupedApplications[tab].map((app: any) => (
                        renderApplicationCard(app)
                      ))}
                      {groupedApplications[tab].length === 0 && (
                        <div className="text-center py-16 px-4">
                          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                            <FileText className="w-10 h-10 text-cyan-400" />
                          </div>
                          {tab === 'all' ? (
                            <>
                              <h3 className="text-xl font-semibold text-white mb-2">{t("noApplicationsYet")}</h3>
                              <p className="text-slate-400 mb-6 max-w-md mx-auto">
                                {t("noApplicationsDescription")}
                              </p>
                              <Button 
                                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
                                onClick={() => window.location.href = '/profile'}
                              >
                                {t("completeProfileAction")}
                              </Button>
                            </>
                          ) : tab === 'interviewing' ? (
                            <>
                              <h3 className="text-xl font-semibold text-white mb-2">{t("noInterviewsScheduled")}</h3>
                              <p className="text-slate-400 max-w-md mx-auto">
                                {t("noInterviewsDescription")}
                              </p>
                            </>
                          ) : tab === 'offered' ? (
                            <>
                              <h3 className="text-xl font-semibold text-white mb-2">{t("noOffersYet")}</h3>
                              <p className="text-slate-400 max-w-md mx-auto">
                                {t("noOffersDescription")}
                              </p>
                            </>
                          ) : (
                            <>
                              <h3 className="text-xl font-semibold text-white mb-2">{t("noApplicationsCategory")}</h3>
                              <p className="text-slate-400 max-w-md mx-auto">
                                {t("applicationsCategoryDescription")}
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </TabsContent>
                ))}
                {hasNextPage && (
                  <div className="mt-6 flex flex-col items-center gap-2 border-t border-slate-800 pt-5">
                    <p className="text-sm text-slate-400">
                      Showing {applications.length} of {applicationSummary?.total ?? applications.length} applications
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                    >
                      {isFetchingNextPage ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Load older applications
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </Tabs>

        {/* Application Detail Dialog */}
        <Dialog open={!!selectedApplication} onOpenChange={() => setSelectedApplication(null)}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-hidden bg-slate-900 border-slate-700 sm:max-w-2xl">
            {selectedApplication && (
              <>
                <DialogHeader>
                  <DialogTitle className="text-xl text-white">
                    {selectedApplication.job?.title || "Application Details"}
                  </DialogTitle>
                  <DialogDescription className="flex items-center gap-4 text-slate-400">
                    <span className="flex items-center gap-1">
                      <Building2 className="w-4 h-4" />
                      {selectedApplication.job?.company || "Company"}
                    </span>
                    <Badge variant="outline" className={getStatusColor(selectedApplication.status)}>
                      {getStatusIcon(selectedApplication.status)}
                      <span className="ml-1">{getStatusLabel(selectedApplication.status)}</span>
                    </Badge>
                  </DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[60vh] pr-4">
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="bg-slate-800">
                        <Calendar className="w-3 h-3 mr-1" />
                        {getApplicationDateLabel(selectedApplication)}
                      </Badge>
                      {selectedApplication.job?.salaryMin && (
                        <Badge variant="secondary" className="bg-slate-800">
                          <DollarSign className="w-3 h-3 mr-1" />
                          {formatJobSalary(selectedApplication.job.salaryMin, selectedApplication.job.salaryMax, selectedApplication.job.salaryCurrency, locale)}
                        </Badge>
                      )}
                      {selectedApplication.job?.platformName && (
                        <Badge
                          data-testid="application-detail-platform"
                          variant="outline"
                          className="border-cyan-500/40 text-cyan-300"
                        >
                          Source: {selectedApplication.job.platformName}
                        </Badge>
                      )}
                    </div>

                    {selectedLedgerSummary && (
                      <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-medium text-slate-200">Operating status</h4>
                            <p className="mt-1 text-sm text-slate-400">{selectedLedgerSummary.nextAction}</p>
                          </div>
                          <Badge
                            variant="outline"
                            className={getLedgerSummaryBadgeClass(selectedLedgerSummary.status)}
                          >
                            {selectedLedgerSummary.label}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 md:grid-cols-5">
                          {[
                            ["Material", selectedLedgerSummary.hasPreparedMaterial ? "Ready" : "Missing"],
                            ["Evidence", selectedLedgerSummary.hasSubmissionEvidence ? "Stored" : "Needed"],
                            ["Approval", selectedLedgerSummary.pendingApproval ? "Pending" : selectedLedgerSummary.approvedSubmission ? "Approved" : "None"],
                            ["Responses", selectedLedgerSummary.hasEmployerResponse ? "Recorded" : "None"],
                            ["Audit", selectedLedgerSummary.auditEventCount],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded border border-slate-700/70 bg-slate-900/60 p-2">
                              <div className="text-slate-500">{label}</div>
                              <div className="mt-1 font-medium text-slate-200">{value}</div>
                            </div>
                          ))}
                        </div>
                        {(selectedLedgerSummary.openFollowUpDrafts > 0 || selectedLedgerSummary.sentFollowUpsAwaitingResponse > 0) && (
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                            {selectedLedgerSummary.openFollowUpDrafts > 0 && (
                              <Badge variant="outline" className="border-amber-500/30 text-amber-300">
                                {selectedLedgerSummary.openFollowUpDrafts} follow-up draft{selectedLedgerSummary.openFollowUpDrafts === 1 ? "" : "s"}
                              </Badge>
                            )}
                            {selectedLedgerSummary.sentFollowUpsAwaitingResponse > 0 && (
                              <Badge variant="outline" className="border-blue-500/30 text-blue-300">
                                {selectedLedgerSummary.sentFollowUpsAwaitingResponse} follow-up{selectedLedgerSummary.sentFollowUpsAwaitingResponse === 1 ? "" : "s"} awaiting response
                              </Badge>
                            )}
                          </div>
                        )}
                        {selectedLedgerSummary.staleFollowUpCancellations > 0 && (
                          <div
                            data-testid="stale-follow-up-cancellation"
                            className="mt-3 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100"
                          >
                            <div className="mb-1 flex items-center gap-2 font-medium text-blue-200">
                              <Mail className="h-4 w-4" />
                              Follow-up approval retired
                            </div>
                            <p className="text-blue-100/90">
                              {selectedLedgerSummary.staleFollowUpCancellationReason}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedEvidenceGateSummary && selectedEvidenceGateSummary.count > 0 && (
                      <div
                        data-testid="application-evidence-gates"
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3"
                      >
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
                              <AlertCircle className="h-4 w-4 text-amber-300" />
                              Evidence gates active
                            </div>
                            <p className="mt-1 text-sm text-amber-50/90">{selectedEvidenceGateSummary.headline}</p>
                            <p className="mt-1 text-sm text-slate-300">{selectedEvidenceGateSummary.detail}</p>
                          </div>
                          <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                            {selectedEvidenceGateSummary.highestSeverity}
                          </Badge>
                        </div>

                        {selectedEvidenceGateSummary.blockedCapabilities.length > 0 && (
                          <div className="mb-3 flex flex-wrap gap-2">
                            {selectedEvidenceGateSummary.blockedCapabilities.map((capability) => (
                              <Badge key={capability} variant="outline" className="border-amber-500/30 text-amber-100">
                                {capability}
                              </Badge>
                            ))}
                          </div>
                        )}

                        <div className="space-y-2">
                          {selectedEvidenceGateSummary.gates.slice(0, 3).map((gate) => (
                            <div key={gate.id || gate.label} className="rounded border border-amber-500/20 bg-slate-950/40 p-2 text-sm text-slate-300">
                              <div className="font-medium text-amber-100">{gate.label || "Evidence gate"}</div>
                              {gate.detail && <div className="mt-1 text-slate-400">{gate.detail}</div>}
                            </div>
                          ))}
                        </div>

                        <Button
                          data-testid="application-evidence-gates-resolve"
                          variant="outline"
                          size="sm"
                          className="mt-3 border-amber-500/40 text-amber-100 hover:bg-amber-500/10"
                          onClick={() => {
                            setSelectedApplication(null);
                            setLocation(selectedEvidenceGateSummary.route);
                          }}
                        >
                          <User className="mr-1 h-4 w-4" />
                          Resolve evidence
                        </Button>
                      </div>
                    )}

                    {selectedNextActions && (
                      <div
                        data-testid="application-next-actions"
                        className="rounded-md border border-cyan-500/25 bg-cyan-950/20 p-3"
                      >
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-medium text-cyan-100">
                              <Activity className="h-4 w-4 text-cyan-300" />
                              Next best action
                            </div>
                            <p className="mt-1 text-sm text-slate-300">{selectedNextActions.detail}</p>
                          </div>
                          <Badge variant="outline" className="border-cyan-500/30 text-cyan-200">
                            {selectedNextActions.attentionCount > 0
                              ? `${selectedNextActions.attentionCount} item${selectedNextActions.attentionCount === 1 ? "" : "s"}`
                              : "Clear"}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            data-testid="application-next-action-primary"
                            size="sm"
                            className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                            disabled={
                              selectedNextActions.primary.id === "monitor" ||
                              (selectedNextActions.primary.id === "draft_follow_up" && generateFollowUpMutation.isPending)
                            }
                            onClick={() => runApplicationNextAction(selectedNextActions.primary.id)}
                          >
                            {selectedNextActions.primary.id === "draft_follow_up" && generateFollowUpMutation.isPending
                              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                              : <span className="mr-1">{getNextActionIcon(selectedNextActions.primary.id)}</span>}
                            {selectedNextActions.headline}
                          </Button>

                          {selectedNextActions.secondary.map((action) => (
                            <Button
                              key={action.id}
                              data-testid={`application-next-action-${action.id}`}
                              variant="outline"
                              size="sm"
                              disabled={action.id === "draft_follow_up" && generateFollowUpMutation.isPending}
                              onClick={() => runApplicationNextAction(action.id)}
                            >
                              <span className="mr-1">{getNextActionIcon(action.id)}</span>
                              {action.label}
                            </Button>
                          ))}
                        </div>

                        <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
                          <div className="rounded border border-slate-700/70 bg-slate-900/60 p-2">
                            <div className="text-slate-500">Risk</div>
                            <div className="mt-1 font-medium capitalize text-slate-200">{selectedNextActions.primary.risk}</div>
                          </div>
                          <div className="rounded border border-slate-700/70 bg-slate-900/60 p-2">
                            <div className="text-slate-500">External action</div>
                            <div className="mt-1 font-medium text-slate-200">
                              {selectedNextActions.primary.id === "resolve_evidence"
                                ? "Evidence-gated"
                                : selectedNextActions.primary.requiresApproval
                                  ? "Approval-gated"
                                  : "Internal only"}
                            </div>
                          </div>
                          <div className="rounded border border-slate-700/70 bg-slate-900/60 p-2">
                            <div className="text-slate-500">Ledger source</div>
                            <div className="mt-1 font-medium text-slate-200">Approvals, evidence, replies</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedInterviewSummary && (
                      selectedInterviewSummary.status !== "not_applicable" ||
                      interviewsLoading ||
                      (interviews?.length || 0) > 0
                    ) && (
                      <div data-testid="application-interview-control" className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-medium text-slate-200">Interview Control</h4>
                            <p className="mt-1 text-sm text-slate-400">
                              {selectedInterviewSchedulingControl?.description || selectedInterviewSummary.nextAction}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={getInterviewSummaryBadgeClass(selectedInterviewSummary.status)}
                          >
                            {selectedInterviewSummary.label}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 md:grid-cols-4">
                          {[
                            ["Active", selectedInterviewSummary.activeInterviews],
                            ["Completed shown", selectedInterviewSummary.completedInterviews],
                            ["Cancelled shown", selectedInterviewSummary.cancelledInterviews],
                            [
                              "Next",
                              selectedInterviewSummary.nextInterviewAt
                                ? selectedInterviewSummary.nextInterviewAt.toLocaleString(locale)
                                : "None",
                            ],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded border border-slate-700/70 bg-slate-900/60 p-2">
                              <div className="text-slate-500">{label}</div>
                              <div className="mt-1 font-medium text-slate-200">{value}</div>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 space-y-2">
                          {interviewsLoading ? (
                            <div className="flex items-center gap-2 text-sm text-slate-400">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading interviews
                            </div>
                          ) : (interviews?.length || 0) > 0 ? (
                            interviews?.map((interview: any) => {
                              const activeInterview = interview.status === "scheduled" || interview.status === "rescheduled";
                              return (
                                <div key={interview.id} className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge
                                        variant="outline"
                                        className={activeInterview
                                          ? "border-emerald-500/30 text-emerald-300"
                                          : interview.status === "completed"
                                            ? "border-blue-500/30 text-blue-300"
                                            : "border-red-500/30 text-red-300"}
                                      >
                                        {String(interview.status || "scheduled").replace(/_/g, " ")}
                                      </Badge>
                                      <span className="text-sm text-slate-300">
                                        {String(interview.interviewType || "interview").replace(/_/g, " ")}
                                      </span>
                                    </div>
                                    <span className="text-xs text-slate-500">{formatAttemptDate(interview.scheduledAt)}</span>
                                  </div>
                                  <div className="grid gap-1 text-sm text-slate-400">
                                    {interview.duration && <div>{interview.duration} minutes</div>}
                                    {interview.location && <div>Location: {interview.location}</div>}
                                    {interview.meetingLink && <div>Meeting link: {interview.meetingLink}</div>}
                                    {(interview.interviewerName || interview.interviewerTitle) && (
                                      <div>
                                        Interviewer: {[interview.interviewerName, interview.interviewerTitle].filter(Boolean).join(", ")}
                                      </div>
                                    )}
                                    {interview.notes && <div className="whitespace-pre-wrap">{interview.notes}</div>}
                                  </div>
                                  {activeInterview && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={updateInterviewStatusMutation.isPending}
                                        onClick={() => updateInterviewStatusMutation.mutate({
                                          interviewId: interview.id,
                                          status: "completed",
                                        })}
                                      >
                                        <CheckCircle className="mr-1 h-4 w-4" />
                                        Complete
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={updateInterviewStatusMutation.isPending}
                                        onClick={() => updateInterviewStatusMutation.mutate({
                                          interviewId: interview.id,
                                          status: "cancelled",
                                        })}
                                      >
                                        <XCircle className="mr-1 h-4 w-4" />
                                        Cancel
                                      </Button>
                                    </div>
                                  )}
                                  {interview.status === "completed" && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          setOutcomeInterview(interview);
                                          setInterviewOutcome("next_round");
                                          setInterviewOutcomeSource("email");
                                          setInterviewOutcomeSummary("");
                                        }}
                                      >
                                        <MessageSquare className="mr-1 h-4 w-4" />
                                        Record Outcome
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-sm text-slate-400">No interview time has been recorded yet.</p>
                          )}
                          {activeInterviewWindowTruncated && (
                            <p className="text-xs text-amber-300">
                              More than 25 active interview rounds exist. Resolve older active rounds before scheduling another.
                            </p>
                          )}
                          {hasEarlierInterviewHistory && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isFetchingEarlierInterviewHistory}
                              onClick={() => void fetchEarlierInterviewHistory()}
                            >
                              {isFetchingEarlierInterviewHistory && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                              Load earlier interview history
                            </Button>
                          )}
                        </div>

                        {canScheduleSelectedInterview && (
                          <Button
                            data-testid="schedule-interview-open"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => openScheduleInterviewDialog(selectedApplication)}
                          >
                            <Calendar className="mr-1 h-4 w-4" />
                            {t("scheduleInterviewTitle")}
                          </Button>
                        )}
                        {selectedInterviewSchedulingControl && !canScheduleSelectedInterview && (
                          <Button
                            data-testid="record-interview-invitation-open"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => openEmployerResponseDialog(selectedApplication, "interview_invite")}
                          >
                            <MessageSquare className="mr-1 h-4 w-4" />
                            {selectedInterviewSchedulingControl.actionLabel}
                          </Button>
                        )}
                      </div>
                    )}

                    {selectedOfferSummary && selectedOfferSummary.status !== "not_applicable" && (
                      <div data-testid="application-offer-control" className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-medium text-slate-200">Offer & Success-Fee Control</h4>
                            <p className="mt-1 text-sm text-slate-400">{selectedOfferSummary.nextAction}</p>
                          </div>
                          <Badge
                            variant="outline"
                            className={getOfferSummaryBadgeClass(selectedOfferSummary.status)}
                          >
                            {selectedOfferSummary.label}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 md:grid-cols-4">
                          {[
                            ["Attribution", selectedOfferSummary.hasOfferAttributionReview ? "Pending" : "Clear"],
                            ["Success fee", selectedOfferSummary.hasSuccessFee ? "Linked" : "Not reported"],
                            [
                              "Monthly fee",
                              selectedOfferSummary.monthlyFeeCents > 0
                                ? `$${(selectedOfferSummary.monthlyFeeCents / 100).toFixed(2)}`
                                : "None",
                            ],
                            [
                              "Verification",
                              selectedOfferSummary.nextVerificationDue
                                ? formatCalendarDate(selectedOfferSummary.nextVerificationDue, locale)
                                : "Not due",
                            ],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded border border-slate-700/70 bg-slate-900/60 p-2">
                              <div className="text-slate-500">{label}</div>
                              <div className="mt-1 font-medium text-slate-200">{value}</div>
                            </div>
                          ))}
                        </div>
                        {selectedOfferAttributionReview?.latestEmployerResponse?.summary && (
                          <p className="mt-3 whitespace-pre-wrap rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-400">
                            {selectedOfferAttributionReview.latestEmployerResponse.summary}
                          </p>
                        )}
                        {selectedOfferSummary.canReportHire && (
                          <Button
                            data-testid="application-report-hire"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => {
                              setReportHireApplicationId(selectedApplication.id);
                              setReportHireOpen(true);
                            }}
                          >
                            <DollarSign className="mr-1 h-4 w-4" />
                            Report Hire
                          </Button>
                        )}
                      </div>
                    )}

                    {selectedApplication.coverLetter && (
                      <>
                        <Separator className="bg-slate-700" />
                        <div>
                          <h4 className="text-sm font-medium text-slate-300 mb-2">Cover Letter</h4>
                          <p className="text-sm text-slate-400 whitespace-pre-wrap bg-slate-800/50 p-3 rounded-md">
                            {selectedApplication.coverLetter}
                          </p>
                        </div>
                      </>
                    )}

                    {(ledgerArtifactsLoading || ledgerArtifacts?.material || ledgerArtifacts?.interviewPreparation || (ledgerArtifacts?.attempts?.length || 0) > 0 || (ledgerArtifacts?.employerResponses?.length || 0) > 0 || (ledgerArtifacts?.auditEvents?.length || 0) > 0) && (
                      <>
                        <Separator className="bg-slate-700" />
                        <div data-testid="application-ledger-section" className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="text-sm font-medium text-slate-300">Application Ledger</h4>
                            <Badge variant="outline" className="border-slate-600 text-slate-300">
                              {(ledgerArtifacts?.attempts?.length || 0)}{ledgerArtifacts?.hasMore.attempts ? "+" : ""} recent attempts / {(ledgerArtifacts?.employerResponses?.length || 0)}{ledgerArtifacts?.hasMore.employerResponses ? "+" : ""} recent responses / {ledgerArtifacts?.interviewPreparation ? 1 : 0} prep / {(ledgerArtifacts?.auditEvents?.length || 0)}{ledgerArtifacts?.hasMore.auditEvents ? "+" : ""} recent audit
                            </Badge>
                          </div>

                          {ledgerArtifactsLoading ? (
                            <div className="flex items-center gap-2 text-sm text-slate-400">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading ledger
                            </div>
                          ) : (
                            <>
                              {ledgerArtifacts?.material && (
                                <div data-testid="application-material-evidence" className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
                                    <FileText className="h-4 w-4" />
                                    Prepared material
                                  </div>
                                  <div className="grid gap-2 text-sm text-slate-400">
                                    <div>Resume: {selectedMaterialEvidence?.resumeLabel}</div>
                                    <div>{selectedMaterialEvidence?.coverLetterLabel}</div>
                                    <div>Source: {selectedMaterialEvidence?.source}</div>
                                    {(selectedMaterialEvidence?.customAnswerCount || 0) > 0 && (
                                      <div>
                                        Custom answers: {selectedMaterialEvidence?.customAnswerCount} field{selectedMaterialEvidence?.customAnswerCount === 1 ? "" : "s"} captured
                                      </div>
                                    )}
                                  </div>

                                  {selectedMaterialEvidence && (
                                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                      <div className="rounded-md border border-slate-700/70 bg-slate-900/60 p-3">
                                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                                          Supported claims
                                        </div>
                                        {selectedMaterialEvidence.supportSignals.length > 0 ? (
                                          <div className="space-y-2">
                                            {selectedMaterialEvidence.supportSignals.map((signal) => (
                                              <div key={signal} className="flex items-start gap-2 text-sm text-slate-300">
                                                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                                                <span>{signal}</span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-sm text-slate-500">
                                            No explicit claim support signals were stored for this material.
                                          </p>
                                        )}
                                      </div>

                                      <div className="rounded-md border border-slate-700/70 bg-slate-900/60 p-3">
                                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                                          Review blockers
                                        </div>
                                        {selectedMaterialEvidence.blockers.length > 0 ? (
                                          <div className="space-y-2">
                                            {selectedMaterialEvidence.blockers.map((blocker) => (
                                              <div key={blocker} className="flex items-start gap-2 text-sm text-amber-200">
                                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                                                <span>{blocker}</span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-sm text-slate-500">
                                            No material-specific blockers were stored.
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {selectedMaterialEvidence && (
                                    <div className="mt-3 rounded-md border border-slate-700/70 bg-slate-900/60 p-3">
                                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                                        Profile evidence used
                                      </div>
                                      <div className="grid gap-2 text-sm text-slate-400 md:grid-cols-2">
                                        <div>Skills: {selectedMaterialEvidence.profileEvidence.skills || "Not captured"}</div>
                                        <div>Experience: {selectedMaterialEvidence.profileEvidence.experience || "Not captured"}</div>
                                        <div>Education: {selectedMaterialEvidence.profileEvidence.education || "Not captured"}</div>
                                        <div>Target roles: {selectedMaterialEvidence.profileEvidence.targetRoles || "Not captured"}</div>
                                        <div>Target locations: {selectedMaterialEvidence.profileEvidence.targetLocations || "Not captured"}</div>
                                        <div>Salary range: {selectedMaterialEvidence.profileEvidence.salaryRange || "Not captured"}</div>
                                      </div>
                                      <p className="mt-3 border-t border-slate-700 pt-3 text-sm text-slate-300">
                                        {selectedMaterialEvidence.honestyNote}
                                      </p>
                                    </div>
                                  )}
                                  {(selectedMaterialEvidence?.customAnswerLabels.length || 0) > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {selectedMaterialEvidence?.customAnswerLabels.map((label) => (
                                        <Badge key={label} variant="outline" className="border-slate-600 text-slate-300">
                                          {label.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {!selectedMaterialEvidence?.profileEvidence.resumeConnected && (
                                    <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                                      Resume evidence is not linked to this material. Keep this item in review until resume proof is attached.
                                    </p>
                                  )}
                                </div>
                              )}

                              {selectedInterviewPreparation && (
                                <div data-testid="interview-preparation-artifact" className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
                                    <Calendar className="h-4 w-4" />
                                    Interview preparation
                                  </div>
                                  {selectedInterviewPreparation.companyInsights && (
                                    <p className="mb-3 whitespace-pre-wrap rounded-md border border-slate-700/70 bg-slate-900/60 p-3 text-sm text-slate-300">
                                      {selectedInterviewPreparation.companyInsights}
                                    </p>
                                  )}
                                  <div className="grid gap-3 lg:grid-cols-2">
                                    <div>
                                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                                        Practice questions
                                      </div>
                                      <div className="space-y-2">
                                        {selectedInterviewPreparation.questions.map((question) => (
                                          <div key={question} className="flex items-start gap-2 text-sm text-slate-300">
                                            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                                            <span>{question}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                                        Coaching tips
                                      </div>
                                      <div className="space-y-2">
                                        {selectedInterviewPreparation.tips.map((tip) => (
                                          <div key={tip} className="flex items-start gap-2 text-sm text-slate-300">
                                            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                                            <span>{tip}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {ledgerArtifacts?.attempts?.slice(0, APPLICATION_LEDGER_WINDOW_LIMITS.attempts).map((attempt) => (
                                <div key={attempt.id} className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <Badge
                                        variant="outline"
                                        className={attempt.status === "submitted"
                                          ? "border-emerald-500/30 text-emerald-300"
                                          : attempt.status === "failed"
                                            ? "border-red-500/30 text-red-300"
                                            : "border-amber-500/30 text-amber-300"}
                                      >
                                        {attempt.status.replace("_", " ")}
                                      </Badge>
                                      <span className="text-sm text-slate-300">{attempt.attemptType.replace("_", " ")}</span>
                                    </div>
                                    <span className="text-xs text-slate-500">{formatAttemptDate(attempt.finishedAt || attempt.startedAt)}</span>
                                  </div>
                                  {attempt.confirmationText && (
                                    <p className="whitespace-pre-wrap text-sm text-slate-400">{attempt.confirmationText}</p>
                                  )}
                                  {attempt.errorMessage && (
                                    <p className="mt-2 text-sm text-red-300">{attempt.errorMessage}</p>
                                  )}
                                </div>
                              ))}

                              {(ledgerArtifacts?.employerResponses?.length || 0) > 0 && (
                                <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
                                    <MessageSquare className="h-4 w-4" />
                                    Recent employer responses
                                  </div>
                                  <div className="space-y-3">
                                    {ledgerArtifacts?.employerResponses?.slice(0, APPLICATION_LEDGER_WINDOW_LIMITS.employerResponses).map((response) => (
                                      <div key={response.id} className="border-l border-slate-700 pl-3">
                                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <Badge
                                              variant="outline"
                                              className={response.responseType === "offer"
                                                ? "border-emerald-500/30 text-emerald-300"
                                                : response.responseType === "interview_invite"
                                                  ? "border-amber-500/30 text-amber-300"
                                                  : response.responseType === "rejection"
                                                    ? "border-red-500/30 text-red-300"
                                                    : "border-blue-500/30 text-blue-300"}
                                            >
                                              {response.responseType.replace(/_/g, " ")}
                                            </Badge>
                                            <span className="text-sm text-slate-300">
                                              {response.statusBefore} to {response.statusAfter}
                                            </span>
                                          </div>
                                          <span className="text-xs text-slate-500">{formatAttemptDate(response.receivedAt)}</span>
                                        </div>
                                        <p className="whitespace-pre-wrap text-sm text-slate-400">{response.summary}</p>
                                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                          <div className="text-xs text-slate-500">
                                            Source: {response.source.replace("_", " ")}
                                          </div>
                                          {(response.responseType === "employer_question" || response.responseType === "other") && (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              disabled={generateEmployerReplyMutation.isPending}
                                              onClick={() => handleGenerateEmployerReply(response.id)}
                                            >
                                              {generateEmployerReplyMutation.isPending ? (
                                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                              ) : (
                                                <MessageSquare className="mr-1 h-4 w-4" />
                                              )}
                                              Draft Reply
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {(ledgerArtifacts?.auditEvents?.length || 0) > 0 && (
                                <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
                                    <Activity className="h-4 w-4" />
                                    Recent audit trail
                                  </div>
                                  <div className="space-y-3">
                                    {ledgerArtifacts?.auditEvents?.slice(0, APPLICATION_LEDGER_WINDOW_LIMITS.auditEvents).map((event) => (
                                      <div key={event.id} className="border-l border-slate-700 pl-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <Badge
                                              variant="outline"
                                              className={event.riskLevel === "high" || event.riskLevel === "critical"
                                                ? "border-red-500/30 text-red-300"
                                                : event.riskLevel === "medium"
                                                  ? "border-amber-500/30 text-amber-300"
                                                  : "border-slate-600 text-slate-300"}
                                            >
                                              {event.riskLevel}
                                            </Badge>
                                            <span className="text-sm text-slate-300">{event.action.replace(/_/g, " ")}</span>
                                          </div>
                                          <span className="text-xs text-slate-500">{formatAttemptDate(event.createdAt)}</span>
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">
                                          {event.actor} via {event.source || "system"}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    )}

                    {followUps && followUps.length > 0 && (
                      <>
                        <Separator className="bg-slate-700" />
                        <div className="space-y-3">
                          <h4 className="text-sm font-medium text-slate-300">Follow-ups</h4>
                          {followUps.map((followUp) => {
                            const approval = getFollowUpApproval(followUp.id);
                            const approvalStatus = approval?.status;

                            return (
                              <div key={followUp.id} className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                                <div className="mb-2 flex items-start justify-between gap-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={followUp.responseReceived
                                        ? "border-blue-500/30 text-blue-300"
                                        : followUp.sentDate
                                          ? "border-emerald-500/30 text-emerald-300"
                                          : "border-amber-500/30 text-amber-300"}
                                    >
                                      {followUp.responseReceived ? "Response" : followUp.sentDate ? "Sent" : "Draft"}
                                    </Badge>
                                    {followUp.deliveryState && followUp.deliveryState !== "draft" && (
                                      <Badge
                                        data-testid="follow-up-delivery-state"
                                        variant="outline"
                                        className={followUp.deliveryState === "sent"
                                          ? "border-emerald-500/30 text-emerald-300"
                                          : followUp.deliveryState === "failed" || followUp.deliveryState === "unknown"
                                            ? "border-red-500/30 text-red-300"
                                            : "border-amber-500/30 text-amber-300"}
                                      >
                                        {followUp.deliveryProvider ? `${followUp.deliveryProvider} ` : ""}{followUp.deliveryState}
                                      </Badge>
                                    )}
                                    {!followUp.sentDate && (
                                      <Badge
                                        variant="outline"
                                        className={approvalStatus === "approved"
                                          ? "border-emerald-500/30 text-emerald-300"
                                          : approvalStatus === "rejected" || approvalStatus === "cancelled"
                                            ? "border-red-500/30 text-red-300"
                                            : "border-amber-500/30 text-amber-300"}
                                      >
                                        {approvalStatus ? `Approval ${approvalStatus}` : "Approval needed"}
                                      </Badge>
                                    )}
                                  </div>
                                  {!followUp.sentDate ? (
                                    approvalStatus === "pending" && approval ? (
                                      <div className="flex flex-wrap justify-end gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          disabled={resolveApprovalMutation.isPending}
                                          onClick={() => resolveApprovalMutation.mutate({
                                            approvalId: approval.id,
                                            status: "approved",
                                            decisionNote: "Approved follow-up draft.",
                                          })}
                                        >
                                          <CheckCircle className="mr-1 h-4 w-4" />
                                          Approve
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          disabled={resolveApprovalMutation.isPending}
                                          onClick={() => resolveApprovalMutation.mutate({
                                            approvalId: approval.id,
                                            status: "rejected",
                                            decisionNote: "Rejected follow-up draft.",
                                          })}
                                        >
                                          <XCircle className="mr-1 h-4 w-4" />
                                          Reject
                                        </Button>
                                      </div>
                                    ) : approvalStatus === "approved" ? (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={markFollowUpSentMutation.isPending}
                                        onClick={() => {
                                          setFollowUpDeliveryConfirmation("");
                                          setConfirmingFollowUpSentId(followUp.id);
                                        }}
                                      >
                                        <CheckCircle className="mr-1 h-4 w-4" />
                                        Mark Sent
                                      </Button>
                                    ) : null
                                  ) : !followUp.responseReceived ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={markFollowUpResponseMutation.isPending}
                                      onClick={() => markFollowUpResponseMutation.mutate({ followUpId: followUp.id })}
                                    >
                                      <MessageSquare className="mr-1 h-4 w-4" />
                                      Mark Response
                                    </Button>
                                  ) : null}
                                </div>
                                <p className="whitespace-pre-wrap text-sm text-slate-400">{followUp.message}</p>
                                {followUp.deliveryConfirmation && (
                                  <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs text-emerald-100">
                                    <span className="font-medium">Delivery confirmation: </span>
                                    {followUp.deliveryConfirmation}
                                  </div>
                                )}
                                {followUp.deliveryFailureMessage && (
                                  <div className="rounded border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-100">
                                    <span className="font-medium">Delivery needs review: </span>
                                    {followUp.deliveryFailureMessage}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {followUpsHasNextPage && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={followUpsFetchingNextPage}
                              onClick={() => fetchNextFollowUpsPage()}
                            >
                              {followUpsFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Load earlier follow-ups
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-slate-700">
                  <div className="flex flex-wrap gap-2">
                    {selectedApplication.status === "pending" && (() => {
                      const approval = getApplicationSubmissionApproval(selectedApplication.id);
                      const approvalStatus = approval?.status;
                      const evidenceBlocked = (selectedEvidenceGateSummary?.count || 0) > 0;
                      const submissionBlocked =
                        evidenceBlocked ||
                        approvalStatus === "pending" ||
                        approvalStatus === "rejected" ||
                        approvalStatus === "cancelled";

                      return (
                        <div className="flex flex-wrap gap-2">
                          {approvalStatus && (
                            <Badge
                              variant="outline"
                              className={approvalStatus === "approved"
                                ? "border-emerald-500/30 text-emerald-300"
                                : approvalStatus === "pending"
                                  ? "border-amber-500/30 text-amber-300"
                                  : "border-red-500/30 text-red-300"}
                            >
                              Submission approval {approvalStatus}
                            </Badge>
                          )}
                          {evidenceBlocked && (
                            <Badge
                              data-testid="application-confirm-submission-evidence-gated"
                              variant="outline"
                              className="border-amber-500/30 text-amber-300"
                            >
                              Evidence gated
                            </Badge>
                          )}
                          {approvalStatus === "pending" && approval && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={resolveApprovalMutation.isPending || evidenceBlocked}
                                title={evidenceBlocked ? "Resolve profile evidence before approving this external handoff." : undefined}
                                onClick={() => resolveApprovalMutation.mutate({
                                  approvalId: approval.id,
                                  status: "approved",
                                  decisionNote: "Approved prepared application for external submission.",
                                })}
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={resolveApprovalMutation.isPending}
                                onClick={() => resolveApprovalMutation.mutate({
                                  approvalId: approval.id,
                                  status: "rejected",
                                  decisionNote: "Rejected prepared application submission.",
                                })}
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </>
                          )}
                          <Button
                            data-testid="confirm-submitted-open"
                            variant="outline"
                            size="sm"
                            disabled={updateStatusMutation.isPending || submissionBlocked}
                            onClick={() => {
                              openSubmissionConfirmation(selectedApplication);
                            }}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Confirm Submitted
                          </Button>
                        </div>
                      );
                    })()}
                    {selectedApplication.status !== "offer" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          updateStatusMutation.mutate({ applicationId: selectedApplication.id, status: "withdrawn" });
                        }}
                        disabled={updateStatusMutation.isPending || ["withdrawn", "rejected", "accepted"].includes(selectedApplication.status)}
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Withdraw
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEmployerResponseDialog(selectedApplication)}
                      disabled={
                        recordResponseMutation.isPending ||
                        ["pending", "withdrawn", "rejected", "accepted"].includes(selectedApplication.status)
                      }
                    >
                      <MessageSquare className="w-4 h-4 mr-1" />
                      Record Response
                    </Button>
                    {selectedApplication.status === "offer" && (
                      <>
                        <Button
                          data-testid="confirm-offer-acceptance-open"
                          variant="outline"
                          size="sm"
                          onClick={() => openOfferAcceptanceDialog(selectedApplication)}
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Confirm Acceptance
                        </Button>
                        <Button
                          data-testid="decline-offer-open"
                          variant="outline"
                          size="sm"
                          onClick={() => openOfferDeclineDialog(selectedApplication)}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          {t("declineOfferTitle")}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateFollowUp}
                      disabled={
                        generateFollowUpMutation.isPending ||
                        !canGenerateFollowUp(selectedApplication.status)
                      }
                    >
                      {generateFollowUpMutation.isPending
                        ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        : <Mail className="w-4 h-4 mr-1" />}
                      {t("followUpAction")}
                    </Button>
                    <Button
                      className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
                      size="sm"
                      onClick={handleViewJob}
                      disabled={!getSafeExternalUrl(
                        selectedApplication.job?.applicationUrl || selectedApplication.job?.sourceUrl
                      )}
                    >
                      <ExternalLink className="w-4 h-4 mr-1" />
                      {t("viewJob")}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!responseApplication}
          onOpenChange={(open) => {
            if (!open) {
              setResponseApplication(null);
              setEmployerResponseSourceReference("");
              setEmployerResponseSummary("");
            }
          }}
        >
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">{t("recordEmployerResponseTitle")}</DialogTitle>
              <DialogDescription className="text-slate-400">
                {t("recordEmployerResponseDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("responseType")}</label>
                <Select
                  value={employerResponseType}
                  onValueChange={(value) => setEmployerResponseType(value as EmployerResponseType)}
                >
                  <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewed">{t("applicationViewed")}</SelectItem>
                    <SelectItem value="employer_question">{t("employerQuestionLabel")}</SelectItem>
                    <SelectItem value="interview_invite">{t("interviewInviteLabel")}</SelectItem>
                    <SelectItem value="offer">{t("offerLabel")}</SelectItem>
                    <SelectItem value="rejection">{t("rejectionLabel")}</SelectItem>
                    <SelectItem value="other">{t("otherLabel")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("sourceLabel")}</label>
                <Select
                  value={employerResponseSource}
                  onValueChange={(value) => setEmployerResponseSource(value as EmployerResponseSource)}
                >
                  <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">{t("emailLabel")}</SelectItem>
                    <SelectItem value="employer_portal">{t("employerPortal")}</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="phone">{t("phoneLabel")}</SelectItem>
                    <SelectItem value="other">{t("otherLabel")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  {t("messagePortalReference")}{["interview_invite", "offer"].includes(employerResponseType) ? ` (${t("referenceRequiredForInterviewOffer")})` : ""}
                </label>
                <Input
                  value={employerResponseSourceReference}
                  onChange={(event) => setEmployerResponseSourceReference(event.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder={t(["interview_invite", "offer"].includes(employerResponseType) ? "requiredSourceReferencePlaceholder" : "optionalSourceReferencePlaceholder")}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-slate-300">{t("responseSummary")}</label>
                <Textarea
                  value={employerResponseSummary}
                  onChange={(event) => setEmployerResponseSummary(event.target.value)}
                  className="min-h-36 bg-slate-800 border-slate-700 text-white"
                  placeholder={t("responseSummaryPlaceholder")}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setResponseApplication(null);
                  setEmployerResponseSourceReference("");
                  setEmployerResponseSummary("");
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={!employerResponseSummary.trim() || (["interview_invite", "offer"].includes(employerResponseType) && !employerResponseSourceReference.trim()) || recordResponseMutation.isPending}
                onClick={() => {
                  if (!responseApplication) return;
                  recordResponseMutation.mutate({
                    applicationId: responseApplication.id,
                    responseType: employerResponseType,
                    source: employerResponseSource,
                    sourceReference: employerResponseSourceReference.trim() || undefined,
                    summary: employerResponseSummary.trim(),
                  });
                }}
              >
                {recordResponseMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("saveResponse")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!outcomeInterview}
          onOpenChange={(open) => {
            if (!open) {
              setOutcomeInterview(null);
              setInterviewOutcome("next_round");
              setInterviewOutcomeSource("email");
              setInterviewOutcomeSourceReference("");
              setInterviewOutcomeSummary("");
            }
          }}
        >
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">{t("recordInterviewOutcomeTitle")}</DialogTitle>
              <DialogDescription className="text-slate-400">
                {t("recordInterviewOutcomeDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("outcomeLabel")}</label>
                <Select
                  value={interviewOutcome}
                  onValueChange={(value) => setInterviewOutcome(value as InterviewOutcomeType)}
                >
                  <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="next_round">{t("nextRound")}</SelectItem>
                    <SelectItem value="offer">{t("offerLabel")}</SelectItem>
                    <SelectItem value="rejection">{t("rejectionLabel")}</SelectItem>
                    <SelectItem value="no_response">{t("noResponseYet")}</SelectItem>
                    <SelectItem value="other">{t("otherLabel")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {interviewOutcome === "no_response" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">{t("sourceLabel")}</label>
                  <p className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-400">
                    {t("internalStatusCheck")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">{t("sourceLabel")}</label>
                  <Select
                    value={interviewOutcomeSource}
                    onValueChange={(value) => setInterviewOutcomeSource(value as EmployerResponseSource)}
                  >
                    <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">{t("emailLabel")}</SelectItem>
                      <SelectItem value="employer_portal">{t("employerPortal")}</SelectItem>
                      <SelectItem value="linkedin">LinkedIn</SelectItem>
                      <SelectItem value="phone">{t("phoneLabel")}</SelectItem>
                      <SelectItem value="other">{t("otherLabel")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-slate-300">
                  {t("messagePortalReference")}{["next_round", "offer"].includes(interviewOutcome) ? ` (${t("referenceRequiredForNextRoundOffer")})` : ""}
                </label>
                <Input
                  value={interviewOutcomeSourceReference}
                  onChange={(event) => setInterviewOutcomeSourceReference(event.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder={t(["next_round", "offer"].includes(interviewOutcome) ? "requiredSourceReferencePlaceholder" : "optionalSourceReferencePlaceholder")}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-slate-300">{t("outcomeSummary")}</label>
                <Textarea
                  value={interviewOutcomeSummary}
                  onChange={(event) => setInterviewOutcomeSummary(event.target.value)}
                  className="min-h-36 bg-slate-800 border-slate-700 text-white"
                  placeholder={t("outcomeSummaryPlaceholder")}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setOutcomeInterview(null);
                  setInterviewOutcomeSourceReference("");
                  setInterviewOutcomeSummary("");
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={!interviewOutcomeSummary.trim() || (["next_round", "offer"].includes(interviewOutcome) && !interviewOutcomeSourceReference.trim()) || recordInterviewOutcomeMutation.isPending}
                onClick={() => {
                  if (!outcomeInterview) return;
                  recordInterviewOutcomeMutation.mutate({
                    interviewId: outcomeInterview.id,
                    outcome: interviewOutcome,
                    source: interviewOutcomeSource,
                    sourceReference: interviewOutcomeSourceReference.trim() || undefined,
                    summary: interviewOutcomeSummary.trim(),
                  });
                }}
              >
                {recordInterviewOutcomeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("saveOutcome")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!schedulingApplication}
          onOpenChange={(open) => {
            if (!open) {
              setSchedulingApplication(null);
              setInterviewScheduledAt(defaultInterviewDateTimeLocal());
              setInterviewDuration("60");
              setInterviewLocation("");
              setInterviewMeetingLink("");
              setInterviewerName("");
              setInterviewerTitle("");
              setInterviewNotes("");
            }
          }}
        >
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">{t("scheduleInterviewTitle")}</DialogTitle>
              <DialogDescription className="text-slate-400">
                {t("scheduleInterviewDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("interviewType")}</label>
                <Select
                  value={interviewType}
                  onValueChange={(value) => setInterviewType(value as InterviewType)}
                >
                  <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">{t("phoneLabel")}</SelectItem>
                    <SelectItem value="video">{t("videoLabel")}</SelectItem>
                    <SelectItem value="onsite">{t("onsiteLabel")}</SelectItem>
                    <SelectItem value="technical">{t("technicalLabel")}</SelectItem>
                    <SelectItem value="behavioral">{t("behavioralLabel")}</SelectItem>
                    <SelectItem value="panel">{t("panelLabel")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("scheduledTime")}</label>
                <Input
                  type="datetime-local"
                  value={interviewScheduledAt}
                  onChange={(event) => setInterviewScheduledAt(event.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("durationMinutes")}</label>
                <Input
                  type="number"
                  min={5}
                  max={480}
                  value={interviewDuration}
                  onChange={(event) => setInterviewDuration(event.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("locationOrChannel")}</label>
                <Input
                  value={interviewLocation}
                  onChange={(event) => setInterviewLocation(event.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder={t("locationChannelPlaceholder")}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-slate-300">{t("meetingLink")}</label>
                <Input
                  value={interviewMeetingLink}
                  onChange={(event) => setInterviewMeetingLink(event.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("interviewerName")}</label>
                <Input
                  value={interviewerName}
                  onChange={(event) => setInterviewerName(event.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder={t("interviewerNamePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("interviewerTitle")}</label>
                <Input
                  value={interviewerTitle}
                  onChange={(event) => setInterviewerTitle(event.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder={t("interviewerTitlePlaceholder")}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-slate-300">{t("interviewNotes")}</label>
                <Textarea
                  value={interviewNotes}
                  onChange={(event) => setInterviewNotes(event.target.value)}
                  className="min-h-28 bg-slate-800 border-slate-700 text-white"
                  placeholder={t("interviewNotesPlaceholder")}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSchedulingApplication(null);
                  setInterviewNotes("");
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={!interviewScheduledAt || scheduleInterviewMutation.isPending}
                onClick={submitInterviewSchedule}
              >
                {scheduleInterviewMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                 {t("saveInterview")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!confirmingApplication}
          onOpenChange={(open) => {
            if (!open) {
              setConfirmingApplication(null);
              setSubmissionEvidence("");
              setSubmissionConfirmationUrl("");
            }
          }}
        >
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">{t("confirmExternalSubmissionTitle")}</DialogTitle>
              <DialogDescription className="text-slate-400">
                {t("confirmExternalSubmissionDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("proofSource")}</label>
                <Select
                  value={submissionSource}
                  onValueChange={(value) => setSubmissionSource(value as SubmissionEvidenceSource)}
                >
                  <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employer_portal">{t("employerPortal")}</SelectItem>
                    <SelectItem value="email_confirmation">{t("emailConfirmation")}</SelectItem>
                    <SelectItem value="ats_confirmation">{t("atsConfirmation")}</SelectItem>
                    <SelectItem value="manual">{t("manualConfirmation")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("proofNote")}</label>
                <Textarea
                  value={submissionEvidence}
                  onChange={(event) => setSubmissionEvidence(event.target.value)}
                  className="min-h-32 bg-slate-800 border-slate-700 text-white"
                  placeholder={t("proofNotePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t("confirmationUrl")}</label>
                <Input
                  value={submissionConfirmationUrl}
                  onChange={(event) => setSubmissionConfirmationUrl(event.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder="https://..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmingApplication(null);
                  setSubmissionEvidence("");
                  setSubmissionConfirmationUrl("");
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={!submissionEvidence.trim() || confirmSubmissionMutation.isPending}
                onClick={() => {
                  if (!confirmingApplication) return;
                  confirmSubmissionMutation.mutate({
                    applicationId: confirmingApplication.id,
                    source: submissionSource,
                    evidence: submissionEvidence.trim(),
                    confirmationUrl: submissionConfirmationUrl.trim() || undefined,
                  });
                }}
              >
                {confirmSubmissionMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                 {t("confirmSubmission")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={followUpApplicationId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setFollowUpDraft("");
              setFollowUpApplicationId(null);
              setFollowUpDraftPurpose("routine_follow_up");
              setFollowUpSourceResponseId(null);
            }
          }}
        >
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">
                {t(followUpDraftPurpose === "employer_reply" ? "reviewEmployerReplyDraft" : "reviewFollowUpDraft")}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                {t("reviewDraftDescription")}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={followUpDraft}
              onChange={(event) => setFollowUpDraft(event.target.value)}
              className="min-h-64 bg-slate-800 border-slate-700 text-white"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setFollowUpDraft("");
                  setFollowUpApplicationId(null);
                  setFollowUpDraftPurpose("routine_follow_up");
                  setFollowUpSourceResponseId(null);
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={!followUpDraft.trim() || createFollowUpMutation.isPending}
                onClick={() => {
                  if (followUpApplicationId === null) return;
                  createFollowUpMutation.mutate({
                    applicationId: followUpApplicationId,
                    message: followUpDraft.trim(),
                    purpose: followUpDraftPurpose,
                    sourceResponseId: followUpSourceResponseId ?? undefined,
                  });
                }}
              >
                {createFollowUpMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                 {t("saveDraft")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={confirmingFollowUpSentId !== null}
          onOpenChange={(open) => {
            if (!open && !markFollowUpSentMutation.isPending && !sendFollowUpMutation.isPending) {
              setConfirmingFollowUpSentId(null);
              setFollowUpDeliveryConfirmation("");
              setFollowUpMailRecipient("");
            }
          }}
        >
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">{t("completeFollowUpDelivery")}</DialogTitle>
              <DialogDescription className="text-slate-400">
                {t("completeFollowUpDeliveryDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">{t("manualDeliveryConfirmation")}</label>
              <Textarea
                value={followUpDeliveryConfirmation}
                onChange={(event) => setFollowUpDeliveryConfirmation(event.target.value)}
                className="min-h-28 bg-slate-800 border-slate-700 text-white"
                maxLength={1000}
                placeholder={t("manualDeliveryPlaceholder")}
              />
            </div>
            <div className="space-y-3 rounded-md border border-slate-700 bg-slate-950/40 p-3">
              <div>
                <p className="text-sm font-medium text-slate-200">{t("sendConnectedMailbox")}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{t("connectedMailboxDescription")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                <Select value={followUpMailProvider} onValueChange={(value) => setFollowUpMailProvider(value as "gmail" | "outlook")}>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gmail">Gmail</SelectItem>
                    <SelectItem value="outlook">Outlook</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="email"
                  value={followUpMailRecipient}
                  onChange={(event) => setFollowUpMailRecipient(event.target.value)}
                  className="border-slate-700 bg-slate-800 text-white"
                  placeholder="recruiter@company.com"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10"
                disabled={
                  confirmingFollowUpSentId === null ||
                  followUpMailRecipient.trim().length < 3 ||
                  sendFollowUpMutation.isPending ||
                  markFollowUpSentMutation.isPending
                }
                onClick={() => {
                  if (confirmingFollowUpSentId === null) return;
                  sendFollowUpMutation.mutate({
                    followUpId: confirmingFollowUpSentId,
                    provider: followUpMailProvider,
                    recipient: followUpMailRecipient,
                  });
                }}
              >
                {sendFollowUpMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Mail className="mr-2 h-4 w-4" />
                 {t("sendApprovedDraft")}
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={markFollowUpSentMutation.isPending || sendFollowUpMutation.isPending}
                onClick={() => {
                  setConfirmingFollowUpSentId(null);
                  setFollowUpDeliveryConfirmation("");
                  setFollowUpMailRecipient("");
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={
                  confirmingFollowUpSentId === null ||
                  followUpDeliveryConfirmation.trim().length < 8 ||
                  markFollowUpSentMutation.isPending ||
                  sendFollowUpMutation.isPending
                }
                onClick={() => {
                  if (confirmingFollowUpSentId === null) return;
                  markFollowUpSentMutation.mutate({
                    followUpId: confirmingFollowUpSentId,
                    deliveryConfirmation: followUpDeliveryConfirmation,
                  });
                }}
              >
                {markFollowUpSentMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                 {t("recordManualSend")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(acceptingOfferApplication)}
          onOpenChange={(open) => {
            if (!open && !confirmOfferAcceptanceMutation.isPending) {
              setAcceptingOfferApplication(null);
              setOfferAcceptanceConfirmed(false);
              setOfferAcceptanceNote("");
            }
          }}
        >
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">{t("confirmOfferAcceptanceTitle")}</DialogTitle>
              <DialogDescription className="text-slate-400">
                {t("confirmOfferAcceptanceDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-md border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-300">
                <p className="font-medium text-white">{acceptingOfferApplication?.job?.title || t("offerLabel")}</p>
                <p>{acceptingOfferApplication?.job?.company || t("employerFallback")}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300" htmlFor="offer-acceptance-note">
                  {t("confirmationNote")}
                </label>
                <Textarea
                  id="offer-acceptance-note"
                  data-testid="offer-acceptance-note"
                  value={offerAcceptanceNote}
                  onChange={(event) => setOfferAcceptanceNote(event.target.value)}
                  placeholder={t("offerAcceptanceNotePlaceholder")}
                  className="min-h-24 bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <label className="flex items-start gap-3 text-sm text-slate-300">
                <Checkbox
                  data-testid="offer-acceptance-confirmed"
                  checked={offerAcceptanceConfirmed}
                  onCheckedChange={(checked) => setOfferAcceptanceConfirmed(checked === true)}
                />
                <span>{t("confirmAcceptedOffer")}</span>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={confirmOfferAcceptanceMutation.isPending}
                onClick={() => {
                  setAcceptingOfferApplication(null);
                  setOfferAcceptanceConfirmed(false);
                  setOfferAcceptanceNote("");
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                data-testid="confirm-offer-acceptance-submit"
                disabled={
                  !acceptingOfferApplication ||
                  !offerAcceptanceConfirmed ||
                  offerAcceptanceNote.trim().length < 8 ||
                  confirmOfferAcceptanceMutation.isPending
                }
                onClick={() => {
                  if (!acceptingOfferApplication || !offerAcceptanceConfirmed) return;
                  confirmOfferAcceptanceMutation.mutate({
                    applicationId: acceptingOfferApplication.id,
                    confirmed: true,
                    acceptanceNote: offerAcceptanceNote.trim(),
                  });
                }}
              >
                {confirmOfferAcceptanceMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                 {t("recordAcceptance")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(decliningOfferApplication)}
          onOpenChange={(open) => {
            if (!open && !declineOfferMutation.isPending) {
              setDecliningOfferApplication(null);
              setOfferDeclineConfirmed(false);
              setOfferDeclineNote("");
            }
          }}
        >
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">{t("declineOfferTitle")}</DialogTitle>
              <DialogDescription className="text-slate-400">
                {t("declineOfferDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-md border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-300">
                <p className="font-medium text-white">{decliningOfferApplication?.job?.title || t("offerLabel")}</p>
                <p>{decliningOfferApplication?.job?.company || t("employerFallback")}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300" htmlFor="offer-decline-note">
                  {t("decisionNote")}
                </label>
                <Textarea
                  id="offer-decline-note"
                  data-testid="offer-decline-note"
                  value={offerDeclineNote}
                  onChange={(event) => setOfferDeclineNote(event.target.value)}
                  placeholder={t("offerDeclineNotePlaceholder")}
                  className="min-h-24 bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <label className="flex items-start gap-3 text-sm text-slate-300">
                <Checkbox
                  data-testid="offer-decline-confirmed"
                  checked={offerDeclineConfirmed}
                  onCheckedChange={(checked) => setOfferDeclineConfirmed(checked === true)}
                />
                <span>{t("confirmDeclinedOffer")}</span>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={declineOfferMutation.isPending}
                onClick={() => {
                  setDecliningOfferApplication(null);
                  setOfferDeclineConfirmed(false);
                  setOfferDeclineNote("");
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                data-testid="decline-offer-submit"
                disabled={
                  !decliningOfferApplication ||
                  !offerDeclineConfirmed ||
                  offerDeclineNote.trim().length < 8 ||
                  declineOfferMutation.isPending
                }
                onClick={() => {
                  if (!decliningOfferApplication || !offerDeclineConfirmed) return;
                  declineOfferMutation.mutate({
                    applicationId: decliningOfferApplication.id,
                    confirmed: true,
                    declineNote: offerDeclineNote.trim(),
                  });
                }}
              >
                {declineOfferMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                 {t("recordDecline")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <ReportHireDialog
          open={reportHireOpen}
          onOpenChange={setReportHireOpen}
          applicationId={reportHireApplicationId}
          onSuccess={() => {
            refetch();
            refetchApprovals();
            refetchSuccessFees();
            refetchOfferAttributionReviews();
            refetchLedgerArtifacts();
          }}
        />
      </div>
    </div>
  );
}
