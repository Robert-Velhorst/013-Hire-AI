import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Activity, Heart, TrendingUp, Briefcase, Send, Eye, Calendar, Target, Settings, Search, FileText, Rocket, User, Bell, RefreshCw, Clock, CheckCircle, XCircle, MessageSquare, Building2, MapPin, DollarSign, ExternalLink, Loader2, AlertCircle, Mail, Pause, Play, Shield } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { formatAutonomousRunSummary, getAutonomousRunCounts } from "@/lib/autonomousRunSummary";
import { getApplicationDeepLink } from "@/lib/applicationDeepLinks";
import { getInterviewSchedulingControl } from "@/lib/interviewSchedulingControl";
import { getApprovalEvidenceGateSummary } from "@/lib/applicationEvidenceGates";
import { getAutonomousPolicyControlAction } from "@/lib/autonomousPolicyControl";
import { getCommandCenterSummary } from "@/lib/commandCenterSummary";
import { formatDashboardActivityTarget } from "@/lib/dashboardActivity";
import { getSuccessFeeComplianceAction } from "@/lib/successFeeCompliance";
import { getApplicationPerformanceSummary } from "@/lib/applicationPerformance";
import { shouldShowNewUserDashboard, shouldShowProfileOnboarding } from "@/lib/profileOnboarding";
import { formatJobSalary } from "@/lib/jobSalary";
import {
  formatApplicationDecision,
  formatApprovalType,
  getApprovalDecisionNote,
  getOperatingReviewQueueCounts,
  getReviewQueueActionSummary,
  getReviewRiskBadgeClass,
} from "@/lib/operatingReviewQueue";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import TosAcceptanceDialog from "@/components/TosAcceptanceDialog";
import { formatCalendarDate } from "@/lib/calendarDate";
import AppHeader from "@/components/AppHeader";
import { useLocale } from "@/contexts/LocaleContext";

