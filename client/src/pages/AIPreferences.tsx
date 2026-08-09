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
  getAutonomousEvidenceGateSummaryText,
} from "@/lib/autonomousEvidenceGateSummary";
import {
  formatAutonomousRunSummary,
  hasAutonomousRunAttention,
} from "@/lib/autonomousRunSummary";
import { toast } from "sonner";
import AppHeader from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";

export default function AIPreferences() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  
  // AI Settings State
  const [autonomousEnabled, setAutonomousEnabled] = useState(false);
  const [autoApplyEnabled, setAutoApplyEnabled] = useState(true);
  const [maxApplicationsPerDay, setMaxApplicationsPerDay] = useState("10");
  const [minMatchScore, setMinMatchScore] = useState("70");
  const [scanFrequency, setScanFrequency] = useState("daily");
  const [remoteOnly, setRemoteOnly] = useState(true);
  const [requireHumanReview, setRequireHumanReview] = useState(true);
  const [allowUnsupportedATS, setAllowUnsupportedATS] = useState(false);
  const [createFollowUps, setCreateFollowUps] = useState(false);

  const { data: profile } = trpc.profile.get.useQuery();
  const { data: autonomousPlan, refetch: refetchPlan } = trpc.automation.plan.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: schedulerStatus, refetch: refetchSchedulerStatus } = trpc.automation.schedulerStatus.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 60000,
  });
  const updatePreferences = trpc.profile.updatePreferences.useMutation({
    onSuccess: () => {
      toast.success("AI preferences saved");
      refetchPlan();
      refetchSchedulerStatus();
    },
    onError: () => toast.error("Failed to save AI preferences"),
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
    onError: () => toast.error("Autonomous run failed"),
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
  const evidenceGateSummaryText = getAutonomousEvidenceGateSummaryText(autonomousPlan);
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

  if (loading) {
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
          <h1 className="text-3xl font-bold text-white mb-2">AI Preferences</h1>
          <p className="text-slate-400">
            Configure how Hire.AI finds, evaluates, and prepares jobs for your review
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
                  Application Preparation
                </CardTitle>
                <CardDescription>
                  Configure how Hire.AI prioritizes and prepares matching applications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="scheduled-agent" className="text-white">
                      Scheduled Background Runs
                    </Label>
                    <p className="text-sm text-slate-400">
                      Allow Hire.AI to prepare new job tasks at the selected frequency
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
                      Accelerated Preparation
                    </Label>
                    <p className="text-sm text-slate-400">
                      Prepare high-fit applications automatically for final review
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
                    Max Preparations Per Day
                  </Label>
                  <Select value={maxApplicationsPerDay} onValueChange={setMaxApplicationsPerDay}>
                    <SelectTrigger id="max-apps" className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="5">5 applications</SelectItem>
                      <SelectItem value="10">10 applications</SelectItem>
                      <SelectItem value="20">20 applications</SelectItem>
                      <SelectItem value="25">25 applications</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    Limit daily preparation volume to keep the review queue manageable
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="match-threshold" className="text-white">
                    Minimum Match Score
                  </Label>
                  <Select value={minMatchScore} onValueChange={setMinMatchScore}>
                    <SelectTrigger id="match-threshold" className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="60">60% - Broad</SelectItem>
                      <SelectItem value="70">70% - Balanced</SelectItem>
                      <SelectItem value="80">80% - Selective</SelectItem>
                      <SelectItem value="90">90% - Strict</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="remote-only" className="text-white">
                      Remote Jobs Only
                    </Label>
                    <p className="text-sm text-slate-400">
                      Exclude hybrid and on-site roles from preparation
                    </p>
                  </div>
                  <Switch id="remote-only" checked={remoteOnly} onCheckedChange={setRemoteOnly} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="human-review" className="text-white">
                      Require Human Review
                    </Label>
                    <p className="text-sm text-slate-400">
                      Queue matching jobs for approval before submission
                    </p>
                  </div>
                  <Switch id="human-review" checked={requireHumanReview} onCheckedChange={setRequireHumanReview} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="manual-tasks" className="text-white">
                      Prepare Manual Tasks
                    </Label>
                    <p className="text-sm text-slate-400">
                      Create tasks for unsupported job application systems
                    </p>
                  </div>
                  <Switch id="manual-tasks" checked={allowUnsupportedATS} onCheckedChange={setAllowUnsupportedATS} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="follow-ups" className="text-white">
                      Queue Follow-ups
                    </Label>
                    <p className="text-sm text-slate-400">
                      Draft timely follow-ups for stale applications; every send needs your approval
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
                  Job Scanning
                </CardTitle>
                <CardDescription>
                  Configure how often we scan for new job opportunities
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="scan-freq" className="text-white">
                    Scan Frequency
                  </Label>
                  <Select value={scanFrequency} onValueChange={setScanFrequency}>
                    <SelectTrigger id="scan-freq" className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="continuous">Continuous (Real-time)</SelectItem>
                      <SelectItem value="hourly">Every Hour</SelectItem>
                      <SelectItem value="daily">Once Daily</SelectItem>
                      <SelectItem value="twice-daily">Twice Daily</SelectItem>
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
                  AI Activity Log
                </CardTitle>
                <CardDescription>
                  Recent actions taken by Hire.AI on your behalf
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
                      action={`${decision.action.replace(/_/g, " ")}: ${decision.title} at ${decision.company}`}
                      time={`${decision.matchScore}% match`}
                      status={decision.action === "blocked" ? "error" : decision.action === "skip" ? "skipped" : decision.action === "queue_for_review" ? "info" : "success"}
                    />
                  ))}
                  {!autonomousPlan?.decisions.length && (
                    <p className="text-sm text-slate-400">No autonomous decisions available yet.</p>
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
              Save AI Preferences
            </Button>
          </div>

          {/* Right Column - Metrics */}
          <div className="space-y-6">
            <Card data-testid="autonomous-policy-control" className="bg-slate-900/50 border-cyan-500/30">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-cyan-400" />
                  Autonomous Operating Control
                </CardTitle>
                <CardDescription>
                  One safe next action from the current plan, policy, and scheduler state
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={autonomousControlTone}>
                    {autonomousControl.label}
                  </Badge>
                  <Badge variant="outline" className={autonomousControlTone}>
                    {autonomousControl.risk}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={autonomousControl.approvalGated
                      ? "border-amber-500/40 text-amber-300"
                      : "border-slate-700 text-slate-300"}
                  >
                    {autonomousControl.approvalGated ? "Approval-gated" : "Internal"}
                  </Badge>
                </div>

                <div>
                  <p className="text-sm font-medium text-white">{autonomousControl.headline}</p>
                  <p className="mt-1 text-sm text-slate-400">{autonomousControl.detail}</p>
                </div>

                {autonomousPlan?.policyWarnings?.length ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Policy warnings
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
                        Evidence gates
                      </p>
                      <Badge variant="outline" className={evidenceGateSummary.high > 0 ? "border-red-500/40 text-red-300" : "border-amber-500/40 text-amber-300"}>
                        {evidenceGateSummary.total} active
                      </Badge>
                    </div>
                    <p className="mb-3 text-xs text-slate-300">{evidenceGateSummaryText}</p>
                    <div className="space-y-2">
                      {autonomousPlan.evidenceGates.slice(0, 4).map((gate: any) => (
                        <div key={gate.id || gate.label} className="rounded-md border border-slate-800 bg-slate-950/40 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-white">{gate.label || "Evidence gate"}</span>
                            <Badge
                              variant="outline"
                              className={gate.severity === "high"
                                ? "border-red-500/40 text-red-300"
                                : gate.severity === "low"
                                  ? "border-slate-700 text-slate-300"
                                  : "border-amber-500/40 text-amber-300"}
                            >
                              {gate.severity || "medium"}
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
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Plan next actions</p>
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
                    ["Eligible", autonomousPlan?.summary.eligible || 0],
                    ["Review", autonomousPlan?.summary.queuedForReview || 0],
                    ["Manual", autonomousPlan?.summary.manualApply || 0],
                    ["Blocked", autonomousPlan?.summary.blocked || 0],
                    ["Follow-ups ready", autonomousPlan?.summary.followUpsActionReady ?? autonomousPlan?.summary.followUpsDue ?? 0],
                    ["Gates", evidenceGateSummary.total],
                    ["Stale", autonomousPlan?.summary.expiredJobsSkipped || 0],
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
                  {autonomousControl.cta}
                </Button>
              </CardContent>
            </Card>

            {/* AI Performance Metrics */}
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-cyan-400" />
                  AI Performance
                </CardTitle>
                <CardDescription>
                  Track how effectively the AI is working for you
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <MetricCard
                  label="Jobs Scanned Today"
                  value={String(autonomousPlan?.summary.scanned || 0)}
                  icon={<Eye className="w-5 h-5 text-blue-400" />}
                  trend={`${autonomousPlan?.summary.eligible || 0} eligible matches`}
                />
                <MetricCard
                  label="Ready to Process"
                  value={String((autonomousPlan?.summary.queuedForApply || 0) + (autonomousPlan?.summary.queuedForReview || 0))}
                  icon={<Send className="w-5 h-5 text-cyan-400" />}
                  trend={`${autonomousPlan?.summary.dailyRemaining || 0} daily slots remaining`}
                />
                <MetricCard
                  label="Manual Tasks"
                  value={String(autonomousPlan?.summary.manualApply || 0)}
                  icon={<MessageSquare className="w-5 h-5 text-purple-400" />}
                  trend="Unsupported ATS or platform tasks"
                />
                <MetricCard
                  label="Follow-ups Ready"
                  value={String(autonomousPlan?.summary.followUpsActionReady ?? autonomousPlan?.summary.followUpsDue ?? 0)}
                  icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                  trend={(autonomousPlan?.summary.followUpsBlocked || 0) > 0
                    ? `${autonomousPlan?.summary.followUpsBlocked} candidate${autonomousPlan?.summary.followUpsBlocked === 1 ? "" : "s"} held by existing workflow`
                    : "Based on application activity"}
                />
                <MetricCard
                  label="Evidence Gates"
                  value={String(evidenceGateSummary.total)}
                  icon={<AlertTriangle className="w-5 h-5 text-amber-400" />}
                  trend={evidenceGateSummary.total > 0 ? evidenceGateSummaryText : "Profile and connector evidence clear"}
                />
              </CardContent>
            </Card>

            {/* AI Status */}
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white">AI Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Preparation Mode</span>
                  <Badge variant="outline" className={autoApplyEnabled ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-slate-500/20 text-slate-400 border-slate-500/30"}>
                    <div className={`w-2 h-2 rounded-full mr-2 ${autoApplyEnabled ? "bg-emerald-400 animate-pulse" : "bg-slate-400"}`} />
                    {autoApplyEnabled ? "Accelerated" : "Review first"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Job Scanning</span>
                  <Badge
                    variant="outline"
                    className={schedulerStatus?.isStarted && schedulerStatus?.userEnabled
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : "bg-amber-500/20 text-amber-300 border-amber-500/30"}
                  >
                    <div className={`w-2 h-2 rounded-full mr-2 ${schedulerStatus?.isStarted && schedulerStatus?.userEnabled ? "bg-emerald-400 animate-pulse" : "bg-amber-300"}`} />
                    {schedulerStatus?.isStarted && schedulerStatus?.userEnabled ? "Scheduled" : "Manual only"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Next Eligible Run</span>
                  <span className="text-white text-sm">
                    <Clock className="w-4 h-4 inline mr-1" />
                    {schedulerStatus?.isStarted && schedulerStatus?.userEnabled && schedulerStatus?.lastStatus === "running"
                      ? "Running"
                      : schedulerStatus?.isStarted && schedulerStatus?.userEnabled && schedulerStatus?.isDue
                        ? "Due at next check"
                        : schedulerStatus?.isStarted && schedulerStatus?.userEnabled && schedulerStatus?.nextEligibleAt
                          ? new Date(schedulerStatus.nextEligibleAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : "Not scheduled"}
                  </span>
                </div>
                {schedulerStatus?.lastCycleAt ? (
                  <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
                    <div className="mb-2 flex items-center justify-between">
                      <span>Last autonomous run</span>
                      <span className="text-slate-300">
                        {new Date(schedulerStatus.lastCycleAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <span>{schedulerStatus.lastStatus === "failed" ? "Run failed" : schedulerStatus.lastStatus === "skipped" ? "Run skipped" : schedulerStatus.lastStatus === "running" ? "Run in progress" : "Run completed"}</span>
                      <span>{schedulerStatus.jobsQueued || 0} job task{schedulerStatus.jobsQueued === 1 ? "" : "s"}</span>
                      <span>{schedulerStatus.followUpDraftsQueued || 0} follow-up draft{schedulerStatus.followUpDraftsQueued === 1 ? "" : "s"}</span>
                      <span>{schedulerStatus.duplicateFollowUpsSkipped || 0} duplicate follow-up{schedulerStatus.duplicateFollowUpsSkipped === 1 ? "" : "s"} skipped</span>
                      <span>{schedulerStatus.resumeEvidenceBlockedActions || 0} application preparation{schedulerStatus.resumeEvidenceBlockedActions === 1 ? "" : "s"} blocked by resume evidence</span>
                      <span>{schedulerStatus.profileReadinessBlockedActions || 0} application preparation{schedulerStatus.profileReadinessBlockedActions === 1 ? "" : "s"} blocked by profile readiness</span>
                      <span>{schedulerStatus.evidenceGatedActions || 0} external action{schedulerStatus.evidenceGatedActions === 1 ? "" : "s"} gated</span>
                      <span>{schedulerStatus.emptySourceActionsSkipped || 0} job preparation{schedulerStatus.emptySourceActionsSkipped === 1 ? "" : "s"} blocked by empty source scans</span>
                      <span>{schedulerStatus.userDecisionLockedJobs || 0} job{schedulerStatus.userDecisionLockedJobs === 1 ? "" : "s"} retained under user control</span>
                      <span>{schedulerStatus.inboxProvidersScanned || 0} inbox provider{schedulerStatus.inboxProvidersScanned === 1 ? "" : "s"} scanned</span>
                      <span>{schedulerStatus.inboxCandidatesDiscovered || 0} inbox response candidate{schedulerStatus.inboxCandidatesDiscovered === 1 ? "" : "s"} pending review</span>
                      {schedulerStatus.inboxReauthorizationRequired ? (
                        <span className="text-amber-300">
                          {schedulerStatus.inboxReauthorizationRequired} inbox connector{schedulerStatus.inboxReauthorizationRequired === 1 ? " needs" : "s need"} reauthorization
                        </span>
                      ) : null}
                      {schedulerStatus.inboxMonitoringFailures ? (
                        <span className="text-red-300">
                          {schedulerStatus.inboxMonitoringFailures} inbox monitor{schedulerStatus.inboxMonitoringFailures === 1 ? "" : "s"} needs attention
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {schedulerStatus?.lastError || schedulerStatus?.errorCount ? (
                  <p className="text-xs text-red-300">
                    {schedulerStatus.lastError || `Latest scheduler cycle reported ${schedulerStatus.errorCount} error${schedulerStatus.errorCount === 1 ? "" : "s"}.`}
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
                <CardTitle className="text-white">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start border-slate-700 text-white hover:bg-slate-800"
                  disabled={runAgent.isPending}
                  onClick={() => runAgent.mutate()}
                >
                  <Activity className="w-4 h-4 mr-2" />
                  Run Agent Now
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start border-slate-700 text-white hover:bg-slate-800"
                  onClick={() => {
                    setAutonomousEnabled(false);
                    setAutoApplyEnabled(false);
                    setRequireHumanReview(true);
                    toast.info("Scheduled runs disabled and review-only mode selected. Save to persist.");
                  }}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Pause Scheduled Runs
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
