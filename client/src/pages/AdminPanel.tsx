import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getAdminOperatingControlAction } from "@/lib/adminOperatingControl";
import { formatAdminOperatingCopy, getAdminOperatingActionCopy, getAdminOperatingCopy, getAdminOperatingSummaryCopy, type AdminOperatingCopyKey } from "@/lib/adminOperatingCopy";
import { getAdminOperatingSummary } from "@/lib/adminOperatingSummary";
import { formatAdminFinancialCopy, getAdminFinancialCopy, getAdminFinancialStatusCopy, type AdminFinancialCopyKey } from "@/lib/adminFinancialCopy";
import { getAdminReviewEvidenceSummary } from "@/lib/adminReviewEvidence";
import { openExternalUrl } from "@/lib/externalUrl";
import {
  buildPrivacyCleanupConfirmation,
  buildPrivacyDatabaseConfirmation,
  canExecutePrivacyCleanup,
  canFinalizePrivacyErasure,
} from "@/lib/privacyErasureControl";
import {
  getScraperSourceHealthSummary,
  getScraperSourceOutcomeCounts,
  type ScraperSourceOutcome,
} from "@/lib/scraperSourceHealth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle,
  DollarSign,
  FileText,
  Gavel,
  RefreshCw,
  Pause,
  Play,
  Shield,
  Users,
  XCircle,
} from "lucide-react";

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const variants: Record<string, string> = {
    active: "bg-green-500/20 text-green-400 border-green-500/30",
    pending_verification: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    suspended: "bg-red-500/20 text-red-400 border-red-500/30",
    disputed: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    ended: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    paused: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    approved: "bg-green-500/20 text-green-400 border-green-500/30",
    rejected: "bg-red-500/20 text-red-400 border-red-500/30",
    paid: "bg-green-500/20 text-green-400 border-green-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
    open: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    resolved: "bg-green-500/20 text-green-400 border-green-500/30",
    dismissed: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    low: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    application_review: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    submission_evidence: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    employer_response: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    offer_attribution: "bg-green-500/20 text-green-400 border-green-500/30",
    verification_overdue: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    payment_failed: "bg-red-500/20 text-red-400 border-red-500/30",
    legal_escalation: "bg-red-500/20 text-red-400 border-red-500/30",
    employment_ended: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    privacy_deletion: "bg-red-500/20 text-red-300 border-red-500/30",
    apply: "bg-green-500/20 text-green-400 border-green-500/30",
    save: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    ignore: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    review: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    manual_apply: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  };
  const cls = variants[status] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

function ScraperRunOutcomeBadge({ outcome, label }: { outcome: "success" | "partial" | "failed" | null | undefined; label: string | null }) {
  if (!outcome) return null;

  const details = {
    success: { tone: "border-emerald-500/30 text-emerald-300" },
    partial: { tone: "border-amber-500/30 text-amber-300" },
    failed: { tone: "border-red-500/30 text-red-300" },
  }[outcome];
  return <Badge variant="outline" className={details.tone}>{label}</Badge>;
}

const RUN_OUTCOME_COPY_KEYS = {
  success: "lastCycleClean",
  partial: "lastCyclePartial",
  failed: "lastCycleFailed",
} as const satisfies Record<"success" | "partial" | "failed", AdminOperatingCopyKey>;

const SOURCE_OUTCOME_COPY_KEYS = {
  success: "outcomeSuccess",
  empty: "outcomeEmpty",
  partial: "outcomePartial",
  failed: "outcomeFailed",
  awaiting: "outcomeAwaiting",
} as const satisfies Record<ScraperSourceOutcome, AdminOperatingCopyKey>;

const ADAPTER_COPY_KEYS = {
  dedicated: { label: "dedicatedAdapterLabel", detail: "dedicatedAdapterDetail" },
  generic_rss: { label: "rssAdapterLabel", detail: "rssAdapterDetail" },
  generic_html: { label: "htmlAdapterLabel", detail: "htmlAdapterDetail" },
} as const satisfies Record<string, { label: AdminOperatingCopyKey; detail: AdminOperatingCopyKey }>;

