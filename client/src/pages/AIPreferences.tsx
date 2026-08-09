import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Loader2, 
  Zap, 
  Globe, 
  Activity, 
  TrendingUp,
  Send,
  Eye,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  ExternalLink
} from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { getAutonomousPolicyControlAction } from "@/lib/autonomousPolicyControl";
import {
  getAutonomousEvidenceGateSummary,
} from "@/lib/autonomousEvidenceGateSummary";
import {
  formatAutonomousRunSummary,
  hasAutonomousRunAttention,
} from "@/lib/autonomousRunSummary";
import { toast } from "sonner";
import AppHeader from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/contexts/LocaleContext";

export default function AIPreferences() {
  const { loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { locale, t } = useLocale();
  
  // AI Settings State
  const [autonomousEnabled, setAutonomousEnabled] = useState(false);
  const [autoApplyEnabled, setAutoApplyEnabled] = useState(false);
  const [maxApplicationsPerDay, setMaxApplicationsPerDay] = useState("10");
  const [minMatchScore, setMinMatchScore] = useState("70");
  const [scanFrequency, setScanFrequency] = useState("daily");
  const [remoteOnly, setRemoteOnly] = useState(true);
  const [requireHumanReview, setRequireHumanReview] = useState(true);
  const [allowUnsupportedATS, setAllowUnsupportedATS] = useState(false);
  const [createFollowUps, setCreateFollowUps] = useState(false);

  const { data: profile, isLoading: profileLoading } = trpc.profile.get.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: autonomousPlan, refetch: refetchPlan } = trpc.automation.plan.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: schedulerStatus, refetch: refetchSchedulerStatus } = trpc.automation.schedulerStatus.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 60000,
  });
  const updatePreferences = trpc.profile.updatePreferences.useMutation({
    onSuccess: () => {
      toast.success(t("aiPreferencesSaved"));
      refetchPlan();
      refetchSchedulerStatus();
    },
    onError: () => toast.error(t("aiPreferencesSaveFailed")),
  });
  const runAgent = trpc.automation.run.useMutation({
    onSuccess: (result: any) => {
      const message = formatAutonomousRunSummary(result);
      if (hasAutonomousRunAttention(result)) {
        toast.warning(message);
      } else {
        toast.success(message);
      }
      refetchPlan();
      refetchSchedulerStatus();
    },
    onError: () => toast.error(t("autonomousRunFailed")),
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [loading, isAuthenticated]);

  useEffect(() => {
    if (!profile?.preferences) return;

    try {
      const saved = JSON.parse(profile.preferences);
      setAutonomousEnabled(saved.autonomousEnabled === true);
      setAutoApplyEnabled(saved.mode === "auto_apply");
      setMaxApplicationsPerDay(String(saved.dailyApplicationLimit || 10));
      setMinMatchScore(String(saved.minMatchScore ?? 70));
      setScanFrequency(saved.scanFrequency || "daily");
      setRemoteOnly(saved.remoteOnly ?? true);
      setRequireHumanReview(saved.requireHumanReview ?? true);
      setAllowUnsupportedATS(saved.allowUnsupportedATS ?? false);
      setCreateFollowUps(saved.createFollowUps ?? false);
    } catch {
      // Ignore legacy or malformed preference data and keep safe defaults.
    }
  }, [profile?.preferences]);

  const handleSaveSettings = () => {
    updatePreferences.mutate({
      autonomousEnabled,
      mode: autoApplyEnabled ? "auto_apply" : "review_first",
      dailyApplicationLimit: Number(maxApplicationsPerDay),
      minMatchScore: Number(minMatchScore),
      remoteOnly,
      requireHumanReview,
      allowUnsupportedATS,
      createFollowUps,
      scanFrequency: scanFrequency as "continuous" | "hourly" | "daily" | "twice-daily",
    });
  };

  const autonomousControl = getAutonomousPolicyControlAction({
    plan: autonomousPlan,
    scheduler: schedulerStatus,
    settings: {
      autonomousEnabled,
      requireHumanReview,
    },
  });
  const evidenceGateSummary = getAutonomousEvidenceGateSummary(autonomousPlan);
  const blockedEvidenceSurfaces = [
    evidenceGateSummary.externalApplicationGated ? t("applicationSubmissionSurface") : null,
    evidenceGateSummary.followUpGated ? t("followUpSendingSurface") : null,
    evidenceGateSummary.replyMonitoringGated ? t("replyMonitoringSurface") : null,
    evidenceGateSummary.documentDiscoveryGated ? t("documentDiscoverySurface") : null,
  ].filter((surface): surface is string => Boolean(surface));
  const localizedEvidenceGateSummaryText = evidenceGateSummary.total === 0
    ? t("noActiveEvidenceGates")
    : blockedEvidenceSurfaces.length > 0
      ? t("evidenceGateSummarySurfaces", { count: evidenceGateSummary.total, surfaces: blockedEvidenceSurfaces.join(", ") })
      : t("evidenceGateSummary", { count: evidenceGateSummary.total });
  const decisionActionLabel = (action: string) => {
    if (action === "blocked") return t("decisionBlocked");
    if (action === "skip") return t("decisionSkipped");
    if (action === "queue_for_review") return t("decisionQueuedReview");
    if (action === "manual_apply") return t("decisionManualTask");
    return t("decisionPrepared");
  };
  const autonomousControlCopy = (() => {
    switch (autonomousControl.status) {
      case "paused": return { label: t("controlPausedLabel"), headline: t("controlPausedHeadline"), cta: t("controlPausedCta") };
      case "blocked": return { label: t("controlBlockedLabel"), headline: t("controlBlockedHeadline"), cta: t("controlBlockedCta") };
      case "monitoring_attention": return { label: t("controlMonitoringLabel"), headline: t("controlMonitoringHeadline"), cta: t("controlMonitoringCta") };
      case "review_ready": return { label: t("controlReviewLabel"), headline: t("controlReviewHeadline"), cta: t("controlReviewCta") };
      case "manual_ready": return { label: t("controlManualLabel"), headline: t("controlManualHeadline"), cta: t("controlManualCta") };
      case "follow_up_ready": return { label: t("controlFollowUpLabel"), headline: t("controlFollowUpHeadline"), cta: t("controlFollowUpCta") };
      case "ready_to_run": return { label: t("controlRunLabel"), headline: t("controlRunHeadline"), cta: t("controlRunCta") };
      case "scheduled": return { label: t("controlScheduledLabel"), headline: t("controlScheduledHeadline"), cta: t("controlScheduledCta") };
      default: return { label: t("controlIdleLabel"), headline: t("controlIdleHeadline"), cta: t("controlIdleCta") };
    }
  })();
  const autonomousControlTone = {
    low: "border-emerald-500/40 text-emerald-300",
    medium: "border-amber-500/40 text-amber-300",
    high: "border-red-500/40 text-red-300",
  }[autonomousControl.risk];

  const handleAutonomousControlAction = () => {
    if (autonomousControl.runsAgent) {
      runAgent.mutate();
      return;
    }
    setLocation(autonomousControl.route);
  };

  if (loading || (isAuthenticated && profileLoading)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <AppHeader currentPage="ai-preferences" />
        <div className="flex items-center justify-center h-[calc(100vh-80px)]">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <AppHeader currentPage="ai-preferences" />
      
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t("aiPreferences")}</h1>
          <p className="text-slate-400">
            {t("aiPreferencesDescription")}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Settings */}
          <div className="lg:col-span-2 space-y-6">
            {/* Application Preparation Settings */}
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Zap className="w-5 h-5 text-cyan-400" />
                  {t("applicationPreparation")}
                </CardTitle>
                <CardDescription>
                  {t("preparationPriorityDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="scheduled-agent" className="text-white">
                      {t("scheduledBackgroundRuns")}
                    </Label>
                    <p className="text-sm text-slate-400">
                      {t("scheduledBackgroundRunsDescription")}
                    </p>
                  </div>
                  <Switch
                    id="scheduled-agent"
                    checked={autonomousEnabled}
                    onCheckedChange={setAutonomousEnabled}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="auto-apply" className="text-white">
                      {t("acceleratedPreparation")}
                    </Label>
                    <p className="text-sm text-slate-400">
                      {t("acceleratedPreparationDescription")}
                    </p>
                  </div>
                  <Switch
                    id="auto-apply"
                    checked={autoApplyEnabled}
                    onCheckedChange={setAutoApplyEnabled}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-apps" className="text-white">
                    {t("maxPreparationsPerDay")}
                  </Label>
                  <Select value={maxApplicationsPerDay} onValueChange={setMaxApplicationsPerDay}>
                    <SelectTrigger id="max-apps" className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {[5, 10, 20, 25].map((count) => (
                        <SelectItem key={count} value={String(count)}>{t("applicationsCount", { count })}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    {t("preparationLimitDescription")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="match-threshold" className="text-white">
                    {t("minimumMatchScore")}
                  </Label>
                  <Select value={minMatchScore} onValueChange={setMinMatchScore}>
                    <SelectTrigger id="match-threshold" className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="60">{t("matchBroad", { score: 60 })}</SelectItem>
                      <SelectItem value="70">{t("matchBalanced", { score: 70 })}</SelectItem>
                      <SelectItem value="80">{t("matchSelective", { score: 80 })}</SelectItem>
                      <SelectItem value="90">{t("matchStrict", { score: 90 })}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="remote-only" className="text-white">
                      {t("remoteJobsOnly")}
                    </Label>
                    <p className="text-sm text-slate-400">
                      {t("remoteJobsOnlyDescription")}
                    </p>
                  </div>
                  <Switch id="remote-only" checked={remoteOnly} onCheckedChange={setRemoteOnly} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="human-review" className="text-white">
                      {t("requireHumanReview")}
                    </Label>
                    <p className="text-sm text-slate-400">
                      {t("requireHumanReviewDescription")}
                    </p>
                  </div>
                  <Switch id="human-review" checked={requireHumanReview} onCheckedChange={setRequireHumanReview} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="manual-tasks" className="text-white">
                      {t("prepareManualTasks")}
                    </Label>
                    <p className="text-sm text-slate-400">
                      {t("prepareManualTasksDescription")}
                    </p>
                  </div>
                  <Switch id="manual-tasks" checked={allowUnsupportedATS} onCheckedChange={setAllowUnsupportedATS} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="follow-ups" className="text-white">
                      {t("queueFollowUps")}
                    </Label>
                    <p className="text-sm text-slate-400">
                      {t("queueFollowUpsDescription")}
                    </p>
                  </div>
                  <Switch id="follow-ups" checked={createFollowUps} onCheckedChange={setCreateFollowUps} />
                </div>
              </CardContent>
            </Card>

            {/* Job Scanning Settings */}
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Globe className="w-5 h-5 text-cyan-400" />
                  {t("jobScanning")}
                </CardTitle>
                <CardDescription>
                  {t("jobScanningDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="scan-freq" className="text-white">
                    {t("scanFrequency")}
                  </Label>
                  <Select value={scanFrequency} onValueChange={setScanFrequency}>
                    <SelectTrigger id="scan-freq" className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="continuous">{t("continuousRealtime")}</SelectItem>
                      <SelectItem value="hourly">{t("everyHour")}</SelectItem>
                      <SelectItem value="daily">{t("onceDaily")}</SelectItem>
                      <SelectItem value="twice-daily">{t("twiceDaily")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* AI Activity Log */}
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-cyan-400" />
                  {t("aiActivityLog")}
                </CardTitle>
                <CardDescription>
                  {t("aiActivityLogDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {autonomousPlan?.decisions.slice(0, 5).map((decision: any) => (
                    <ActivityLogItem
                      key={decision.jobId}
                      icon={decision.action === "blocked"
                        ? <AlertTriangle className="w-4 h-4 text-red-300" />
                        : decision.action === "skip"
                        ? <XCircle className="w-4 h-4 text-slate-400" />
                        : decision.action === "queue_for_review"
                          ? <Eye className="w-4 h-4 text-blue-400" />
                          : <Send className="w-4 h-4 text-cyan-400" />}
                      action={t("decisionActivity", { action: decisionActionLabel(decision.action), title: decision.title, company: decision.company })}
                      time={t("matchPercent", { score: decision.matchScore })}
                      status={decision.action === "blocked" ? "error" : decision.action === "skip" ? "skipped" : decision.action === "queue_for_review" ? "info" : "success"}
                    />
                  ))}
                  {!autonomousPlan?.decisions.length && (
                    <p className="text-sm text-slate-400">{t("noAutonomousDecisions")}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Save Button */}
            <Button
              onClick={handleSaveSettings}
              disabled={updatePreferences.isPending}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
            >
              {updatePreferences.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("saveAiPreferences")}
            </Button>
          </div>

          {/* Right Column - Metrics */}
          <div className="space-y-6">
            <Card data-testid="autonomous-policy-control" className="bg-slate-900/50 border-cyan-500/30">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-cyan-400" />
                  {t("autonomousOperatingControl")}
                </CardTitle>
                <CardDescription>
                  {t("autonomousOperatingControlDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={autonomousControlTone}>
                    {autonomousControlCopy.label}
                  </Badge>
                  <Badge variant="outline" className={autonomousControlTone}>
                    {t(autonomousControl.risk === "high" ? "severityHigh" : autonomousControl.risk === "low" ? "severityLow" : "severityMedium")}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={autonomousControl.approvalGated
                      ? "border-amber-500/40 text-amber-300"
                      : "border-slate-700 text-slate-300"}
                  >
                    {autonomousControl.approvalGated ? t("approvalGated") : t("internal")}
                  </Badge>
                </div>

                <div>
                  <p className="text-sm font-medium text-white">{autonomousControlCopy.headline}</p>
                  <p className="mt-1 text-sm text-slate-400">{autonomousControl.detail}</p>
                </div>

                {autonomousPlan?.policyWarnings?.length ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t("policyWarnings")}
                    </p>
                    <div className="space-y-1">
                      {autonomousPlan.policyWarnings.slice(0, 3).map((warning: string) => (
                        <p key={warning} className="text-xs text-slate-300">{warning}</p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {autonomousPlan?.evidenceGates?.length ? (
                  <div data-testid="ai-preferences-evidence-gates" className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {t("evidenceGates")}
                      </p>
                      <Badge variant="outline" className={evidenceGateSummary.high > 0 ? "border-red-500/40 text-red-300" : "border-amber-500/40 text-amber-300"}>
                        {t("activeCount", { count: evidenceGateSummary.total })}
                      </Badge>
                    </div>
                    <p className="mb-3 text-xs text-slate-300">{localizedEvidenceGateSummaryText}</p>
                    <div className="space-y-2">
                      {autonomousPlan.evidenceGates.slice(0, 4).map((gate: any) => (
                        <div key={gate.id || gate.label} className="rounded-md border border-slate-800 bg-slate-950/40 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-white">{gate.label || t("evidenceGate")}</span>
                            <Badge
                              variant="outline"
                              className={gate.severity === "high"
                                ? "border-red-500/40 text-red-300"
                                : gate.severity === "low"
                                  ? "border-slate-700 text-slate-300"
                                  : "border-amber-500/40 text-amber-300"}
                            >
                              {t(gate.severity === "high" ? "severityHigh" : gate.severity === "low" ? "severityLow" : "severityMedium")}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">{gate.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {autonomousPlan?.nextActions?.length ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("planNextActions")}</p>
                    {autonomousPlan.nextActions.slice(0, 3).map((action: string) => (
                      <div key={action} className="flex items-start gap-2 text-xs text-slate-300">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                        <span>{action}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    [t("eligible"), autonomousPlan?.summary.eligible || 0],
                    [t("review"), autonomousPlan?.summary.queuedForReview || 0],
                    [t("manual"), autonomousPlan?.summary.manualApply || 0],
                    [t("blocked"), autonomousPlan?.summary.blocked || 0],
                    [t("followUpsReady"), autonomousPlan?.summary.followUpsActionReady ?? autonomousPlan?.summary.followUpsDue ?? 0],
                    [t("gates"), evidenceGateSummary.total],
                    [t("stale"), autonomousPlan?.summary.expiredJobsSkipped || 0],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
                    </div>
                  ))}
                </div>

                <Button
                  data-testid="autonomous-policy-primary"
                  className="w-full bg-cyan-600 hover:bg-cyan-500"
                  disabled={runAgent.isPending && autonomousControl.runsAgent}
                  onClick={handleAutonomousControlAction}
                >
                  {runAgent.isPending && autonomousControl.runsAgent ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : autonomousControl.runsAgent ? (
                    <Activity className="mr-2 h-4 w-4" />
                  ) : (
                    <ExternalLink className="mr-2 h-4 w-4" />
                  )}
                  {autonomousControlCopy.cta}
                </Button>
              </CardContent>
            </Card>

            {/* AI Performance Metrics */}
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-cyan-400" />
                  {t("aiPerformance")}
                </CardTitle>
                <CardDescription>
                  {t("aiPerformanceDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <MetricCard
                  label={t("jobsScannedToday")}
                  value={String(autonomousPlan?.summary.scanned || 0)}
                  icon={<Eye className="w-5 h-5 text-blue-400" />}
                  trend={t("eligibleMatches", { count: autonomousPlan?.summary.eligible || 0 })}
                />
                <MetricCard
                  label={t("readyToProcess")}
                  value={String((autonomousPlan?.summary.queuedForApply || 0) + (autonomousPlan?.summary.queuedForReview || 0))}
                  icon={<Send className="w-5 h-5 text-cyan-400" />}
                  trend={t("dailySlotsRemaining", { count: autonomousPlan?.summary.dailyRemaining || 0 })}
                />
                <MetricCard
                  label={t("manualTasks")}
                  value={String(autonomousPlan?.summary.manualApply || 0)}
                  icon={<MessageSquare className="w-5 h-5 text-purple-400" />}
                  trend={t("manualTasksDescription")}
                />
                <MetricCard
                  label={t("followUpsReady")}
                  value={String(autonomousPlan?.summary.followUpsActionReady ?? autonomousPlan?.summary.followUpsDue ?? 0)}
                  icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                  trend={(autonomousPlan?.summary.followUpsBlocked || 0) > 0
                    ? t("candidatesHeld", { count: autonomousPlan?.summary.followUpsBlocked || 0 })
                    : t("basedOnApplicationActivity")}
                />
                <MetricCard
                  label={t("evidenceGates")}
                  value={String(evidenceGateSummary.total)}
                  icon={<AlertTriangle className="w-5 h-5 text-amber-400" />}
                  trend={evidenceGateSummary.total > 0 ? localizedEvidenceGateSummaryText : t("profileEvidenceClear")}
                />
              </CardContent>
            </Card>

            {/* AI Status */}
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white">{t("aiStatus")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{t("preparationMode")}</span>
                  <Badge variant="outline" className={autoApplyEnabled ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-slate-500/20 text-slate-400 border-slate-500/30"}>
                    <div className={`w-2 h-2 rounded-full mr-2 ${autoApplyEnabled ? "bg-emerald-400 animate-pulse" : "bg-slate-400"}`} />
                    {autoApplyEnabled ? t("accelerated") : t("reviewFirst")}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{t("jobScanning")}</span>
                  <Badge
                    variant="outline"
                    className={schedulerStatus?.isStarted && schedulerStatus?.userEnabled
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : "bg-amber-500/20 text-amber-300 border-amber-500/30"}
                  >
                    <div className={`w-2 h-2 rounded-full mr-2 ${schedulerStatus?.isStarted && schedulerStatus?.userEnabled ? "bg-emerald-400 animate-pulse" : "bg-amber-300"}`} />
                    {schedulerStatus?.isStarted && schedulerStatus?.userEnabled ? t("scheduled") : t("manualOnly")}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{t("nextEligibleRun")}</span>
                  <span className="text-white text-sm">
                    <Clock className="w-4 h-4 inline mr-1" />
                    {schedulerStatus?.isStarted && schedulerStatus?.userEnabled && schedulerStatus?.lastStatus === "running"
                      ? t("running")
                      : schedulerStatus?.isStarted && schedulerStatus?.userEnabled && schedulerStatus?.isDue
                        ? t("dueAtNextCheck")
                        : schedulerStatus?.isStarted && schedulerStatus?.userEnabled && schedulerStatus?.nextEligibleAt
                          ? new Date(schedulerStatus.nextEligibleAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
                      : t("notScheduled")}
                  </span>
                </div>
                {schedulerStatus?.lastCycleAt ? (
                  <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
                    <div className="mb-2 flex items-center justify-between">
                      <span>{t("lastAutonomousRun")}</span>
                      <span className="text-slate-300">
                        {new Date(schedulerStatus.lastCycleAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <span>{t(schedulerStatus.lastStatus === "failed" ? "runFailed" : schedulerStatus.lastStatus === "skipped" ? "runSkipped" : schedulerStatus.lastStatus === "running" ? "runInProgress" : "runCompleted")}</span>
                      <span>{t("jobTasksCount", { count: schedulerStatus.jobsQueued || 0 })}</span>
                      <span>{t("followUpDraftsCount", { count: schedulerStatus.followUpDraftsQueued || 0 })}</span>
                      <span>{t("duplicateFollowUpsSkipped", { count: schedulerStatus.duplicateFollowUpsSkipped || 0 })}</span>
                      <span>{t("resumeEvidenceBlocked", { count: schedulerStatus.resumeEvidenceBlockedActions || 0 })}</span>
                      <span>{t("profileReadinessBlocked", { count: schedulerStatus.profileReadinessBlockedActions || 0 })}</span>
                      <span>{t("externalActionsGated", { count: schedulerStatus.evidenceGatedActions || 0 })}</span>
                      <span>{t("emptySourcesBlocked", { count: schedulerStatus.emptySourceActionsSkipped || 0 })}</span>
                      <span>{t("jobsUnderUserControl", { count: schedulerStatus.userDecisionLockedJobs || 0 })}</span>
                      <span>{t("inboxProvidersScanned", { count: schedulerStatus.inboxProvidersScanned || 0 })}</span>
                      <span>{t("inboxCandidatesPending", { count: schedulerStatus.inboxCandidatesDiscovered || 0 })}</span>
                      {schedulerStatus.inboxReauthorizationRequired ? (
                        <span className="text-amber-300">
                          {t("inboxConnectorsNeedAuthorization", { count: schedulerStatus.inboxReauthorizationRequired })}
                        </span>
                      ) : null}
                      {schedulerStatus.inboxMonitoringFailures ? (
                        <span className="text-red-300">
                          {t("inboxMonitorsNeedAttention", { count: schedulerStatus.inboxMonitoringFailures })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {schedulerStatus?.lastError || schedulerStatus?.errorCount ? (
                  <p className="text-xs text-red-300">
                    {schedulerStatus.lastError || t("schedulerErrors", { count: schedulerStatus.errorCount || 0 })}
                  </p>
                ) : null}
                {schedulerStatus?.lastStatus === "skipped" && schedulerStatus.lastOutcomeDetail ? (
                  <p className="text-xs text-amber-300">{schedulerStatus.lastOutcomeDetail}</p>
                ) : null}
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white">{t("quickActions")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start border-slate-700 text-white hover:bg-slate-800"
                  disabled={runAgent.isPending}
                  onClick={() => runAgent.mutate()}
                >
                  <Activity className="w-4 h-4 mr-2" />
                  {t("runAgentNow")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start border-slate-700 text-white hover:bg-slate-800"
                  onClick={() => {
                    setAutonomousEnabled(false);
                    setAutoApplyEnabled(false);
                    setRequireHumanReview(true);
                    toast.info(t("scheduledRunsPaused"));
                  }}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  {t("pauseScheduledRuns")}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityLogItem({ icon, action, time, status }: any) {
  const statusColors: Record<string, string> = {
    success: "border-l-cyan-500",
    info: "border-l-blue-500",
    skipped: "border-l-slate-600",
    error: "border-l-red-500",
  };

  return (
    <div className={`border-l-2 ${statusColors[status]} pl-4 py-2`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1">
          <p className="text-white text-sm">{action}</p>
          <p className="text-slate-500 text-xs mt-1">{time}</p>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon, trend }: any) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-400 text-sm">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold text-white mb-1">{value}</p>
      <p className="text-xs text-slate-500">{trend}</p>
    </div>
  );
}