export default function Dashboard() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { locale, t } = useLocale();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [showTos, setShowTos] = useState(false);
  const [showDashboardReviewQueue, setShowDashboardReviewQueue] = useState(false);

  // Fetch real data from API
  const { data: operatingLedger, isLoading: appsLoading, refetch: refetchOperatingLedger } = trpc.applications.getOperatingLedger.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const applications = operatingLedger?.applicationOverview.recent;
  const profileReadiness = operatingLedger?.readiness;
  const autonomousPlan = operatingLedger?.plan;
  const runAutonomousAgent = trpc.automation.run.useMutation({
    onSuccess: async (result) => {
      const counts = getAutonomousRunCounts(result);
      const message = formatAutonomousRunSummary(result);
      if (counts.failures > 0 || counts.resumeEvidenceBlockedActions > 0 || counts.profileReadinessBlockedActions > 0 || counts.emptySourceActionsSkipped > 0) {
        toast.warning(message);
      } else {
        toast.success(message);
      }
      await refetchOperatingLedger();
    },
    onError: (error) => {
      toast.error(error.message || "Autonomous scan failed");
    },
  });
  const resolveApproval = trpc.applications.resolveApproval.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(`Approval ${variables.status}`);
      await refetchOperatingLedger();
    },
    onError: (error) => {
      toast.error(error.message || "Unable to resolve approval");
    },
  });
  const markInterviewNotificationRead = trpc.applications.markInterviewNotificationRead.useMutation({
    onSuccess: async (result) => {
      if (result.changed) toast.success("Interview notification marked read");
      await refetchOperatingLedger();
    },
    onError: (error) => {
      toast.error(error.message || "Unable to update interview notification");
    },
  });
  const setCampaignStatus = trpc.applications.setCampaignStatus.useMutation({
    onSuccess: async ({ campaign }) => {
      toast.success(campaign.status === "paused"
        ? "Campaign paused. New autonomous work is stopped."
        : "Campaign resumed. Autonomous work can run under the current policy.");
      await refetchOperatingLedger();
    },
    onError: (error) => toast.error(error.message || "Unable to update campaign status"),
  });

  // Calculate real stats
  const totalApplications = operatingLedger?.applicationOverview.total || 0;
  const submittedApplicationCount = operatingLedger?.applicationOverview.submitted || 0;
  const activeApplications = operatingLedger?.applicationOverview.active || 0;
  const interviewInvites = operatingLedger?.applicationOverview.interviewing || 0;
  
  const applicationPerformance = getApplicationPerformanceSummary({
    confirmedSubmissions: operatingLedger?.metrics.submittedApplications ?? submittedApplicationCount,
    recordedResponseSignals: operatingLedger?.metrics.employerResponses,
    recordedInterviews: operatingLedger?.metrics.interviews ?? interviewInvites,
  }, locale);

  // Check if user needs ToS acceptance
  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      if (!(user as any).tosAcceptedAt) {
        setShowTos(true);
      }
    }
  }, [loading, isAuthenticated, user]);

  // Show onboarding only when readiness confirms that no candidate evidence exists.
  useEffect(() => {
    setShowOnboarding(shouldShowProfileOnboarding({
      loading,
      isAuthenticated,
      tosAccepted: Boolean((user as any)?.tosAcceptedAt),
      readiness: profileReadiness,
    }));
  }, [loading, isAuthenticated, profileReadiness, user]);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [loading, isAuthenticated]);

  const handleRunAutonomousReview = () => {
    if (!autonomousControl.runsAgent) {
      toast.info(autonomousControl.detail);
      setLocation(autonomousControl.route);
      return;
    }
    toast.info("Preparing review-safe work from the current jobs and automation policy...");
    runAutonomousAgent.mutate();
  };
  const toggleCampaignStatus = () => {
    if (!operatingLedger) return;
    setCampaignStatus.mutate({
      status: operatingLedger.campaign.status === "active" ? "paused" : "active",
    });
  };

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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Activity className="h-12 w-12 text-cyan-400 animate-pulse mx-auto mb-4" />
          <p className="text-slate-400">{t("dashboardLoading")}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const isNewUser = shouldShowNewUserDashboard({
    totalApplications,
    onboarding: {
      loading,
      isAuthenticated,
      tosAccepted: Boolean((user as any)?.tosAcceptedAt),
      readiness: profileReadiness,
    },
  });
  const reviewQueueCount = getOperatingReviewQueueCounts(operatingLedger).total;
  const canReviewAdminItems = operatingLedger?.canReviewAdminItems === true;
  const successFeeCompliance = operatingLedger?.successFeeCompliance ?? {
    status: "none" as const,
    activeFees: 0,
    suspendedFees: 0,
    pausedFees: 0,
    disputedFees: 0,
    pendingVerification: 0,
    overdueVerifications: 0,
    dueSoonVerifications: 0,
    pendingOfferAttributions: 0,
    monthlyFeeCents: 0,
    nextVerificationDue: null,
    daysUntilNextVerification: null,
    label: "No active fees",
    nextAction: "Report a hire only after an offer is accepted.",
  };
  const successFeeComplianceAction = getSuccessFeeComplianceAction(successFeeCompliance);
  const autonomousControl = getAutonomousPolicyControlAction({
    plan: autonomousPlan,
    campaign: operatingLedger?.campaign,
  });
  const commandCenterSummary = operatingLedger
    ? getCommandCenterSummary(operatingLedger, successFeeCompliance)
    : null;
  const commandCenterTone = commandCenterSummary ? {
    blocked: "border-red-500/40 bg-red-500/10 text-red-200",
    approval_required: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    attention: "border-blue-500/40 bg-blue-500/10 text-blue-200",
    ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    clear: "border-slate-700 bg-slate-900/60 text-slate-200",
  }[commandCenterSummary.status] : "";
  const operatingMetricItems = operatingLedger
    ? [
        ["Prepared", operatingLedger.metrics.preparedApplications],
        ["Submitted", operatingLedger.metrics.submittedApplications],
        ["Responses", operatingLedger.metrics.employerResponses],
        ["Interview alerts", operatingLedger.metrics.unreadInterviewNotifications],
        ["Replies", operatingLedger.metrics.employerResponsesNeedingReply],
        ["Interviews", operatingLedger.metrics.interviews],
        ["Scheduling", operatingLedger.metrics.interviewSchedulingNeeded],
        ["Prep", operatingLedger.metrics.interviewPreparationNeeded],
        ["Outcomes", operatingLedger.metrics.interviewOutcomesNeeded],
        ["Connectors", operatingLedger.metrics.connectorReadiness],
        ["Offers", operatingLedger.metrics.offers],
        ["Approvals", operatingLedger.metrics.pendingApprovals],
        ...(canReviewAdminItems ? [["Admin reviews", operatingLedger.metrics.openAdminReviews]] : []),
      ]
    : [];
  const runCommandCenterAction = (route: string) => {
    setLocation(route);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* ToS Acceptance Dialog - shown on first login */}
      <TosAcceptanceDialog
        open={showTos}
        onAccepted={() => setShowTos(false)}
      />

      {/* Onboarding Modal */}
      <Dialog open={showOnboarding} onOpenChange={setShowOnboarding}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Rocket className="h-6 w-6 text-cyan-400" />
              {t("onboardingTitle")}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {t("onboardingDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-4 p-4 bg-slate-800/50 rounded-lg">
              <div className="h-10 w-10 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <h4 className="font-medium text-white">{t("onboardingResumeTitle")}</h4>
                <p className="text-sm text-slate-400">{t("onboardingResumeDescription")}</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-slate-800/50 rounded-lg">
              <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Target className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h4 className="font-medium text-white">{t("onboardingPreferencesTitle")}</h4>
                <p className="text-sm text-slate-400">{t("onboardingPreferencesDescription")}</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-slate-800/50 rounded-lg">
              <div className="h-10 w-10 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <Send className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <h4 className="font-medium text-white">{t("onboardingReviewTitle")}</h4>
                <p className="text-sm text-slate-400">{t("onboardingReviewDescription")}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 border-slate-700 text-slate-300"
              onClick={() => setShowOnboarding(false)}
            >
              {t("doLater")}
            </Button>
            <Button
              className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600"
              onClick={() => {
                setShowOnboarding(false);
                setLocation("/profile");
              }}
            >
              {t("getStarted")}
              <Rocket className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AppHeader currentPage="dashboard" />

      <main className="container mx-auto px-4 py-8">
        {/* Welcome Section */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">
              {t("welcomeBack", { name: user?.name?.split(" ")[0] || t("jobSeeker") })}
            </h1>
            <p className="text-slate-400">
              {isNewUser 
                ? t("newUserDashboardDescription")
                : t("dashboardDescription")
              }
            </p>
          </div>
          <Button
            data-testid="dashboard-autonomous-control"
            variant="outline"
            className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
            onClick={handleRunAutonomousReview}
            disabled={runAutonomousAgent.isPending || !autonomousPlan}
            title={autonomousControl.runsAgent ? undefined : autonomousControl.detail}
          >
            {runAutonomousAgent.isPending && autonomousControl.runsAgent ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              autonomousControl.runsAgent
                ? <RefreshCw className="mr-2 h-4 w-4" />
                : <User className="mr-2 h-4 w-4" />
            )}
            {runAutonomousAgent.isPending && autonomousControl.runsAgent
              ? t("preparing")
              : autonomousControl.cta}
          </Button>
        </div>

        {/* New User CTA */}
        {isNewUser && (
          <Card className="bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10 border-cyan-500/30 mb-8">
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-cyan-500/20 flex items-center justify-center">
                    <Rocket className="h-6 w-6 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Complete Your Profile</h3>
                    <p className="text-slate-400">Upload your resume to start receiving personalized job matches</p>
                  </div>
                </div>
                <Button
                  className="bg-gradient-to-r from-cyan-500 to-blue-600"
                  onClick={() => setLocation("/profile")}
                >
                  Set Up Profile
                  <FileText className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {commandCenterSummary && (
          <Card data-testid="command-center-card" className={`mb-8 border ${commandCenterTone}`}>
            <CardContent className="p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={commandCenterTone}>
                      {commandCenterSummary.label}
                    </Badge>
                    <Badge variant="outline" className="border-slate-700 text-slate-300">
                      {commandCenterSummary.openActions} operating action{commandCenterSummary.openActions === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-white">Command Center</h2>
                    <p className="mt-1 text-sm text-slate-300">{commandCenterSummary.headline}</p>
                    <p className="mt-2 max-w-3xl text-sm text-slate-400">{commandCenterSummary.nextAction}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row lg:w-60 lg:flex-col">
                  <Button
                    data-testid="command-center-primary"
                    className="bg-cyan-600 hover:bg-cyan-500"
                    onClick={() => runCommandCenterAction(commandCenterSummary.primaryRoute)}
                    disabled={runAutonomousAgent.isPending && commandCenterSummary.primaryRoute === "/dashboard"}
                  >
                    {runAutonomousAgent.isPending && commandCenterSummary.primaryRoute === "/dashboard" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Target className="mr-2 h-4 w-4" />
                    )}
                    {commandCenterSummary.primaryCta}
                  </Button>
                  <Button
                    data-testid="command-center-secondary"
                    variant="outline"
                    className="border-slate-700 text-slate-300"
                    onClick={() => runCommandCenterAction(commandCenterSummary.secondaryRoute)}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {commandCenterSummary.secondaryCta}
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-10">
                {[
                  ["Approvals", commandCenterSummary.approvalItems, "/review-queue"],
                  ["Reviews", commandCenterSummary.reviewItems, "/review-queue"],
                  ["Profile gaps", commandCenterSummary.profileBlockers, "/profile"],
                  ["Connectors", commandCenterSummary.connectorReadiness, "/profile"],
                  ["Interviews", commandCenterSummary.interviewSchedulingNeeded, "/review-queue"],
                  ["Prep", commandCenterSummary.interviewPreparationNeeded, "/review-queue"],
                  ["Outcomes", commandCenterSummary.interviewOutcomesNeeded, "/review-queue"],
                  ["Evidence", commandCenterSummary.evidenceGates, "/profile"],
                  ["Inbox", commandCenterSummary.inboxResponseCandidates, "/review-queue#review-queue-section-inbox-response-candidates"],
                  ["Replies", commandCenterSummary.employerResponsesNeedingReply, "/review-queue"],
                  ["Delivery checks", commandCenterSummary.followUpDeliveryReconciliation, "/review-queue"],
                  ["Send handoffs", commandCenterSummary.approvedFollowUpsReadyToSend, "/review-queue"],
                  ["Follow-ups", commandCenterSummary.followUpsDue, "/applications"],
                  ["Compliance", commandCenterSummary.complianceItems, successFeeComplianceAction.route],
                  ["Prepared", commandCenterSummary.preparedApplications, "/applications"],
                ].map(([label, value, route]) => (
                  <button
                    key={String(label)}
                    data-testid={`command-center-metric-${String(label).toLowerCase().replace(/\s+/g, "-")}`}
                    type="button"
                    className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-left transition hover:border-cyan-500/50 hover:bg-slate-900"
                    onClick={() => runCommandCenterAction(String(route))}
                  >
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="mt-1 text-lg font-semibold text-white">{value}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {operatingLedger && (
          <Card className="bg-slate-900/50 border-slate-800/50 mb-8">
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Shield className="h-5 w-5 text-emerald-400" />
                    Operating Ledger
                  </CardTitle>
                  <CardDescription className="text-slate-400 mt-1">
                    {operatingLedger.campaign.title} · {operatingLedger.campaign.automationMode.replace("_", " ")}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant="outline"
                    className={operatingLedger.readiness.autoApplyEligible
                      ? "border-emerald-500/40 text-emerald-300"
                      : "border-amber-500/40 text-amber-300"}
                  >
                    {operatingLedger.readiness.score}% ready
                  </Badge>
                  <Badge variant="outline" className="border-slate-600 text-slate-300">
                    {operatingLedger.metrics.dailyRemaining} slots left
                  </Badge>
                  <Badge
                    variant="outline"
                    className={operatingLedger.campaign.status === "active"
                      ? "border-emerald-500/40 text-emerald-300"
                      : "border-amber-500/40 text-amber-300"}
                  >
                    {operatingLedger.campaign.status}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
                {operatingMetricItems.map(([label, value]) => (
                  <div key={label} className="border-l border-slate-700 pl-3">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-xl font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Next operating actions</p>
                  {operatingLedger.nextActions.slice(0, 4).map((action) => (
                    <div key={action} className="flex items-start gap-2 text-sm text-slate-300">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      <span>{action}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                  <Button
                    data-testid="campaign-status-toggle"
                    variant="outline"
                    size="sm"
                    className={operatingLedger.campaign.status === "active"
                      ? "border-amber-500/50 text-amber-300 hover:bg-amber-500/10"
                      : "border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10"}
                    onClick={toggleCampaignStatus}
                    disabled={setCampaignStatus.isPending}
                  >
                    {setCampaignStatus.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : operatingLedger.campaign.status === "active" ? (
                      <Pause className="mr-2 h-4 w-4" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    {operatingLedger.campaign.status === "active" ? "Pause campaign" : "Resume campaign"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 text-slate-300"
                    onClick={() => setLocation("/applications")}
                  >
                    <Briefcase className="mr-2 h-4 w-4" />
                    Open Ledger
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 text-slate-300"
                    onClick={() => setLocation("/review-queue")}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Review Queue
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 text-slate-300"
                    onClick={() => setLocation("/ai-preferences")}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    Adjust Policy
                  </Button>
                </div>
              </div>

              <Separator className="bg-slate-800" />

              {operatingLedger.queues.interviewNotifications.length > 0 && (
                <section
                  data-testid="dashboard-interview-notifications"
                  aria-live="polite"
                  className="border-b border-slate-800 pb-5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Interview notifications</p>
                      <p className="text-xs text-slate-500">
                        Shown only after a recorded employer interview invitation.
                      </p>
                    </div>
                    <Badge variant="outline" className="w-fit border-blue-500/40 text-blue-300">
                      {operatingLedger.metrics.unreadInterviewNotifications} unread
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-3">
                    {operatingLedger.queues.interviewNotifications.map((notification) => (
                      <div
                        key={notification.notificationId}
                        className="flex flex-col gap-3 border-l-2 border-blue-400 bg-slate-950/30 py-2 pl-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Bell className="h-4 w-4 text-blue-300" aria-hidden="true" />
                            <p className="text-sm font-medium text-white">
                              {notification.job?.title || `Application #${notification.applicationId}`}
                            </p>
                            <Badge variant="outline" className="border-blue-500/40 text-blue-300">
                              Verified interview invite
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {notification.job?.company || "Employer"}
                            {notification.job?.location ? ` - ${notification.job.location}` : ""}
                          </p>
                          <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                            {notification.summary}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-blue-500/40 text-blue-200"
                            onClick={() => setLocation(getApplicationDeepLink(notification.applicationId, "schedule-interview"))}
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            Schedule
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-slate-300 hover:text-white"
                            disabled={markInterviewNotificationRead.isPending}
                            onClick={() => markInterviewNotificationRead.mutate({ notificationId: notification.notificationId })}
                          >
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Mark read
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Review Queue</p>
                    <p className="text-xs text-slate-500">
                      Consequential actions stay in the dedicated queue until you are ready to review them.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={reviewQueueCount > 0
                        ? "w-fit border-amber-500/40 text-amber-300"
                        : "w-fit border-emerald-500/40 text-emerald-300"}
                    >
                      {reviewQueueCount} item{reviewQueueCount === 1 ? "" : "s"}
                    </Badge>
                    {reviewQueueCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-slate-700 text-slate-300"
                        onClick={() => setShowDashboardReviewQueue((visible) => !visible)}
                      >
                        {showDashboardReviewQueue ? "Hide preview" : "Preview here"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-cyan-500/40 text-cyan-200"
                      onClick={() => setLocation("/review-queue")}
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Open queue
                    </Button>
                  </div>
                </div>

                {reviewQueueCount > 0 && !showDashboardReviewQueue ? (
                  <div
                    data-testid="dashboard-review-queue-summary"
                    className="flex flex-col gap-3 rounded-md border border-slate-800 bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200">
                        {commandCenterSummary?.headline || "Your review queue has items that need a human decision."}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        Review by risk, evidence, and lifecycle state without crowding the command center.
                      </p>
                    </div>
                    <Button
                      className="shrink-0 bg-cyan-600 hover:bg-cyan-500"
                      onClick={() => setLocation("/review-queue")}
                    >
                      Review {reviewQueueCount} item{reviewQueueCount === 1 ? "" : "s"}
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                ) : reviewQueueCount > 0 ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {operatingLedger.queues.pendingApprovals.map((approval) => {
                      const evidenceGate = getApprovalEvidenceGateSummary(
                        approval,
                        operatingLedger.queues.evidenceGates
                      );
                      const evidenceBlocked = evidenceGate.count > 0;

                      return (
                      <div
                        key={`approval-${approval.id}`}
                        className="rounded-md border border-slate-800 bg-slate-950/40 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-white">{approval.title}</p>
                              <Badge
                                variant="outline"
                                className={getReviewRiskBadgeClass(approval.riskLevel)}
                              >
                                {approval.riskLevel}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatApprovalType(approval.approvalType)}
                            </p>
                            {approval.description && (
                              <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                                {approval.description}
                              </p>
                            )}
                          </div>
                        </div>
                        {evidenceBlocked && (
                          <p className="mt-2 text-xs text-amber-200">{evidenceGate.detail}</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-500"
                            data-testid={`dashboard-approval-approve-${approval.id}`}
                            disabled={resolveApproval.isPending || evidenceBlocked}
                            title={evidenceBlocked ? evidenceGate.detail : undefined}
                            onClick={() => handleResolveApproval(approval, "approved")}
                          >
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                            disabled={resolveApproval.isPending}
                            onClick={() => handleResolveApproval(approval, "rejected")}
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            Reject
                          </Button>
                          {evidenceBlocked && (
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid={`dashboard-approval-resolve-evidence-${approval.id}`}
                              onClick={() => setLocation(evidenceGate.route)}
                            >
                              <User className="mr-2 h-4 w-4" />
                              Resolve Evidence
                            </Button>
                          )}
                        </div>
                      </div>
                      );
                    })}

                    {operatingLedger.queues.inboxResponseCandidates.map((candidate) => (
                      <div
                        key={`inbox-response-candidate-${candidate.id}`}
                        data-testid={`dashboard-inbox-response-candidate-${candidate.id}`}
                        className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">
                            {candidate.job?.title || `Application #${candidate.applicationId}`}
                          </p>
                          <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                            Inbox response candidate
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {candidate.job?.company || "Employer"}
                          {candidate.job?.location ? ` - ${candidate.job.location}` : ""}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                          {candidate.subject || "A consented inbox scan found an application-linked message."}
                        </p>
                        <p className="mt-1 text-xs text-amber-100">
                          Confirm or dismiss the {candidate.suggestedResponseType.replace(/_/g, " ")} classification before Hire.AI changes the application ledger.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-amber-500/40 text-amber-200"
                          onClick={() => setLocation("/review-queue#review-queue-section-inbox-response-candidates")}
                        >
                          <Mail className="mr-2 h-4 w-4" />
                          Review inbox response
                        </Button>
                      </div>
                    ))}

                    {operatingLedger.queues.reviewDecisions.map((decision) => {
                      const actionSummary = getReviewQueueActionSummary("job_decision", decision);
                      const jobTitle = decision.job?.title || `Job #${decision.jobId}`;

                      return (
                      <div
                        key={`decision-${decision.id}`}
                        data-testid="dashboard-review-decision-card"
                        className="rounded-md border border-slate-800 bg-slate-950/40 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">
                            {jobTitle} needs decision review
                          </p>
                          <Badge
                            variant="outline"
                            className={getReviewRiskBadgeClass(decision.riskLevel)}
                          >
                            {decision.riskLevel}
                          </Badge>
                          {actionSummary.approvalGated && (
                            <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
                              Blocks execution
                            </Badge>
                          )}
                          {actionSummary.externalAction === "manual_handoff" && (
                            <Badge variant="outline" className="border-blue-500/40 text-blue-300">
                              Manual handoff
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatApplicationDecision(decision.decision)}
                          {decision.applicationId ? ` - Application #${decision.applicationId}` : ""}
                          {decision.matchScore != null ? ` · ${decision.matchScore}% match` : ""}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                          {decision.reviewReason || decision.decisionReason || "Review the saved application decision before execution."}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-slate-700 text-slate-300"
                          onClick={() => setLocation(actionSummary.route)}
                        >
                          <Search className="mr-2 h-4 w-4" />
                          {actionSummary.cta}
                        </Button>
                      </div>
                      );
                    })}

                    {operatingLedger.queues.connectorReadiness.map((item) => (
                      <div
                        key={`connector-${item.id}`}
                        data-testid={`dashboard-connector-readiness-${item.id}`}
                        className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">{item.label}</p>
                          <Badge
                            variant="outline"
                            className={getReviewRiskBadgeClass(item.riskLevel)}
                          >
                            {String(item.status).replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm text-slate-300">
                          {item.detail}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-amber-500/40 text-amber-200"
                          onClick={() => setLocation("/profile")}
                        >
                          <User className="mr-2 h-4 w-4" />
                          Open Profile
                        </Button>
                      </div>
                    ))}

                    {operatingLedger.queues.interviewScheduling.map((item) => {
                      const control = getInterviewSchedulingControl(item.schedulingRequirement);
                      return <div
                        key={`interview-scheduling-${item.applicationId}`}
                        className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">
                            {item.job?.title || `Application #${item.applicationId}`}
                          </p>
                          <Badge variant="outline" className={control.badgeClassName}>
                            {control.badgeLabel}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.job?.company || "Employer"}{item.job?.location ? ` - ${item.job.location}` : ""}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                          {control.description}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-slate-700 text-slate-300"
                          onClick={() => setLocation(getApplicationDeepLink(item.applicationId, control.action))}
                        >
                          <Calendar className="mr-2 h-4 w-4" />
                          {control.actionLabel}
                        </Button>
                      </div>;
                    })}

                    {operatingLedger.queues.employerResponsesNeedingReply.map((item) => (
                      <div
                        key={`employer-response-${item.responseId}`}
                        className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">
                            {item.job?.title || `Application #${item.applicationId}`}
                          </p>
                          <Badge variant="outline" className="border-blue-500/40 text-blue-300">
                            {String(item.responseType || "response").replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.job?.company || "Employer"}{item.job?.location ? ` - ${item.job.location}` : ""}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                          {item.summary || "Review this employer response before drafting any follow-up."}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-slate-700 text-slate-300"
                          onClick={() => setLocation(getApplicationDeepLink(item.applicationId, "employer-response"))}
                        >
                          <MessageSquare className="mr-2 h-4 w-4" />
                          Open Response
                        </Button>
                      </div>
                    ))}

                    {operatingLedger.queues.followUpsDue.map((item) => (
                      <div
                        key={`follow-up-due-${item.applicationId}`}
                        className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">
                            {item.job?.title || `Application #${item.applicationId}`}
                          </p>
                          <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
                            {String(item.messageType || "follow-up").replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.job?.company || "Employer"}{item.job?.location ? ` - ${item.job.location}` : ""}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                          {item.reason || "Draft a timely follow-up before the application goes cold."}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-slate-700 text-slate-300"
                          onClick={() => setLocation(getApplicationDeepLink(item.applicationId, "follow-up"))}
                        >
                          <Mail className="mr-2 h-4 w-4" />
                          Open Follow-up
                        </Button>
                      </div>
                    ))}

                    {operatingLedger.queues.followUpDeliveryReconciliation.map((item) => (
                      <div
                        key={`follow-up-delivery-reconciliation-${item.followUpId}`}
                        data-testid={`dashboard-follow-up-delivery-reconciliation-${item.followUpId}`}
                        className="rounded-md border border-red-500/30 bg-red-500/5 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">
                            {item.job?.title || `Application #${item.applicationId}`}
                          </p>
                          <Badge variant="outline" className="border-red-500/40 text-red-300">
                            Delivery uncertain
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.deliveryProvider ? `${item.deliveryProvider} ` : ""}{item.deliveryRecipient || "connected mailbox"}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                          Check the provider before recording a manual result. Hire.AI will not retry this follow-up.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-red-500/40 text-red-200"
                          onClick={() => setLocation(getApplicationDeepLink(item.applicationId, "send-follow-up"))}
                        >
                          <Mail className="mr-2 h-4 w-4" />
                          Verify Delivery
                        </Button>
                      </div>
                    ))}

                    {operatingLedger.readiness.blockers.slice(0, 2).map((blocker) => (
                      <div
                        key={`blocker-${blocker.key}`}
                        className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3"
                      >
                        <p className="text-sm font-medium text-amber-100">{blocker.label}</p>
                        <p className="mt-1 text-sm text-amber-200/80">{blocker.recommendation}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-amber-500/40 text-amber-200"
                          onClick={() => setLocation("/profile")}
                        >
                          <User className="mr-2 h-4 w-4" />
                          Fix Profile
                        </Button>
                      </div>
                    ))}

                    {operatingLedger.readiness.warnings.slice(0, 2).map((warning) => (
                      <div
                        key={`warning-${warning.key}`}
                        className="rounded-md border border-slate-800 bg-slate-950/40 p-3"
                      >
                        <p className="text-sm font-medium text-white">{warning.label}</p>
                        <p className="mt-1 text-sm text-slate-300">{warning.recommendation}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-slate-700 text-slate-300"
                          onClick={() => setLocation("/profile")}
                        >
                          <User className="mr-2 h-4 w-4" />
                          Improve Profile
                        </Button>
                      </div>
                    ))}

                    {canReviewAdminItems && operatingLedger.queues.adminReviews.map((review) => (
                      <div
                        key={`admin-review-${review.id}`}
                        className="rounded-md border border-slate-800 bg-slate-950/40 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">{review.title}</p>
                          <Badge
                            variant="outline"
                            className={getReviewRiskBadgeClass(review.priority)}
                          >
                            {review.priority}
                          </Badge>
                        </div>
                        {review.description && (
                          <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                            {review.description}
                          </p>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-slate-700 text-slate-300"
                          onClick={() => setLocation("/admin")}
                        >
                          <Shield className="mr-2 h-4 w-4" />
                          Open Admin Review
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-300">
                    <CheckCircle className="h-4 w-4" />
                    No operating approvals or readiness blockers need attention.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card data-testid="dashboard-success-fee-compliance" className="bg-slate-900/50 border-slate-800/50 mb-8">
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-cyan-400" />
                  Success Fee Compliance
                </CardTitle>
                <CardDescription className="text-slate-400 mt-1">
                  Offer attribution, billing approvals, and verification deadlines
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className={successFeeCompliance.status === "needs_attention"
                  ? "w-fit border-red-500/40 text-red-300"
                  : successFeeCompliance.status === "due_soon"
                    ? "w-fit border-amber-500/40 text-amber-300"
                    : successFeeCompliance.status === "clear"
                      ? "w-fit border-emerald-500/40 text-emerald-300"
                      : "w-fit border-slate-600 text-slate-300"}
              >
                {successFeeCompliance.label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                ["Active fees", successFeeCompliance.activeFees],
                ["Suspended", successFeeCompliance.suspendedFees],
                ["Paused", successFeeCompliance.pausedFees],
                ["Disputed", successFeeCompliance.disputedFees],
                ["Monthly fee", `$${(successFeeCompliance.monthlyFeeCents / 100).toFixed(2)}`],
                ["Offer reviews", successFeeCompliance.pendingOfferAttributions],
                ["Overdue", successFeeCompliance.overdueVerifications],
              ].map(([label, value]) => (
                <div key={label} className="border-l border-slate-700 pl-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-xl font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="w-fit border-slate-700 text-slate-300">
                    {successFeeComplianceAction.label}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={successFeeComplianceAction.approvalGated
                      ? "w-fit border-amber-500/40 text-amber-300"
                      : "w-fit border-slate-700 text-slate-300"}
                  >
                    {successFeeComplianceAction.approvalGated ? "Approval-gated" : "Internal"}
                  </Badge>
                  {successFeeComplianceAction.proofRequired && (
                    <Badge variant="outline" className="w-fit border-cyan-500/40 text-cyan-300">
                      Proof required
                    </Badge>
                  )}
                </div>
                <div className="flex items-start gap-2 text-sm text-slate-300">
                  {successFeeCompliance.status === "needs_attention" ? (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  ) : successFeeCompliance.status === "clear" ? (
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  )}
                  <span>{successFeeComplianceAction.detail}</span>
                </div>
                {successFeeCompliance.nextVerificationDue && (
                  <p className="text-xs text-slate-500">
                    Next verification: {formatCalendarDate(successFeeCompliance.nextVerificationDue, locale)}
                    {successFeeCompliance.daysUntilNextVerification !== null
                      ? ` (${successFeeCompliance.daysUntilNextVerification} days)`
                      : ""}
                  </p>
                )}
              </div>
              <Button
                data-testid="dashboard-success-fee-primary"
                variant="outline"
                size="sm"
                className="border-slate-700 text-slate-300"
                onClick={() => setLocation(successFeeComplianceAction.route)}
              >
                <DollarSign className="mr-2 h-4 w-4" />
                {successFeeComplianceAction.cta}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 mb-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        {autonomousPlan && (
          <Card className="bg-slate-900/50 border-slate-800/50 mb-8">
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Activity className="h-5 w-5 text-cyan-400" />
                    Autonomous Agent
                  </CardTitle>
                  <CardDescription className="text-slate-400 mt-1">
                    {autonomousPlan.mode === "auto_apply"
                      ? "Using accelerated preparation with final submission review"
                      : "Preparing matches for review before submission"}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setLocation("/ai-preferences")}>
                    <Settings className="mr-2 h-4 w-4" />
                    Policy
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setLocation("/jobs")}>
                    <Search className="mr-2 h-4 w-4" />
                    Review Jobs
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Scanned", autonomousPlan.summary.scanned],
                  ["Eligible", autonomousPlan.summary.eligible],
                  ["Slots left", autonomousPlan.summary.dailyRemaining],
                  ["Review", autonomousPlan.summary.queuedForReview],
                  ["Manual", autonomousPlan.summary.manualApply],
                  ["Blocked", autonomousPlan.summary.blocked || 0],
                  ["Follow-ups ready", autonomousPlan.summary.followUpsActionReady ?? autonomousPlan.summary.followUpsDue],
                  ["Gates", autonomousPlan.evidenceGates?.length || 0],
                  ["Stale", autonomousPlan.summary.expiredJobsSkipped || 0],
                ].map(([label, value]) => (
                  <div key={label} className="border-l border-slate-700 pl-3">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-xl font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-col gap-2 border-t border-slate-800 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="text-slate-400">
                  {autonomousPlan.summary.dailyRemaining} preparation slots remain in today's policy limit.
                </span>
                {autonomousPlan.summary.policyWarnings > 0 && (
                  <Badge variant="outline" className="max-w-full whitespace-normal border-amber-500/40 text-left leading-5 text-amber-300">
                    {autonomousPlan.summary.policyWarnings} policy warning{autonomousPlan.summary.policyWarnings === 1 ? "" : "s"}
                  </Badge>
                )}
              {autonomousPlan.summary.expiredJobsSkipped > 0 && (
                <Badge variant="outline" className="max-w-full whitespace-normal border-slate-700 text-left leading-5 text-slate-300">
                  {autonomousPlan.summary.expiredJobsSkipped} expired or stale posting{autonomousPlan.summary.expiredJobsSkipped === 1 ? "" : "s"} excluded
                </Badge>
              )}
              {(autonomousPlan.summary.followUpsBlocked || 0) > 0 && (
                <Badge variant="outline" className="max-w-full whitespace-normal border-slate-700 text-left leading-5 text-slate-300">
                  {autonomousPlan.summary.followUpsBlocked} follow-up candidate{autonomousPlan.summary.followUpsBlocked === 1 ? "" : "s"} held by existing draft, response, or interview work
                </Badge>
              )}
              </div>
              {autonomousPlan.evidenceGates?.length > 0 && (
                <div data-testid="dashboard-autonomous-evidence-gates" className="mt-4 grid gap-2 md:grid-cols-2">
                  {autonomousPlan.evidenceGates.slice(0, 4).map((gate: any) => (
                    <div key={gate.id || gate.label} className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
                        <AlertCircle className="h-4 w-4" />
                        {gate.label || "Evidence gate"}
                      </div>
                      <p className="mt-1 text-xs text-amber-100/80">{gate.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

          {profileReadiness && (
            <Card className="bg-slate-900/50 border-slate-800/50 mb-8">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Shield className="h-5 w-5 text-emerald-400" />
                      Profile Readiness
                    </CardTitle>
                    <CardDescription className="text-slate-400 mt-1">
                      Candidate evidence gate for safe autonomous preparation
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={profileReadiness.autoApplyEligible
                      ? "border-emerald-500/40 text-emerald-300"
                      : "border-amber-500/40 text-amber-300"}
                  >
                    {profileReadiness.autoApplyEligible ? "Automation ready" : "Needs input"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-slate-300">Readiness score</span>
                    <span className="font-semibold text-white">{profileReadiness.score}%</span>
                  </div>
                  <Progress value={profileReadiness.score} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-slate-500">Blockers</p>
                    <p className="text-xl font-semibold text-white">{profileReadiness.blockers.length}</p>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-slate-500">Warnings</p>
                    <p className="text-xl font-semibold text-white">{profileReadiness.warnings.length}</p>
                  </div>
                </div>

                {profileReadiness.nextActions.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Next fixes</p>
                    {profileReadiness.nextActions.slice(0, 3).map((action) => (
                      <div key={action} className="flex items-start gap-2 text-sm text-slate-300">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <span>{action}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-emerald-300">
                    <CheckCircle className="h-4 w-4" />
                    Profile has the core evidence needed for review-safe automation.
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-slate-700 text-slate-300"
                  onClick={() => setLocation("/profile")}
                >
                  <User className="mr-2 h-4 w-4" />
                  Improve Profile
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Health Metrics */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-slate-400">
                  Active Applications
                </CardTitle>
                <Send className="h-5 w-5 text-cyan-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white mb-1">
                {appsLoading ? "..." : activeApplications}
              </div>
              <p className="text-xs text-slate-400">
                {totalApplications > 0 ? `${totalApplications} tracked, ${submittedApplicationCount} submitted` : "No applications yet"}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-slate-400">
                  Interview Invites
                </CardTitle>
                <Calendar className="h-5 w-5 text-purple-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white mb-1">
                {appsLoading ? "..." : interviewInvites}
              </div>
              <p className="text-xs text-slate-400">
                {interviewInvites > 0 ? (
                  <span className="text-purple-400 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    {interviewInvites} application{interviewInvites === 1 ? "" : "s"} in interview stage
                  </span>
                ) : "Apply to get interviews"}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-slate-400">
                  Roles Scanned
                </CardTitle>
                <Search className="h-5 w-5 text-blue-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white mb-1">
                {operatingLedger?.planSummary.scanned || 0}
              </div>
              <p className="text-xs text-slate-400">
                Current bounded planning window
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Vital Signs */}
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Activity className="h-5 w-5 text-cyan-400" />
                Job Search Vital Signs
              </CardTitle>
              <CardDescription className="text-slate-400">
                {applicationPerformance.confirmedSubmissions > 0
                  ? "Ledger-derived rates from confirmed submissions"
                  : "Start applying to see your performance metrics"
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Applications Sent</span>
                  <span className="text-cyan-400 font-semibold">{submittedApplicationCount}</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(submittedApplicationCount * 2, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {submittedApplicationCount === 0 ? "No confirmed submissions yet" : "Confirmed employer submissions"}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Response Rate</span>
                  <span className="text-green-400 font-semibold">{applicationPerformance.responseRate}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-500" 
                    style={{ width: `${applicationPerformance.responseRate}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {applicationPerformance.responseDetail}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Interview Conversion</span>
                  <span className="text-purple-400 font-semibold">{applicationPerformance.interviewRate}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500" 
                    style={{ width: `${applicationPerformance.interviewRate}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {applicationPerformance.interviewDetail}
                </p>
              </div>


            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-400" />
                Recent Activity
              </CardTitle>
              <CardDescription className="text-slate-400">
                Latest updates on your job search
              </CardDescription>
            </CardHeader>
            <CardContent>
              {applications && applications.length > 0 ? (
                <div className="space-y-4">
                  {applications.slice(0, 4).map((app, index) => (
                    <div key={app.id || index} className="flex items-start gap-3 pb-3 border-b border-slate-800/50 last:border-0">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        app.status === 'interview' ? 'bg-green-500/10' :
                        app.status === 'offer' ? 'bg-yellow-500/10' :
                        app.status === 'viewed' ? 'bg-blue-500/10' :
                        'bg-cyan-500/10'
                      }`}>
                        {app.status === 'pending' ? <Clock className="h-4 w-4 text-slate-400" /> :
                         app.status === 'interview' ? <Calendar className="h-4 w-4 text-green-400" /> :
                         app.status === 'offer' ? <Briefcase className="h-4 w-4 text-yellow-400" /> :
                         app.status === 'viewed' ? <Eye className="h-4 w-4 text-blue-400" /> :
                         <Send className="h-4 w-4 text-cyan-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium">
                          {app.status === "pending" ? "Queued" : app.status}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {formatDashboardActivityTarget(app.job, locale)}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {app.status === "pending" ? "Queued" : "Applied"}{" "}
                          {new Date(app.appliedDate || app.createdAt).toLocaleDateString(locale)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Briefcase className="h-12 w-12 text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-400 mb-2">No activity yet</p>
                  <p className="text-sm text-slate-500">Start applying to jobs to see your activity here</p>
                  <Button
                    variant="outline"
                    className="mt-4 border-slate-700 text-slate-300"
                    onClick={() => setLocation("/profile")}
                  >
                    Complete Profile
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Applications List */}
        <Card className="bg-slate-900/50 border-slate-800/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-cyan-400" />
                  Your Applications
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Track and manage all your job applications
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-slate-800/50 border border-slate-700 mb-4">
                <TabsTrigger value="all" className="data-[state=active]:bg-slate-700">
                  All ({totalApplications})
                </TabsTrigger>
                <TabsTrigger value="active" className="data-[state=active]:bg-blue-900/50">
                  Active ({activeApplications})
                </TabsTrigger>
                <TabsTrigger value="interviewing" className="data-[state=active]:bg-amber-900/50">
                  Interviewing ({interviewInvites})
                </TabsTrigger>
              </TabsList>

              <div className="space-y-3">
                {appsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
                  </div>
                ) : applications && applications.length > 0 ? (
                  <div className="space-y-3">
                    {applications
                      .filter(app => {
                        if (activeTab === "all") return true;
                        if (activeTab === "active") return ["pending", "applied", "viewed", "interview"].includes(app.status || "");
                        if (activeTab === "interviewing") return app.status === "interview";
                        return true;
                      })
                      .slice(0, 10)
                      .map((app: any) => (
                        <Card
                          key={app.id}
                          className="group hover:border-cyan-500/50 transition-all duration-300 cursor-pointer bg-slate-800/30 border-slate-700/50"
                          onClick={() => setSelectedApplication(app)}
                        >
                          <CardContent className="p-4">
                            <div className="flex justify-between items-start gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <h3 className="font-semibold text-white truncate">
                                    {app.job?.title || "Job Title"}
                                  </h3>
                                  <Badge variant="outline" className="text-xs">
                                    <span className="capitalize">{app.status === "pending" ? "queued" : app.status}</span>
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-400 mb-2">
                                  <span className="flex items-center gap-1">
                                    <Building2 className="w-3 h-3" />
                                    {app.job?.company || "Company"}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {app.job?.location || "Remote"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                  <Calendar className="w-3 h-3" />
                                  {app.status === "pending" ? "Queued" : "Applied"}{" "}
                                  {new Date(app.appliedDate || app.createdAt).toLocaleDateString(locale)}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                  </div>
                ) : (
                  <div className="text-center py-16 px-4">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                      <FileText className="w-10 h-10 text-cyan-400" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">No applications yet</h3>
                    <p className="text-slate-400 mb-6 max-w-md mx-auto">
                      Start your job search journey! Complete your profile and let our AI find the perfect matches for you.
                    </p>
                    <Button 
                      className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
                      onClick={() => setLocation("/profile")}
                    >
                      Complete Profile
                    </Button>
                  </div>
                )}
              </div>
            </Tabs>
          </CardContent>
        </Card>

        {/* Application Detail Dialog */}
        <Dialog open={!!selectedApplication} onOpenChange={() => setSelectedApplication(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden bg-slate-900 border-slate-700">
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
                    <Badge variant="outline" className="capitalize">
                      {selectedApplication.status === "pending" ? "queued" : selectedApplication.status}
                    </Badge>
                  </DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[60vh] pr-4">
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="bg-slate-800">
                        <Calendar className="w-3 h-3 mr-1" />
                        {selectedApplication.status === "pending" ? "Queued" : "Applied"}{" "}
                        {new Date(selectedApplication.appliedDate || selectedApplication.createdAt).toLocaleDateString(locale)}
                      </Badge>
                      {(selectedApplication.job?.salaryMin || selectedApplication.job?.salaryMax) && (
                        <Badge variant="secondary" className="bg-slate-800">
                          <DollarSign className="w-3 h-3 mr-1" />
                          {formatJobSalary(selectedApplication.job.salaryMin, selectedApplication.job.salaryMax, selectedApplication.job.salaryCurrency, locale)}
                        </Badge>
                      )}
                    </div>

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
                  </div>
                </ScrollArea>

                <div className="flex justify-end items-center pt-4 border-t border-slate-700">
                  <Button
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
                    size="sm"
                    onClick={() => setSelectedApplication(null)}
                  >
                    Close
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

      </main>
    </div>
  );
}