export default function AdminPanel() {
  const { user, loading } = useAuth();
  const { locale, t } = useLocale();
  const ac = (key: AdminOperatingCopyKey) => getAdminOperatingCopy(locale, key);
  const af = (key: AdminOperatingCopyKey, values: Record<string, string | number>) => formatAdminOperatingCopy(locale, key, values);
  const fc = (key: AdminFinancialCopyKey) => getAdminFinancialCopy(locale, key);
  const ff = (key: AdminFinancialCopyKey, values: Record<string, string | number>) => formatAdminFinancialCopy(locale, key, values);
  const statusLabel = (status: string) => getAdminFinancialStatusCopy(locale, status);
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-US", { style: "currency", currency: "USD" }),
    [locale],
  );
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-US", { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-US", { year: "numeric", month: "short", day: "numeric" }),
    [locale],
  );
  const formatDate = (date: Date | string | null | undefined) => date ? dateFormatter.format(new Date(date)) : "-";
  const formatCurrency = (cents: number, currency = "USD") => new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
  const isAdmin = user?.role === "admin";
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");

  // Dialogs
  const [noteDialog, setNoteDialog] = useState<{ open: boolean; feeId: number | null }>({ open: false, feeId: null });
  const [noteText, setNoteText] = useState("");
  const [escalateDialog, setEscalateDialog] = useState<{ open: boolean; feeId: number | null; userName: string }>({ open: false, feeId: null, userName: "" });
  const [escalateReason, setEscalateReason] = useState("");
  const [statusDialog, setStatusDialog] = useState<{ open: boolean; feeId: number | null; currentStatus: string }>({ open: false, feeId: null, currentStatus: "" });
  const [newStatus, setNewStatus] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [reviewDialog, setReviewDialog] = useState<{ open: boolean; itemId: number | null; status: "resolved" | "dismissed" }>({ open: false, itemId: null, status: "resolved" });
  const [reviewResolution, setReviewResolution] = useState("");
  const [erasureCleanupConfirmation, setErasureCleanupConfirmation] = useState("");
  const [databaseErasureConfirmation, setDatabaseErasureConfirmation] = useState("");
  const [manualCleanupEvidence, setManualCleanupEvidence] = useState<Record<number, string>>({});
  const [evidenceDialog, setEvidenceDialog] = useState<{ open: boolean; itemId: number | null }>({ open: false, itemId: null });
  const [scrapingIntervalMinutes, setScrapingIntervalMinutes] = useState("60");
  const [scrapingMaxJobsPerRun, setScrapingMaxJobsPerRun] = useState("100");
  const [restrictScrapingSources, setRestrictScrapingSources] = useState(false);
  const [selectedScrapingSources, setSelectedScrapingSources] = useState<string[]>([]);
  const scrapingScheduleInitialized = useRef(false);

  // Data queries
  const { data: stats, refetch: refetchStats } = trpc.admin.getStats.useQuery(undefined, { enabled: isAdmin });
  const { data: operatingCounts, refetch: refetchOperatingCounts } = trpc.admin.getOperatingCounts.useQuery(undefined, { enabled: isAdmin });
  const { data: operationalFailures, refetch: refetchOperationalFailures } = trpc.admin.getOperationalFailures.useQuery(
    { limit: 8 },
    { enabled: isAdmin, refetchInterval: 30_000 }
  );
  const { data: fees, refetch: refetchFees } = trpc.admin.listFees.useQuery(
    { status: "all", limit: 100, offset: 0 },
    { enabled: isAdmin }
  );
  const { data: overdue, refetch: refetchOverdue } = trpc.admin.listOverdueVerifications.useQuery(undefined, { enabled: isAdmin });
  const { data: pendingVerifications, refetch: refetchVerifications } = trpc.admin.listPendingVerifications.useQuery(undefined, { enabled: isAdmin });
  const { data: reviewQueue, refetch: refetchReviewQueue } = trpc.admin.getReviewQueue.useQuery(
    { status: "open", limit: 100 },
    { enabled: isAdmin }
  );
  const reviewDialogItem = reviewQueue?.find((item) => item.id === reviewDialog.itemId);
  const isPrivacyDeletionDialog = reviewDialogItem?.category === "privacy_deletion";
  const {
    data: reviewEvidence,
    isLoading: reviewEvidenceLoading,
    error: reviewEvidenceError,
  } = trpc.admin.getReviewEvidence.useQuery(
    { reviewItemId: evidenceDialog.itemId ?? 0 },
    { enabled: isAdmin && evidenceDialog.open && evidenceDialog.itemId !== null }
  );
  const {
    data: privacyErasurePreview,
    isLoading: privacyErasurePreviewLoading,
    error: privacyErasurePreviewError,
  } = trpc.admin.previewPrivacyErasure.useQuery(
    { reviewItemId: evidenceDialog.itemId ?? 0 },
    {
      enabled: isAdmin
        && evidenceDialog.open
        && evidenceDialog.itemId !== null
        && reviewEvidence?.reviewItem.category === "privacy_deletion",
    }
  );
  const {
    data: privacyErasurePlan,
    refetch: refetchPrivacyErasurePlan,
  } = trpc.admin.getPrivacyErasurePlan.useQuery(
    { reviewItemId: evidenceDialog.itemId ?? 0 },
    {
      enabled: isAdmin
        && evidenceDialog.open
        && evidenceDialog.itemId !== null
        && reviewEvidence?.reviewItem.category === "privacy_deletion",
    }
  );
  const { data: payments } = trpc.admin.listPayments.useQuery(
    { limit: 50, offset: 0 },
    { enabled: isAdmin }
  );
  const {
    data: scrapingStatus,
    refetch: refetchScrapingStatus,
  } = trpc.scraping.status.useQuery(undefined, {
    enabled: isAdmin,
    refetchInterval: 30_000,
  });
  const scraperSourceOutcomes = getScraperSourceOutcomeCounts(scrapingStatus?.platforms);

  useEffect(() => {
    if (!scrapingStatus?.scheduler || scrapingScheduleInitialized.current) return;
    setScrapingIntervalMinutes(String(scrapingStatus.scheduler.intervalMinutes));
    setScrapingMaxJobsPerRun(String(scrapingStatus.scheduler.maxJobsPerRun));
    setRestrictScrapingSources(Boolean(scrapingStatus.scheduler.enabledPlatforms?.length));
    setSelectedScrapingSources(
      scrapingStatus.scheduler.enabledPlatforms?.slice()
        ?? scrapingStatus.platforms
          .filter((platform) => platform.readiness === "ready")
          .map((platform) => platform.name)
    );
    scrapingScheduleInitialized.current = true;
  }, [scrapingStatus?.scheduler]);

  // Mutations
  const updateStatus = trpc.admin.updateFeeStatus.useMutation({
    onSuccess: () => {
      toast.success(fc("feeStatusUpdated"));
      refetchFees();
      refetchStats();
      refetchOperatingCounts();
      setStatusDialog({ open: false, feeId: null, currentStatus: "" });
      setNewStatus("");
      setStatusNote("");
    },
    onError: (err) => toast.error(err.message),
  });

  const reviewVerification = trpc.admin.reviewVerification.useMutation({
    onSuccess: (data) => {
      toast.success(fc(data.approved ? "verificationApproved" : "verificationRejected"));
      refetchVerifications();
      refetchOverdue();
      refetchStats();
      refetchReviewQueue();
      refetchOperatingCounts();
    },
    onError: (err) => toast.error(err.message),
  });

  const flagEscalation = trpc.admin.flagLegalEscalation.useMutation({
    onSuccess: () => {
      toast.success(fc("legalEscalationRecorded"));
      refetchFees();
      refetchStats();
      refetchOperatingCounts();
      setEscalateDialog({ open: false, feeId: null, userName: "" });
      setEscalateReason("");
    },
    onError: (err) => toast.error(err.message),
  });

  const addNote = trpc.admin.addNote.useMutation({
    onSuccess: () => {
      toast.success(fc("noteAdded"));
      refetchFees();
      setNoteDialog({ open: false, feeId: null });
      setNoteText("");
    },
    onError: (err) => toast.error(err.message),
  });

  const reinstateUser = trpc.admin.reinstateUser.useMutation({
    onSuccess: () => {
      toast.success(fc("userReinstated"));
      refetchFees();
      refetchStats();
      refetchOperatingCounts();
    },
    onError: (err) => toast.error(err.message),
  });

  const verificationDocumentDownload = trpc.admin.getVerificationDocumentDownloadUrl.useMutation({
    onSuccess: (data) => {
      if (!openExternalUrl(data.url)) toast.error(fc("invalidDownloadUrl"));
    },
    onError: (err) => toast.error(err.message || fc("downloadFailed")),
  });
  const resolveReviewItem = trpc.admin.resolveReviewItem.useMutation({
    onSuccess: async (result) => {
      toast.success(result.erasurePlan
        ? `Review recorded and erasure plan #${result.erasurePlan.run.id} created`
        : "Review item updated");
      refetchReviewQueue();
      refetchStats();
      refetchOperatingCounts();
      setReviewDialog({ open: false, itemId: null, status: "resolved" });
      setReviewResolution("");
      await refetchPrivacyErasurePlan();
    },
    onError: (err) => toast.error(err.message),
  });
  const executePrivacyErasureCleanup = trpc.admin.executePrivacyErasureCleanup.useMutation({
    onSuccess: async (result) => {
      toast.success(`External cleanup finished with status ${result.status}`);
      setErasureCleanupConfirmation("");
      await refetchPrivacyErasurePlan();
    },
    onError: (err) => toast.error(err.message),
  });
  const confirmManualPrivacyCleanup = trpc.admin.confirmManualPrivacyCleanup.useMutation({
    onSuccess: async (_result, variables) => {
      toast.success("Manual provider cleanup evidence recorded");
      setManualCleanupEvidence((current) => ({ ...current, [variables.taskId]: "" }));
      await refetchPrivacyErasurePlan();
    },
    onError: (err) => toast.error(err.message),
  });
  const finalizePrivacyErasure = trpc.admin.finalizePrivacyErasure.useMutation({
    onSuccess: async () => {
      toast.success("Database erasure completed transactionally");
      setDatabaseErasureConfirmation("");
      await refetchPrivacyErasurePlan();
    },
    onError: (err) => toast.error(err.message),
  });
  const startScrapingScheduler = trpc.scraping.startScheduler.useMutation({
    onSuccess: () => {
      toast.success(ac("schedulerStarted"));
      refetchScrapingStatus();
    },
    onError: (err) => toast.error(err.message),
  });
  const stopScrapingScheduler = trpc.scraping.stopScheduler.useMutation({
    onSuccess: () => {
      toast.success(ac("schedulerStopped"));
      refetchScrapingStatus();
    },
    onError: (err) => toast.error(err.message),
  });
  const runScrapingNow = trpc.scraping.runNow.useMutation({
    onSuccess: (result) => {
      if (result.outcome === "failed") toast.error(ac("discoveryRunFailed"));
      else if (result.outcome === "skipped") toast.info(ac("discoveryRunSkipped"));
      else toast.success(ac(result.outcome === "joined" ? "discoveryRunJoined" : "discoveryRunStarted"));
      refetchScrapingStatus();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleStartScrapingScheduler = () => {
    const intervalMinutes = Number(scrapingIntervalMinutes);
    const maxJobsPerRun = Number(scrapingMaxJobsPerRun);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1440) {
      toast.error(ac("invalidInterval"));
      return;
    }
    if (!Number.isInteger(maxJobsPerRun) || maxJobsPerRun < 10 || maxJobsPerRun > 1000) {
      toast.error(ac("invalidJobLimit"));
      return;
    }
    if (restrictScrapingSources && selectedScrapingSources.length === 0) {
      toast.error(ac("selectSource"));
      return;
    }
    startScrapingScheduler.mutate({
      intervalMinutes,
      maxJobsPerRun,
      enabledPlatforms: restrictScrapingSources ? selectedScrapingSources : undefined,
    });
  };

  // Auth guard
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">{t("loading")}</div>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Card className="bg-slate-900 border-slate-800 p-8 text-center max-w-md">
          <Shield className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">{ac("accessDenied")}</h2>
          <p className="text-slate-400 mb-4">{ac("accessDeniedDetail")}</p>
          <Button onClick={() => setLocation("/dashboard")} variant="outline">
            {t("backToDashboard")}
          </Button>
        </Card>
      </div>
    );
  }

  const statCards = [
    { id: "active-fees", label: ac("activeFees"), value: stats?.activeFees ?? 0, icon: Activity, color: "text-green-400" },
    { id: "pending-verification", label: ac("pendingVerification"), value: stats?.pendingFees ?? 0, icon: FileText, color: "text-yellow-400" },
    { id: "overdue-verifications", label: ac("overdueVerifications"), value: stats?.overdueVerifications ?? 0, icon: AlertTriangle, color: "text-orange-400" },
    { id: "review-items", label: ac("reviewItems"), value: operatingCounts?.reviewTotal ?? reviewQueue?.length ?? 0, icon: Shield, color: "text-cyan-400" },
    { id: "suspended", label: ac("suspended"), value: stats?.suspendedFees ?? 0, icon: Ban, color: "text-red-400" },
    { id: "paused", label: ac("paused"), value: stats?.pausedFees ?? 0, icon: Pause, color: "text-slate-400" },
    { id: "disputed", label: ac("disputed"), value: stats?.disputedFees ?? 0, icon: AlertTriangle, color: "text-orange-400" },
    { id: "monthly-revenue", label: ac("monthlyRevenue"), value: currencyFormatter.format(stats?.monthlyRevenueUsd ?? 0), icon: DollarSign, color: "text-cyan-400" },
    { id: "total-revenue", label: ac("totalRevenue"), value: currencyFormatter.format(stats?.totalRevenueUsd ?? 0), icon: DollarSign, color: "text-blue-400" },
    { id: "total-users", label: ac("totalUsers"), value: stats?.totalUsers ?? 0, icon: Users, color: "text-purple-400" },
  ];
  const operatingSummary = getAdminOperatingSummary({
    stats,
    overdue,
    pendingVerifications,
    reviewQueue,
    payments,
    aggregates: operatingCounts ? {
      reviewTotal: operatingCounts.reviewTotal,
      criticalItems: operatingCounts.criticalReviews + operatingCounts.graceExpiredVerifications + operatingCounts.failedPayments,
      highRiskItems: operatingCounts.highRiskReviews + operatingCounts.overdueVerifications,
      overdueVerifications: operatingCounts.overdueVerifications,
      graceExpiredVerifications: operatingCounts.graceExpiredVerifications,
      pendingVerifications: operatingCounts.pendingVerifications,
      failedPayments: operatingCounts.failedPayments,
      legalEscalations: operatingCounts.legalEscalations,
      offerAttributionReviews: operatingCounts.offerAttributionReviews,
      employmentEndedReviews: operatingCounts.employmentEndedReviews,
    } : undefined,
  });
  const operatingSummaryClass = {
    clear: "border-emerald-500/30 text-emerald-300",
    watch: "border-blue-500/30 text-blue-300",
    attention: "border-amber-500/30 text-amber-300",
    critical: "border-red-500/30 text-red-300",
  }[operatingSummary.status];
  const operatingAction = getAdminOperatingControlAction(operatingSummary);
  const operatingSummaryCopy = getAdminOperatingSummaryCopy(locale, operatingSummary);
  const operatingActionCopy = getAdminOperatingActionCopy(locale, operatingAction);
  const operatingActionClass = {
    low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    medium: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    high: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    critical: "border-red-500/30 bg-red-500/10 text-red-300",
  }[operatingAction.risk];
  const freshEmptySources = scrapingStatus?.coverage.freshZeroListingSources ?? scraperSourceOutcomes.freshEmpty;
  const freshFailedSources = scrapingStatus?.coverage.freshFailedLatestSources ?? scraperSourceOutcomes.freshFailed;
  const freshPartialSources = scrapingStatus?.coverage.freshPartialLatestSources ?? scraperSourceOutcomes.freshPartial;
  const discoveryMetrics = [
    ["ready-sources", ac("readySources"), scrapingStatus?.coverage.readySources ?? 0],
    ["fresh-sources", ac("freshSources"), scrapingStatus?.coverage.freshReadySources ?? 0],
    ["dedicated-adapters", ac("dedicatedAdapters"), scrapingStatus?.coverage.configuredDedicatedAdapterSources ?? 0],
    ["generic-adapters", ac("genericAdapters"), (scrapingStatus?.coverage.configuredGenericRssAdapterSources ?? 0) + (scrapingStatus?.coverage.configuredGenericHtmlAdapterSources ?? 0)],
    ["fresh-empty", ac("freshEmptySources"), freshEmptySources],
    ["fresh-failed", ac("freshFailedSources"), freshFailedSources],
    ["fresh-partial", ac("freshPartialSources"), freshPartialSources],
    ["historical-outcomes", ac("historicalOutcomes"), scraperSourceOutcomes.staleOutcomes],
    ["registry-sources", ac("registrySources"), scrapingStatus?.coverage.registeredSources ?? 0],
    ["completed-cycles", ac("completedCycles"), scrapingStatus?.scheduler.totalRunsCompleted ?? 0],
    ["clean-cycles", ac("cleanCycles"), scrapingStatus?.scheduler.totalSuccessfulRuns ?? 0],
    ["partial-cycles", ac("partialCycles"), scrapingStatus?.scheduler.totalPartialRuns ?? 0],
    ["failed-cycles", ac("failedCycles"), scrapingStatus?.scheduler.totalFailedRuns ?? 0],
    ["jobs-saved", ac("jobsSaved"), scrapingStatus?.scheduler.totalJobsScraped ?? 0],
    ["alert-matches", ac("alertMatches"), scrapingStatus?.scheduler.lastJobAlertsProcessed ?? 0],
    ["concurrency-cap", ac("concurrentSourceCap"), scrapingStatus?.executionPolicy.maxConcurrentScrapes ?? 0],
    ["source-timeout", ac("sourceTimeout"), `${Math.round((scrapingStatus?.executionPolicy.scrapeTimeoutMs ?? 0) / 1000)}s`],
    ["attention-signals", ac("attentionSignals"), (scrapingStatus?.coverage.freshSourceIssues ?? scraperSourceOutcomes.freshIssues) + (scrapingStatus?.scheduler.errors.length ?? 0) + (scrapingStatus?.coverage.unavailableConfiguredSources ?? 0)],
  ] as const;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800/50 bg-slate-950/80 sticky top-0 z-50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-cyan-400" />
            <div>
              <h1 className="text-lg font-bold text-white">{t("adminPanel")}</h1>
              <p className="text-xs text-slate-500">{ac("operations")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                refetchStats();
                refetchFees();
                refetchOverdue();
                refetchVerifications();
                refetchReviewQueue();
                refetchOperatingCounts();
                refetchScrapingStatus();
                refetchOperationalFailures();
              }}
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              {ac("refresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/dashboard")}
              className="border-slate-700 text-slate-300"
            >
              {t("dashboard")}
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <Card className="mb-6 bg-slate-900/70 border-slate-800/50">
          <CardContent className="p-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Shield className="h-5 w-5 text-cyan-400" />
                  <h2 className="text-base font-semibold text-white">{ac("operatingQueue")}</h2>
                  <Badge variant="outline" className={operatingSummaryClass}>
                    {operatingSummaryCopy.label}
                  </Badge>
                </div>
                <p className="text-sm text-slate-400">{operatingSummaryCopy.nextAction}</p>
                <div className="mt-3 text-xs text-slate-500">
                  {ac("approvalBoundary")}
                </div>
                <div
                  data-testid="admin-operating-control"
                  className="mt-4 rounded-md border border-slate-800 bg-slate-950/50 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={operatingActionClass}>
                      {operatingActionCopy.label}
                    </Badge>
                    {operatingAction.approvalGated && (
                      <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
                        {ac("approvalGated")}
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm font-medium text-white">{operatingActionCopy.headline}</div>
                  <p className="mt-1 text-xs text-slate-400">{operatingActionCopy.detail}</p>
                  <Button
                    data-testid="admin-operating-primary"
                    type="button"
                    size="sm"
                    className="mt-3 bg-cyan-600 hover:bg-cyan-700 text-white"
                    onClick={() => setActiveTab(operatingAction.tab)}
                  >
                    {operatingActionCopy.cta}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[560px]">
                {[
                  ["open-work", ac("openWork"), operatingSummary.totalOpenWork, "review"],
                  ["critical", ac("critical"), operatingSummary.criticalItems, "review"],
                  ["overdue", ac("overdue"), operatingSummary.overdueVerifications, "overdue"],
                  ["verifications", ac("verifications"), operatingSummary.pendingVerifications, "verifications"],
                  ["failed-payments", ac("failedPayments"), operatingSummary.failedPayments, "payments"],
                  ["legal", ac("legal"), operatingSummary.legalEscalations, "review"],
                  ["offer-reviews", ac("offerReviews"), operatingSummary.offerAttributionReviews, "review"],
                  ["monthly-revenue", ac("monthlyRevenue"), currencyFormatter.format(operatingSummary.monthlyRevenueUsd), "overview"],
                ].map(([id, label, value, tab]) => (
                  <button
                    key={id}
                    data-testid={`admin-operating-metric-${id}`}
                    type="button"
                    onClick={() => setActiveTab(String(tab))}
                    className="rounded-md border border-slate-700/70 bg-slate-950/60 p-3 text-left transition hover:border-cyan-500/40"
                  >
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className="mt-1 text-lg font-semibold text-white">{value}</div>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <section
          aria-labelledby="runtime-failure-heading"
          data-testid="admin-runtime-failure-signals"
          className="mb-6 border-y border-slate-800 bg-slate-950/35 px-1 py-4"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className={operationalFailures?.totalFailures ? "h-5 w-5 text-amber-300" : "h-5 w-5 text-emerald-300"} />
                <h2 id="runtime-failure-heading" className="text-sm font-semibold text-white">{ac("runtimeFailureSignals")}</h2>
                <Badge variant="outline" className={operationalFailures?.totalFailures ? "border-amber-500/30 text-amber-300" : "border-emerald-500/30 text-emerald-300"}>
                  {af("failuresRecorded", { count: operationalFailures?.totalFailures ?? 0 })}
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-xs text-slate-400">
                {ac("runtimeFailureDescription")}
              </p>
            </div>
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:max-w-3xl">
              {operationalFailures?.signals.length ? operationalFailures.signals.slice(0, 4).map((signal) => (
                <div key={`${signal.scope}:${signal.operation}`} className="min-w-0 border-l border-slate-700 pl-3 text-xs">
                  <div className="truncate font-medium text-slate-200" title={`${signal.scope}: ${signal.operation}`}>
                    {signal.scope}: {signal.operation}
                  </div>
                  <div className="mt-1 text-slate-500">
                    {af("occurrencesLast", { count: signal.count, date: dateTimeFormatter.format(new Date(signal.lastOccurredAt)) })}
                  </div>
                </div>
              )) : (
                <div className="text-xs text-slate-500">{ac("noFailureSignals")}</div>
              )}
            </div>
          </div>
        </section>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5 mb-8">
          {statCards.map((s) => (
            <Card key={s.id} className="bg-slate-900/60 border-slate-800/50">
              <CardContent className="p-4">
                <s.icon className={`h-5 w-5 ${s.color} mb-2`} />
                <div className="text-xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 h-auto flex flex-wrap justify-start bg-slate-900 border border-slate-800">
            <TabsTrigger value="overview" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400">
              {ac("allFees")}
            </TabsTrigger>
            <TabsTrigger value="overdue" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
              {ac("overdueTab")} {(operatingCounts?.overdueVerifications ?? overdue?.length ?? 0) > 0 && <Badge className="ml-1 bg-orange-500 text-white text-xs px-1.5">{operatingCounts?.overdueVerifications ?? overdue?.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="verifications" className="data-[state=active]:bg-yellow-500/20 data-[state=active]:text-yellow-400">
              {ac("verificationsTab")} {(operatingCounts?.pendingVerifications ?? pendingVerifications?.length ?? 0) > 0 && <Badge className="ml-1 bg-yellow-500 text-white text-xs px-1.5">{operatingCounts?.pendingVerifications ?? pendingVerifications?.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="review" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400">
              {ac("reviewTab")} {(operatingCounts?.reviewTotal ?? reviewQueue?.length ?? 0) > 0 && <Badge className="ml-1 bg-cyan-500 text-white text-xs px-1.5">{operatingCounts?.reviewTotal ?? reviewQueue?.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="payments" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
              {ac("paymentsTab")}
            </TabsTrigger>
            <TabsTrigger
              value="discovery"
              data-testid="admin-job-discovery-tab"
              className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-300"
            >
              {ac("jobDiscovery")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="discovery" data-testid="admin-job-discovery-panel">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
              <Card className="bg-slate-900/60 border-slate-800/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base text-white">
                    <Activity className="h-5 w-5 text-blue-300" />
                    {ac("discoveryScheduler")}
                    <Badge
                      variant="outline"
                      className={scrapingStatus?.scheduler.isStarted
                        ? "border-emerald-500/30 text-emerald-300"
                        : "border-slate-600 text-slate-400"}
                    >
                      {ac(scrapingStatus?.scheduler.isStarted ? "scheduled" : "stopped")}
                    </Badge>
                    {scrapingStatus?.scheduler.isRunning && (
                      <Badge variant="outline" className="border-blue-500/30 text-blue-300">
                        {ac("running")}
                      </Badge>
                    )}
                    <ScraperRunOutcomeBadge
                      outcome={scrapingStatus?.scheduler.lastRunOutcome}
                      label={scrapingStatus?.scheduler.lastRunOutcome
                        ? ac(RUN_OUTCOME_COPY_KEYS[scrapingStatus.scheduler.lastRunOutcome])
                        : null}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {discoveryMetrics.map(([id, label, value]) => (
                      <div key={id} data-testid={`admin-discovery-metric-${id}`} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                        <div className="text-xs text-slate-500">{label}</div>
                        <div className="mt-1 text-lg font-semibold text-white">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">{ac("lastCycle")}</div>
                      <div className="mt-1 text-slate-200">
                        {scrapingStatus?.scheduler.lastRunAt
                          ? dateTimeFormatter.format(new Date(scrapingStatus.scheduler.lastRunAt))
                          : ac("noRecordedCycle")}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">{ac("nextScheduledRun")}</div>
                      <div className="mt-1 text-slate-200">
                        {scrapingStatus?.scheduler.nextRunAt
                          ? dateTimeFormatter.format(new Date(scrapingStatus.scheduler.nextRunAt))
                          : ac("notScheduled")}
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-xs leading-5 text-slate-500">
                    {ac("adapterEvidenceNotice")}
                  </p>
                  {(scrapingStatus?.coverage.unconfiguredSources ?? 0) > 0 && (
                    <div data-testid="admin-scraping-coverage-gap" className="mt-4 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
                      <div className="font-medium">{ac("registryConfigurationTitle")}</div>
                      <p className="mt-1 text-xs text-blue-200">
                        {af("registryConfigurationDetail", { count: scrapingStatus?.coverage.unconfiguredSources ?? 0 })}
                      </p>
                    </div>
                  )}
                  {(scrapingStatus?.coverage.unavailableConfiguredSources ?? 0) > 0 && (
                    <div data-testid="admin-scraping-unavailable-sources" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <div className="font-medium">{ac("configuredAttentionTitle")}</div>
                      <p className="mt-1 text-xs text-amber-200">
                        {af("configuredAttentionDetail", { count: scrapingStatus?.coverage.unavailableConfiguredSources ?? 0 })}
                      </p>
                    </div>
                  )}
                  {freshEmptySources > 0 && (
                    <div data-testid="admin-scraping-empty-sources" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <div className="font-medium">{ac("emptySourcesTitle")}</div>
                      <p className="mt-1 text-xs text-amber-200">
                        {af("emptySourcesDetail", { count: freshEmptySources })}
                      </p>
                    </div>
                  )}
                  {(freshFailedSources + freshPartialSources) > 0 && (
                    <div data-testid="admin-scraping-outcome-issues" className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                      <div className="font-medium">{ac("sourceOutcomesTitle")}</div>
                      <p className="mt-1 text-xs text-red-200">
                        {af("sourceOutcomesDetail", { failed: freshFailedSources, partial: freshPartialSources })}
                      </p>
                    </div>
                  )}
                  {scrapingStatus?.scheduler.jobAlertRefreshFailed && (
                    <div data-testid="admin-scraping-alert-refresh-failed" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <div className="font-medium">{ac("alertRefreshTitle")}</div>
                      <p className="mt-1 text-xs text-amber-200">
                        {ac("alertRefreshDetail")}
                      </p>
                    </div>
                  )}
                  {scrapingStatus?.scheduler.errors.length ? (
                    <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <div className="font-medium">{ac("latestSourceIssues")}</div>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-200">
                        {scrapingStatus.scheduler.errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="bg-slate-900/60 border-slate-800/50">
                <CardHeader>
                  <CardTitle className="text-base text-white">{ac("runtimeSchedule")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="scraping-interval" className="text-slate-300">{ac("intervalMinutes")}</Label>
                      <Input
                        id="scraping-interval"
                        data-testid="admin-scraping-interval"
                        type="number"
                        min={5}
                        max={1440}
                        value={scrapingIntervalMinutes}
                        onChange={(event) => setScrapingIntervalMinutes(event.target.value)}
                        className="border-slate-700 bg-slate-950 text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="scraping-max-jobs" className="text-slate-300">{ac("maximumJobs")}</Label>
                      <Input
                        id="scraping-max-jobs"
                        data-testid="admin-scraping-max-jobs"
                        type="number"
                        min={10}
                        max={1000}
                        value={scrapingMaxJobsPerRun}
                        onChange={(event) => setScrapingMaxJobsPerRun(event.target.value)}
                        className="border-slate-700 bg-slate-950 text-white"
                      />
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="restrict-scraping-sources"
                        data-testid="admin-restrict-scraping-sources"
                        checked={restrictScrapingSources}
                        onCheckedChange={(checked) => setRestrictScrapingSources(Boolean(checked))}
                      />
                      <Label htmlFor="restrict-scraping-sources" className="text-sm text-slate-200">
                        {ac("limitSources")}
                      </Label>
                    </div>
                    {restrictScrapingSources && (
                      <div data-testid="admin-scraping-source-selector" className="mt-3 grid gap-2 sm:grid-cols-2">
                        {scrapingStatus?.platforms.filter((platform) => platform.readiness === "ready").map((platform) => {
                          const selected = selectedScrapingSources.includes(platform.name);
                          return (
                            <div key={platform.id} className="flex items-center gap-2 text-sm text-slate-300">
                              <Checkbox
                                id={`scraping-source-${platform.id}`}
                                checked={selected}
                                onCheckedChange={(checked) => {
                                  setSelectedScrapingSources((sources) => checked
                                    ? [...sources, platform.name]
                                    : sources.filter((source) => source !== platform.name)
                                  );
                                }}
                              />
                              <Label htmlFor={`scraping-source-${platform.id}`} className="text-sm text-slate-300">
                                {platform.name}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      data-testid="admin-start-scraping-scheduler"
                      className="bg-blue-600 text-white hover:bg-blue-700"
                      disabled={startScrapingScheduler.isPending || stopScrapingScheduler.isPending || runScrapingNow.isPending}
                      onClick={handleStartScrapingScheduler}
                    >
                      <Play className="mr-2 h-4 w-4" />
                      {ac(scrapingStatus?.scheduler.isStarted ? "updateSchedule" : "startSchedule")}
                    </Button>
                    <Button
                      data-testid="admin-stop-scraping-scheduler"
                      variant="outline"
                      className="border-slate-700 text-slate-200"
                      disabled={!scrapingStatus?.scheduler.isStarted || startScrapingScheduler.isPending || stopScrapingScheduler.isPending || runScrapingNow.isPending}
                      onClick={() => stopScrapingScheduler.mutate()}
                    >
                      <Pause className="mr-2 h-4 w-4" />
                      {ac("stopAction")}
                    </Button>
                    <Button
                      data-testid="admin-run-scraping-now"
                      variant="outline"
                      className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                      disabled={startScrapingScheduler.isPending || stopScrapingScheduler.isPending || runScrapingNow.isPending || scrapingStatus?.scheduler.isRunning}
                      onClick={() => runScrapingNow.mutate()}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {ac("runDiscoveryNow")}
                    </Button>
                  </div>
                  <div className="text-xs text-slate-500">
                    {af("currentSchedule", { minutes: scrapingStatus?.scheduler.intervalMinutes ?? 60, jobs: scrapingStatus?.scheduler.maxJobsPerRun ?? 100 })}
                    {" "}
                    {scrapingStatus?.scheduler.enabledPlatforms?.length
                      ? af("restrictedSources", { count: scrapingStatus.scheduler.enabledPlatforms.length })
                      : ac("allConfiguredSources")}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="mt-4 bg-slate-900/60 border-slate-800/50">
              <CardHeader>
                <CardTitle className="text-base text-white">{ac("activeSourceHealth")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 pr-4 text-left">{ac("source")}</th>
                        <th className="py-2 pr-4 text-left">{ac("adapter")}</th>
                        <th className="py-2 pr-4 text-left">{ac("readiness")}</th>
                        <th className="py-2 pr-4 text-left">{ac("latestOutcome")}</th>
                        <th className="py-2 pr-4 text-left">{ac("freshness")}</th>
                        <th className="py-2 pr-4 text-left">{ac("listings")}</th>
                        <th className="py-2 pr-4 text-left">{ac("lastAttempt")}</th>
                        <th className="py-2 text-left">{ac("lastSuccessfulScrape")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scrapingStatus?.platforms.map((platform) => {
                        const sourceHealth = getScraperSourceHealthSummary(platform);
                        return (
                        <tr key={platform.id} className="border-b border-slate-800/50">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{platform.name}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{platform.tier} | {platform.category || ac("general")}</div>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge
                              variant="outline"
                              className={platform.adapter.kind === "dedicated"
                                ? "border-blue-500/30 text-blue-300"
                                : "border-slate-600 text-slate-300"}
                            >
                              {ac(ADAPTER_COPY_KEYS[platform.adapter.kind].label)}
                            </Badge>
                            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{ac(ADAPTER_COPY_KEYS[platform.adapter.kind].detail)}</p>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant="outline" className={platform.readiness === "ready" ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}>
                              {ac(platform.readiness === "ready" ? "ready" : "unavailable")}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant="outline" className={sourceHealth.tone}>{ac(SOURCE_OUTCOME_COPY_KEYS[sourceHealth.outcome])}</Badge>
                            {sourceHealth.error && (
                              <p className="mt-1 max-w-sm text-xs leading-5 text-red-200">{sourceHealth.error}</p>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant="outline" className={platform.freshness === "fresh"
                              ? "border-emerald-500/30 text-emerald-300"
                              : platform.freshness === "stale"
                                ? "border-amber-500/30 text-amber-300"
                                : "border-slate-600 text-slate-400"}>
                              {platform.freshness === "fresh"
                                ? ac("fresh")
                                : platform.freshness === "stale"
                                  ? ac("stale")
                                  : ac("outcomeAwaiting")}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4 text-slate-300">
                            {sourceHealth.jobCount === null ? ac("noRecordedRun") : sourceHealth.jobCount}
                          </td>
                          <td className="py-3 pr-4 text-slate-300">
                            {platform.lastScrapeAttemptedAt ? dateTimeFormatter.format(new Date(platform.lastScrapeAttemptedAt)) : ac("noRecordedAttempt")}
                          </td>
                          <td className="py-3 text-slate-300">
                            {platform.lastScraped ? dateTimeFormatter.format(new Date(platform.lastScraped)) : ac("awaitingSuccessfulScrape")}
                          </td>
                        </tr>
                      );
                      })}
                      {(!scrapingStatus || scrapingStatus.platforms.length === 0) && (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">{ac("noActiveSources")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* All Fees Tab */}
          <TabsContent value="overview">
            <Card className="bg-slate-900/60 border-slate-800/50">
              <CardHeader>
                <CardTitle className="text-white text-base">{fc("allSuccessFees")}</CardTitle>
                {(operatingCounts?.feesTotal ?? 0) > (fees?.length ?? 0) && (
                  <p className="text-xs text-slate-400">{ff("showingNewestFees", { count: operatingCounts?.feesTotal ?? 0 })}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="text-left py-2 pr-4">{fc("user")}</th>
                        <th className="text-left py-2 pr-4">{fc("employerRole")}</th>
                        <th className="text-left py-2 pr-4">{fc("salary")}</th>
                        <th className="text-left py-2 pr-4">{fc("monthlyFee")}</th>
                        <th className="text-left py-2 pr-4">{fc("status")}</th>
                        <th className="text-left py-2 pr-4">{fc("nextVerification")}</th>
                        <th className="text-left py-2">{fc("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fees?.map((fee) => (
                        <tr key={fee.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{fee.userName ?? fc("unknown")}</div>
                            <div className="text-xs text-slate-500">{fee.userEmail ?? "—"}</div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="text-white">{fee.employerName}</div>
                            <div className="text-xs text-slate-500">{fee.jobTitle}</div>
                          </td>
                          <td className="py-3 pr-4 text-slate-300">
                            {new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-US", { style: "currency", currency: fee.currency, maximumFractionDigits: 0 }).format(fee.monthlySalary)} {fc("perMonth")}
                          </td>
                          <td className="py-3 pr-4 text-cyan-400 font-medium">
                            {formatCurrency(fee.monthlyFeeAmount, fee.currency)} {fc("perMonth")}
                          </td>
                          <td className="py-3 pr-4">
                            <StatusBadge status={fee.status} label={statusLabel(fee.status)} />
                          </td>
                          <td className="py-3 pr-4 text-slate-400 text-xs">
                            {formatDate(fee.nextVerificationDue)}
                          </td>
                          <td className="py-3">
                            <div className="flex gap-1 flex-wrap">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-slate-400 hover:text-white px-2"
                                onClick={() => {
                                  setStatusDialog({ open: true, feeId: fee.id, currentStatus: fee.status });
                                  setNewStatus(fee.status);
                                }}
                              >
                                {fc("changeStatus")}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-orange-400 hover:text-orange-300 px-2"
                                onClick={() => {
                                  setEscalateDialog({ open: true, feeId: fee.id, userName: fee.userName ?? fc("unknown") });
                                }}
                              >
                                <Gavel className="h-3 w-3 mr-1" />
                                {fc("escalate")}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-slate-400 hover:text-white px-2"
                                onClick={() => setNoteDialog({ open: true, feeId: fee.id })}
                              >
                                {fc("note")}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(!fees || fees.length === 0) && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            {fc("noSuccessFees")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Overdue Tab */}
          <TabsContent value="overdue">
            <Card className="bg-slate-900/60 border-slate-800/50">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-400" />
                  {fc("overdueVerifications")}
                </CardTitle>
                {(operatingCounts?.overdueVerifications ?? 0) > (overdue?.length ?? 0) && (
                  <p className="text-xs text-slate-400">{ff("showingOldestOverdue", { count: operatingCounts?.overdueVerifications ?? 0 })}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="text-left py-2 pr-4">{fc("user")}</th>
                        <th className="text-left py-2 pr-4">{fc("employerRole")}</th>
                        <th className="text-left py-2 pr-4">{fc("monthlyFee")}</th>
                        <th className="text-left py-2 pr-4">{fc("daysOverdue")}</th>
                        <th className="text-left py-2 pr-4">{fc("graceExpired")}</th>
                        <th className="text-left py-2">{fc("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overdue?.map((fee) => (
                        <tr key={fee.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{fee.userName ?? fc("unknown")}</div>
                            <div className="text-xs text-slate-500">{fee.userEmail ?? "—"}</div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="text-white">{fee.employerName}</div>
                            <div className="text-xs text-slate-500">{fee.jobTitle}</div>
                          </td>
                          <td className="py-3 pr-4 text-cyan-400">
                            {formatCurrency(fee.monthlyFeeAmount)} {fc("perMonth")}
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`font-bold ${fee.daysOverdue > 14 ? "text-red-400" : "text-orange-400"}`}>
                              {ff("daysCount", { count: fee.daysOverdue })}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            {fee.graceExpired ? (
                              <span className="text-red-400 font-medium">{fc("suspendRequired")}</span>
                            ) : (
                              <span className="text-yellow-400">{fc("withinGrace")}</span>
                            )}
                          </td>
                          <td className="py-3">
                            <div className="flex gap-1">
                              {fee.graceExpired && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs text-red-400 hover:text-red-300 px-2"
                                  onClick={() => updateStatus.mutate({ feeId: fee.id, status: "suspended", notes: ff("autoSuspendedNote", { count: fee.daysOverdue }) })}
                                >
                                  <Ban className="h-3 w-3 mr-1" />
                                  {fc("suspend")}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-orange-400 hover:text-orange-300 px-2"
                                onClick={() => setEscalateDialog({ open: true, feeId: fee.id, userName: fee.userName ?? fc("unknown") })}
                              >
                                <Gavel className="h-3 w-3 mr-1" />
                                {fc("escalate")}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(!overdue || overdue.length === 0) && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500">
                            {fc("noOverdue")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Verifications Tab */}
          <TabsContent value="verifications">
            <Card className="bg-slate-900/60 border-slate-800/50">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <FileText className="h-5 w-5 text-yellow-400" />
                  {fc("pendingVerificationReviews")}
                </CardTitle>
                {(operatingCounts?.pendingVerifications ?? 0) > (pendingVerifications?.length ?? 0) && (
                  <p className="text-xs text-slate-400">{ff("showingNewestVerifications", { count: operatingCounts?.pendingVerifications ?? 0 })}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {pendingVerifications?.map((v) => (
                    <div key={v.id} className="border border-slate-800 rounded-lg p-4 bg-slate-900/40">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-white">{v.userName ?? fc("unknown")}</span>
                            <StatusBadge status={v.verificationType ?? "initial"} label={statusLabel(v.verificationType ?? "initial")} />
                            <StatusBadge status={v.documentType ?? "other"} label={statusLabel(v.documentType ?? "other")} />
                          </div>
                          <div className="text-sm text-slate-400">
                            {v.employerName} — {v.jobTitle}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {ff("submittedSalary", {
                              date: formatDate(v.submittedAt),
                              salary: new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v.monthlySalary ?? 0),
                            })}
                          </div>
                          {v.hasDocument && (
                            <button
                              type="button"
                              onClick={() => verificationDocumentDownload.mutate({ verificationId: v.id })}
                              disabled={verificationDocumentDownload.isPending && verificationDocumentDownload.variables?.verificationId === v.id}
                              className="text-xs text-cyan-400 hover:text-cyan-300 mt-1 inline-flex items-center gap-1"
                            >
                              <FileText className="h-3 w-3" />
                              {fc("viewDocument")}
                            </button>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white h-8"
                            onClick={() => reviewVerification.mutate({ verificationId: v.id, approved: true })}
                          >
                            <CheckCircle className="h-3.5 w-3.5 mr-1" />
                            {fc("approve")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-500/50 text-red-400 hover:bg-red-500/10 h-8"
                            onClick={() => reviewVerification.mutate({ verificationId: v.id, approved: false, notes: fc("rejectionEvidenceNote") })}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            {fc("reject")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!pendingVerifications || pendingVerifications.length === 0) && (
                    <div className="py-8 text-center text-slate-500">
                      {fc("noPendingVerifications")}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Review Queue Tab */}
          <TabsContent value="review">
            <Card className="bg-slate-900/60 border-slate-800/50">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Shield className="h-5 w-5 text-cyan-400" />
                  {fc("operatingReviewQueue")}
                </CardTitle>
                {(operatingCounts?.reviewTotal ?? 0) > (reviewQueue?.length ?? 0) && (
                  <p className="text-xs text-slate-400">{ff("showingNewestReviews", { count: operatingCounts?.reviewTotal ?? 0 })}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {reviewQueue?.map((item) => (
                    (() => {
                      const evidence = getAdminReviewEvidenceSummary(item);
                      return (
                        <div
                          key={item.id}
                          data-testid="admin-review-item"
                          data-review-category={item.category}
                          className="border border-slate-800 rounded-lg p-4 bg-slate-900/40"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <StatusBadge status={item.priority} />
                                <StatusBadge status={item.category} />
                                <span className="text-xs text-slate-500">{ff("entityReference", { entity: item.entityType, id: item.entityId })}</span>
                                <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
                                  {evidence.label}
                                </Badge>
                              </div>
                              <div className="font-medium text-white">{item.title}</div>
                              {item.description && (
                                <p className="mt-1 text-sm text-slate-400">{item.description}</p>
                              )}
                              <div
                                data-testid="admin-review-evidence"
                                className="mt-3 rounded-md border border-slate-800 bg-slate-950/50 p-3"
                              >
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className={evidence.risk === "critical"
                                      ? "border-red-500/40 text-red-300"
                                      : evidence.risk === "high"
                                        ? "border-orange-500/40 text-orange-300"
                                        : evidence.risk === "medium"
                                          ? "border-amber-500/40 text-amber-300"
                                          : "border-slate-700 text-slate-300"}
                                  >
                                    {evidence.risk}
                                  </Badge>
                                  {evidence.requiresManualDecision && (
                                    <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
                                      {fc("manualDecision")}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm font-medium text-white">{evidence.headline}</p>
                                <p className="mt-1 text-sm text-slate-400">{evidence.detail}</p>
                                <div className="mt-3 grid gap-2 md:grid-cols-2">
                                  {evidence.checklist.map((proof) => (
                                    <div key={proof} className="flex items-start gap-2 text-xs text-slate-300">
                                      <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                                      <span>{proof}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="mt-2 text-xs text-slate-500">
                                {ff("userCreated", { userId: item.userId, date: formatDate(item.createdAt) })}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button
                                data-testid="admin-review-open-evidence"
                                size="sm"
                                variant="outline"
                                className="h-8 border-slate-700 text-slate-300"
                                onClick={() => setEvidenceDialog({ open: true, itemId: item.id })}
                              >
                                <FileText className="h-3.5 w-3.5 mr-1" />
                                {fc("evidence")}
                              </Button>
                              <Button
                                size="sm"
                                className="h-8 bg-cyan-600 hover:bg-cyan-700 text-white"
                                onClick={() => {
                                  setReviewDialog({ open: true, itemId: item.id, status: "resolved" });
                                  setReviewResolution("");
                                }}
                              >
                                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                {fc(item.category === "privacy_deletion" ? "recordReview" : "resolve")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 border-slate-700 text-slate-300"
                                onClick={() => {
                                  setReviewDialog({ open: true, itemId: item.id, status: "dismissed" });
                                  setReviewResolution("");
                                }}
                              >
                                {fc(item.category === "privacy_deletion" ? "closeRequest" : "dismiss")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ))}
                  {(!reviewQueue || reviewQueue.length === 0) && (
                    <div className="py-8 text-center text-slate-500">
                      {fc("noOpenReviews")}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments">
            <Card className="bg-slate-900/60 border-slate-800/50">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-400" />
                  {fc("paymentHistory")}
                </CardTitle>
                {(operatingCounts?.paymentsTotal ?? 0) > (payments?.length ?? 0) && (
                  <p className="text-xs text-slate-400">{ff("showingNewestPayments", { count: operatingCounts?.paymentsTotal ?? 0 })}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="text-left py-2 pr-4">{fc("user")}</th>
                        <th className="text-left py-2 pr-4">{fc("employer")}</th>
                        <th className="text-left py-2 pr-4">{fc("amount")}</th>
                        <th className="text-left py-2 pr-4">{fc("status")}</th>
                        <th className="text-left py-2 pr-4">{fc("period")}</th>
                        <th className="text-left py-2">{fc("paidAt")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments?.map((p) => (
                        <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{p.userName ?? fc("unknown")}</div>
                            <div className="text-xs text-slate-500">{p.userEmail ?? "—"}</div>
                          </td>
                          <td className="py-3 pr-4 text-slate-300">{p.employerName ?? "—"}</td>
                          <td className="py-3 pr-4 text-green-400 font-medium">
                            {formatCurrency(p.amount, p.currency)}
                          </td>
                          <td className="py-3 pr-4">
                            <StatusBadge status={p.status} label={statusLabel(p.status)} />
                          </td>
                          <td className="py-3 pr-4 text-slate-400 text-xs">
                            {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                          </td>
                          <td className="py-3 text-slate-400 text-xs">{formatDate(p.paidAt)}</td>
                        </tr>
                      ))}
                      {(!payments || payments.length === 0) && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500">
                            {fc("noPayments")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Admin Evidence Dialog */}
      <Dialog open={evidenceDialog.open} onOpenChange={(o) => !o && setEvidenceDialog({ open: false, itemId: null })}>
        <DialogContent
          data-testid="admin-review-evidence-dialog"
          className="max-h-[85vh] max-w-4xl overflow-y-auto bg-slate-900 border-slate-800 text-white"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-cyan-400" />
              Review Evidence
            </DialogTitle>
          </DialogHeader>

          {reviewEvidenceLoading ? (
            <div className="rounded-md border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-400">
              Loading linked evidence...
            </div>
          ) : reviewEvidenceError ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              {reviewEvidenceError.message}
            </div>
          ) : reviewEvidence ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Review item</div>
                  <div className="mt-1 font-medium text-white">{reviewEvidence.reviewItem.title}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge status={reviewEvidence.reviewItem.priority} />
                    <StatusBadge status={reviewEvidence.reviewItem.category} />
                    <StatusBadge status={reviewEvidence.reviewItem.status} />
                  </div>
                  {reviewEvidence.reviewItem.description && (
                    <p className="mt-2 text-sm text-slate-400">{reviewEvidence.reviewItem.description}</p>
                  )}
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Job seeker</div>
                  <div className="mt-1 font-medium text-white">{reviewEvidence.user?.name ?? "Unknown user"}</div>
                  <div className="text-sm text-slate-400">{reviewEvidence.user?.email ?? "No email"}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge status={reviewEvidence.user?.accountStatus ?? "unknown"} />
                    <Badge variant="outline" className="border-slate-700 text-slate-300">
                      ToS {reviewEvidence.user?.tosAcceptedAt ? "accepted" : "missing"}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                {[
                  ["Decision", reviewEvidence.decision ? 1 : 0],
                  ["Approvals", reviewEvidence.approvals.length],
                  ["Attempts", reviewEvidence.attempts.length],
                  ["Responses", reviewEvidence.employerResponses.length],
                  ["Audit", reviewEvidence.auditEvents.length],
                  ["Material", reviewEvidence.material ? 1 : 0],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className="mt-1 text-lg font-semibold text-white">{value}</div>
                  </div>
                ))}
              </div>

              {reviewEvidence.reviewItem.category === "privacy_deletion" && (
                <div
                  data-testid="privacy-erasure-preview"
                  className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-cyan-100">Retention and erasure preview</div>
                      <p className="mt-1 text-sm text-slate-400">
                        Read-only inventory. Previewing or resolving this review does not delete data.
                      </p>
                    </div>
                    {privacyErasurePreview?.policyVersion && (
                      <Badge variant="outline" className="border-cyan-500/30 text-cyan-200">
                        Policy {privacyErasurePreview.policyVersion}
                      </Badge>
                    )}
                  </div>

                  {privacyErasurePreviewLoading ? (
                    <p className="mt-3 text-sm text-slate-400">Counting user-owned records...</p>
                  ) : privacyErasurePreviewError ? (
                    <p className="mt-3 text-sm text-red-200">{privacyErasurePreviewError.message}</p>
                  ) : privacyErasurePreview?.available ? (
                    <>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                        {[
                          ["Erase", privacyErasurePreview.summary.erase],
                          ["Scrub and retain", privacyErasurePreview.summary.scrubAndRetain],
                          ["Legally retained", privacyErasurePreview.summary.retain],
                          ["Private object fields", privacyErasurePreview.summary.privateObjects],
                          ["Provider revocations", privacyErasurePreview.summary.providerRevocations],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded border border-slate-800 bg-slate-950/60 p-2">
                            <div className="text-xs text-slate-500">{label}</div>
                            <div className="mt-1 font-semibold text-white">{value}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 max-h-52 overflow-y-auto rounded border border-slate-800">
                        {privacyErasurePreview.items.map((item) => (
                          <div key={item.table} className="grid gap-1 border-b border-slate-800 px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                            <span className="font-mono text-xs text-slate-300">{item.table}</span>
                            <StatusBadge status={item.action} />
                            <span className="text-slate-400">{item.recordCount} record{item.recordCount === 1 ? "" : "s"}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-xs text-amber-200">
                        Resolving this review creates a non-destructive, itemized execution plan. It does not revoke providers, delete objects, or change user data.
                      </p>
                      {privacyErasurePlan && (
                        <div className="mt-3 space-y-3 border-t border-cyan-500/20 pt-3" data-testid="privacy-erasure-plan">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium text-white">Execution plan #{privacyErasurePlan.run.id}</div>
                              <div className="text-xs text-slate-400">{privacyErasurePlan.tasks.length} itemized task{privacyErasurePlan.tasks.length === 1 ? "" : "s"}</div>
                            </div>
                            <StatusBadge status={privacyErasurePlan.run.status} />
                          </div>
                          <div className="max-h-40 overflow-y-auto rounded border border-slate-800">
                            {privacyErasurePlan.tasks.map((task) => (
                              <div key={task.id} className="grid gap-1 border-b border-slate-800 px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center">
                                <span className="text-slate-300">
                                  {task.kind.replaceAll("_", " ")} - {task.provider ?? task.sourceTable}
                                </span>
                                <StatusBadge status={task.status} />
                              </div>
                            ))}
                          </div>
                          {["planned", "cleanup_in_progress", "failed"].includes(privacyErasurePlan.run.status) && (
                            <div className="space-y-2">
                              <Label className="text-slate-300">External cleanup confirmation</Label>
                              <code className="block break-all rounded bg-slate-950 px-2 py-1 text-xs text-cyan-200">
                                {buildPrivacyCleanupConfirmation(privacyErasurePlan.run.userId, privacyErasurePlan.run.policyVersion)}
                              </code>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Input
                                  value={erasureCleanupConfirmation}
                                  onChange={(event) => setErasureCleanupConfirmation(event.target.value)}
                                  className="border-slate-700 bg-slate-950 text-white"
                                  aria-label="External cleanup confirmation"
                                />
                                <Button
                                  onClick={() => executePrivacyErasureCleanup.mutate({
                                    runId: privacyErasurePlan.run.id,
                                    confirmation: erasureCleanupConfirmation,
                                  })}
                                  disabled={executePrivacyErasureCleanup.isPending || !canExecutePrivacyCleanup({
                                    status: privacyErasurePlan.run.status,
                                    confirmation: erasureCleanupConfirmation,
                                    userId: privacyErasurePlan.run.userId,
                                    policyVersion: privacyErasurePlan.run.policyVersion,
                                  })}
                                  className="bg-red-700 hover:bg-red-800"
                                >
                                  <Shield className="mr-2 h-4 w-4" />
                                  Run cleanup
                                </Button>
                              </div>
                            </div>
                          )}
                          {privacyErasurePlan.tasks.filter((task) => task.kind === "provider_revoke" && task.status === "blocked").map((task) => (
                            <div key={`manual-${task.id}`} className="space-y-2 rounded border border-amber-500/30 bg-amber-500/5 p-3">
                              <Label className="text-amber-100">Manual {task.provider} cleanup evidence</Label>
                              <Textarea
                                value={manualCleanupEvidence[task.id] ?? ""}
                                onChange={(event) => setManualCleanupEvidence((current) => ({ ...current, [task.id]: event.target.value }))}
                                className="border-slate-700 bg-slate-950 text-white"
                                rows={3}
                              />
                              <Button
                                variant="outline"
                                disabled={confirmManualPrivacyCleanup.isPending || (manualCleanupEvidence[task.id]?.trim().length ?? 0) < 20}
                                onClick={() => confirmManualPrivacyCleanup.mutate({
                                  runId: privacyErasurePlan.run.id,
                                  taskId: task.id,
                                  evidence: manualCleanupEvidence[task.id] ?? "",
                                })}
                              >
                                <CheckCircle className="mr-2 h-4 w-4" />
                                Confirm provider removal
                              </Button>
                            </div>
                          ))}
                          {privacyErasurePlan.run.status === "ready_for_database" && (
                            <div className="space-y-2 border-t border-red-500/20 pt-3">
                              <p className="text-xs text-amber-200">
                                External cleanup is complete. This final action atomically erases product data, scrubs retained ledgers, pseudonymizes the account, and preserves regulated records.
                              </p>
                              <Label className="text-slate-300">Database erasure confirmation</Label>
                              <code className="block break-all rounded bg-slate-950 px-2 py-1 text-xs text-red-200">
                                {buildPrivacyDatabaseConfirmation(privacyErasurePlan.run.userId, privacyErasurePlan.run.policyVersion)}
                              </code>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Input
                                  value={databaseErasureConfirmation}
                                  onChange={(event) => setDatabaseErasureConfirmation(event.target.value)}
                                  className="border-red-700/50 bg-slate-950 text-white"
                                  aria-label="Database erasure confirmation"
                                />
                                <Button
                                  onClick={() => finalizePrivacyErasure.mutate({
                                    runId: privacyErasurePlan.run.id,
                                    confirmation: databaseErasureConfirmation,
                                  })}
                                  disabled={finalizePrivacyErasure.isPending || !canFinalizePrivacyErasure({
                                    status: privacyErasurePlan.run.status,
                                    confirmation: databaseErasureConfirmation,
                                    userId: privacyErasurePlan.run.userId,
                                    policyVersion: privacyErasurePlan.run.policyVersion,
                                  })}
                                  className="bg-red-800 hover:bg-red-900"
                                >
                                  <Shield className="mr-2 h-4 w-4" />
                                  Finalize erasure
                                </Button>
                              </div>
                            </div>
                          )}
                          {privacyErasurePlan.run.status === "completed" && (
                            <p className="text-xs text-green-300">
                              Erasure completed. Regulated records remain retained under the recorded policy with the account identity pseudonymized.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-amber-200">{privacyErasurePreview?.reason}</p>
                  )}
                </div>
              )}

              {reviewEvidence.reviewItem.category !== "privacy_deletion" && <div
                data-testid="admin-review-evidence-linked-application"
                className="rounded-md border border-slate-800 bg-slate-950/50 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-300">Linked application</div>
                  {reviewEvidence.application?.status && <StatusBadge status={reviewEvidence.application.status} />}
                </div>
                {reviewEvidence.application ? (
                  <div className="space-y-2">
                    <div>
                      <div className="font-medium text-white">
                        {reviewEvidence.application.job?.title ?? `Application #${reviewEvidence.application.id}`}
                      </div>
                      <div className="text-sm text-slate-400">
                        {reviewEvidence.application.job?.company ?? "Unknown company"} - {reviewEvidence.application.job?.location ?? "Unknown location"}
                      </div>
                    </div>
                    <p className="text-sm text-slate-400">{reviewEvidence.application.notes ?? "No application notes recorded."}</p>
                  </div>
                ) : (
                  <p className="text-sm text-orange-200">
                    The review item points to an application record that could not be loaded for the linked user.
                  </p>
                )}
              </div>}

              <div
                data-testid="admin-review-evidence-decision"
                className="rounded-md border border-slate-800 bg-slate-950/50 p-3"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-300">Decision and policy</div>
                  {reviewEvidence.decision ? (
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={reviewEvidence.decision.decision ?? "review"} />
                      <StatusBadge status={reviewEvidence.decision.riskLevel ?? "medium"} />
                      {reviewEvidence.decision.matchScore != null && (
                        <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
                          {reviewEvidence.decision.matchScore}% match
                        </Badge>
                      )}
                    </div>
                  ) : null}
                </div>
                {reviewEvidence.decision ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Decision reason</div>
                      <p className="mt-1 text-sm text-slate-300">
                        {reviewEvidence.decision.decisionReason || "No decision reason recorded."}
                      </p>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Review reason</div>
                      <p className="mt-1 text-sm text-slate-300">
                        {reviewEvidence.decision.reviewReason || "No review reason recorded."}
                      </p>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-400 md:col-span-2">
                      Decided by {reviewEvidence.decision.decidedBy}. External action remains blocked until the approval gate and evidence checklist are resolved.
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    No application decision record is linked to this review item yet.
                  </p>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-300">Material and claims</div>
                  {reviewEvidence.material ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">Cover letter</span>
                        <span className={reviewEvidence.material.coverLetter ? "text-cyan-300" : "text-slate-500"}>
                          {reviewEvidence.material.coverLetter ? "stored" : "missing"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">Custom answers</span>
                        <span className={reviewEvidence.material.customAnswers ? "text-cyan-300" : "text-slate-500"}>
                          {reviewEvidence.material.customAnswers ? "stored" : "missing"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">Supported claims</span>
                        <span className={reviewEvidence.material.claimsMade ? "text-cyan-300" : "text-slate-500"}>
                          {reviewEvidence.material.claimsMade ? "stored" : "missing"}
                        </span>
                      </div>
                      {reviewEvidence.material.claimsMade && (
                        <p className="line-clamp-4 rounded border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-400">
                          {reviewEvidence.material.claimsMade}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No prepared material is linked to this review item.</p>
                  )}
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-300">Approval gates</div>
                  {reviewEvidence.approvals.length > 0 ? (
                    <div className="space-y-2">
                      {reviewEvidence.approvals.slice(0, 4).map((approval) => (
                        <div key={approval.id} className="rounded border border-slate-800 bg-slate-900/60 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={approval.status} />
                            <StatusBadge status={approval.riskLevel} />
                            <span className="text-sm text-white">{approval.title}</span>
                          </div>
                          {approval.description && <p className="mt-1 text-xs text-slate-400">{approval.description}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No approval gates are linked to this entity.</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-300">Submission attempts</div>
                  {reviewEvidence.attempts.length > 0 ? (
                    <div className="space-y-2">
                      {reviewEvidence.attempts.slice(0, 4).map((attempt) => (
                        <div key={attempt.id} className="rounded border border-slate-800 bg-slate-900/60 p-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={attempt.status} />
                            <span className="text-slate-300">{attempt.attemptType.replace(/_/g, " ")}</span>
                          </div>
                          {attempt.confirmationText && <p className="mt-1 text-xs text-slate-400">{attempt.confirmationText}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No submission attempt evidence has been recorded.</p>
                  )}
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-300">Employer responses</div>
                  {reviewEvidence.employerResponses.length > 0 ? (
                    <div className="space-y-2">
                      {reviewEvidence.employerResponses.slice(0, 4).map((response) => (
                        <div key={response.id} className="rounded border border-slate-800 bg-slate-900/60 p-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={response.responseType} />
                            <span className="text-slate-400">{formatDate(response.receivedAt)}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">{response.summary}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No employer response is linked to this review item.</p>
                  )}
                </div>
              </div>

              <div
                data-testid="admin-review-evidence-audit-count"
                className="rounded-md border border-slate-800 bg-slate-950/50 p-3"
              >
                <div className="mb-2 text-sm font-medium text-slate-300">
                  Audit trail ({reviewEvidence.auditEvents.length})
                </div>
                {reviewEvidence.auditEvents.length > 0 ? (
                  <div className="space-y-2">
                    {reviewEvidence.auditEvents.slice(0, 6).map((event) => (
                      <div key={event.id} className="border-l border-slate-700 pl-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={event.riskLevel} />
                          <span className="font-medium text-white">{event.action}</span>
                          <span className="text-xs text-slate-500">{formatDate(event.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {event.actor} via {event.source ?? "unknown source"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No audit events are linked to this entity.</p>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Review Resolution Dialog */}
      <Dialog open={reviewDialog.open} onOpenChange={(o) => !o && setReviewDialog({ open: false, itemId: null, status: "resolved" })}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>
              {isPrivacyDeletionDialog
                ? fc(reviewDialog.status === "resolved" ? "recordPrivacyReview" : "closePrivacyRequest")
                : fc(reviewDialog.status === "resolved" ? "resolveReviewItem" : "dismissReviewItem")}
            </DialogTitle>
          </DialogHeader>
          {isPrivacyDeletionDialog ? (
            <p className="text-sm text-amber-200/80">
              {fc("privacyPlanningNotice")}
            </p>
          ) : null}
          <div>
            <Label className="text-slate-300">{fc("resolutionNote")}</Label>
            <Textarea
              value={reviewResolution}
              onChange={(e) => setReviewResolution(e.target.value)}
              placeholder={isPrivacyDeletionDialog
                ? fc("privacyResolutionPlaceholder")
                : fc("reviewResolutionPlaceholder")}
              className="bg-slate-800 border-slate-700 text-white mt-1"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewDialog({ open: false, itemId: null, status: "resolved" })}>{fc("cancel")}</Button>
            <Button
              className="bg-cyan-600 hover:bg-cyan-700"
              disabled={!reviewResolution.trim() || resolveReviewItem.isPending}
              onClick={() => {
                if (reviewDialog.itemId) {
                  resolveReviewItem.mutate({
                    reviewItemId: reviewDialog.itemId,
                    status: reviewDialog.status,
                    resolution: reviewResolution,
                  });
                }
              }}
            >
              {isPrivacyDeletionDialog
                ? fc(reviewDialog.status === "resolved" ? "recordAndPlan" : "closeRequest")
                : fc(reviewDialog.status === "resolved" ? "resolve" : "dismiss")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Change Dialog */}
      <Dialog open={statusDialog.open} onOpenChange={(o) => !o && setStatusDialog({ open: false, feeId: null, currentStatus: "" })}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>{fc("updateFeeStatus")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-slate-300">{fc("newStatus")}</Label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white text-sm"
              >
                {["pending_verification", "active", "paused", "ended", "suspended", "disputed"].map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-slate-300">{fc("optionalNote")}</Label>
              <Textarea
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder={fc("statusReasonPlaceholder")}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStatusDialog({ open: false, feeId: null, currentStatus: "" })}>{fc("cancel")}</Button>
            <Button
              className="bg-cyan-600 hover:bg-cyan-700"
              disabled={updateStatus.isPending}
              onClick={() => {
                if (statusDialog.feeId) {
                  updateStatus.mutate({ feeId: statusDialog.feeId, status: newStatus as any, notes: statusNote || undefined });
                }
              }}
            >
              {fc("updateStatus")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Legal Escalation Dialog */}
      <Dialog open={escalateDialog.open} onOpenChange={(o) => !o && setEscalateDialog({ open: false, feeId: null, userName: "" })}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gavel className="h-5 w-5 text-orange-400" />
              {fc("legalEscalation")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              {ff("legalEscalationDetail", { name: escalateDialog.userName })}
            </p>
            <div>
              <Label className="text-slate-300">{fc("escalationReason")}</Label>
              <Textarea
                value={escalateReason}
                onChange={(e) => setEscalateReason(e.target.value)}
                placeholder={fc("escalationPlaceholder")}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEscalateDialog({ open: false, feeId: null, userName: "" })}>{fc("cancel")}</Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700"
              disabled={!escalateReason.trim() || flagEscalation.isPending}
              onClick={() => {
                if (escalateDialog.feeId) {
                  flagEscalation.mutate({ feeId: escalateDialog.feeId, reason: escalateReason });
                }
              }}
            >
              <Gavel className="h-4 w-4 mr-2" />
              {fc("confirmEscalation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Note Dialog */}
      <Dialog open={noteDialog.open} onOpenChange={(o) => !o && setNoteDialog({ open: false, feeId: null })}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>{fc("addAdminNote")}</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-slate-300">{fc("adminNote")}</Label>
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={fc("adminNotePlaceholder")}
              className="bg-slate-800 border-slate-700 text-white mt-1"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNoteDialog({ open: false, feeId: null })}>{fc("cancel")}</Button>
            <Button
              className="bg-cyan-600 hover:bg-cyan-700"
              disabled={!noteText.trim() || addNote.isPending}
              onClick={() => {
                if (noteDialog.feeId) {
                  addNote.mutate({ feeId: noteDialog.feeId, note: noteText });
                }
              }}
            >
              {fc("saveNote")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
