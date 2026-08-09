import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getAdminOperatingControlAction } from "@/lib/adminOperatingControl";
import { getAdminOperatingSummary } from "@/lib/adminOperatingSummary";
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

function formatCurrency(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
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
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ScraperRunOutcomeBadge({ outcome }: { outcome: "success" | "partial" | "failed" | null | undefined }) {
  if (!outcome) return null;

  const details = {
    success: { label: "Last cycle clean", tone: "border-emerald-500/30 text-emerald-300" },
    partial: { label: "Last cycle partial", tone: "border-amber-500/30 text-amber-300" },
    failed: { label: "Last cycle failed", tone: "border-red-500/30 text-red-300" },
  }[outcome];
  return <Badge variant="outline" className={details.tone}>{details.label}</Badge>;
}

export default function AdminPanel() {
  const { user, loading } = useAuth();
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
      toast.success("Fee status updated");
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
      toast.success(data.approved ? "Verification approved" : "Verification rejected");
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
      toast.success("Account flagged for legal escalation");
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
      toast.success("Note added");
      refetchFees();
      setNoteDialog({ open: false, feeId: null });
      setNoteText("");
    },
    onError: (err) => toast.error(err.message),
  });

  const reinstateUser = trpc.admin.reinstateUser.useMutation({
    onSuccess: () => {
      toast.success("User reinstated");
      refetchFees();
      refetchStats();
      refetchOperatingCounts();
    },
    onError: (err) => toast.error(err.message),
  });

  const verificationDocumentDownload = trpc.admin.getVerificationDocumentDownloadUrl.useMutation({
    onSuccess: (data) => {
      if (!openExternalUrl(data.url)) toast.error("The verification download URL is invalid.");
    },
    onError: (err) => toast.error(err.message || "Could not open the verification document"),
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
    onSuccess: (result) => {
      toast.success(result.message);
      refetchScrapingStatus();
    },
    onError: (err) => toast.error(err.message),
  });
  const stopScrapingScheduler = trpc.scraping.stopScheduler.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      refetchScrapingStatus();
    },
    onError: (err) => toast.error(err.message),
  });
  const runScrapingNow = trpc.scraping.runNow.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      refetchScrapingStatus();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleStartScrapingScheduler = () => {
    const intervalMinutes = Number(scrapingIntervalMinutes);
    const maxJobsPerRun = Number(scrapingMaxJobsPerRun);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1440) {
      toast.error("Choose an interval between 5 minutes and 24 hours.");
      return;
    }
    if (!Number.isInteger(maxJobsPerRun) || maxJobsPerRun < 10 || maxJobsPerRun > 1000) {
      toast.error("Choose 10 to 1,000 jobs per run.");
      return;
    }
    if (restrictScrapingSources && selectedScrapingSources.length === 0) {
      toast.error("Select at least one source or use all active sources.");
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
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Card className="bg-slate-900 border-slate-800 p-8 text-center max-w-md">
          <Shield className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400 mb-4">You do not have permission to access the admin panel.</p>
          <Button onClick={() => setLocation("/dashboard")} variant="outline">
            Back to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  const statCards = [
    { label: "Active Fees", value: stats?.activeFees ?? 0, icon: Activity, color: "text-green-400" },
    { label: "Pending Verification", value: stats?.pendingFees ?? 0, icon: FileText, color: "text-yellow-400" },
    { label: "Overdue Verifications", value: stats?.overdueVerifications ?? 0, icon: AlertTriangle, color: "text-orange-400" },
    { label: "Review Items", value: operatingCounts?.reviewTotal ?? reviewQueue?.length ?? 0, icon: Shield, color: "text-cyan-400" },
    { label: "Suspended", value: stats?.suspendedFees ?? 0, icon: Ban, color: "text-red-400" },
    { label: "Paused", value: stats?.pausedFees ?? 0, icon: Pause, color: "text-slate-400" },
    { label: "Disputed", value: stats?.disputedFees ?? 0, icon: AlertTriangle, color: "text-orange-400" },
    { label: "Monthly Revenue", value: `$${(stats?.monthlyRevenueUsd ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, icon: DollarSign, color: "text-cyan-400" },
    { label: "Total Revenue", value: `$${(stats?.totalRevenueUsd ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, icon: DollarSign, color: "text-blue-400" },
    { label: "Total Users", value: stats?.totalUsers ?? 0, icon: Users, color: "text-purple-400" },
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
  const operatingActionClass = {
    low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    medium: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    high: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    critical: "border-red-500/30 bg-red-500/10 text-red-300",
  }[operatingAction.risk];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800/50 bg-slate-950/80 sticky top-0 z-50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-cyan-400" />
            <div>
              <h1 className="text-lg font-bold text-white">Admin Panel</h1>
              <p className="text-xs text-slate-500">Hire.AI Operations</p>
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
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/dashboard")}
              className="border-slate-700 text-slate-300"
            >
              Dashboard
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
                  <h2 className="text-base font-semibold text-white">Admin Operating Queue</h2>
                  <Badge variant="outline" className={operatingSummaryClass}>
                    {operatingSummary.label}
                  </Badge>
                </div>
                <p className="text-sm text-slate-400">{operatingSummary.nextAction}</p>
                <div className="mt-3 text-xs text-slate-500">
                  Manual admin approval is still required for legal escalation, suspension, billing changes, and verification decisions.
                </div>
                <div
                  data-testid="admin-operating-control"
                  className="mt-4 rounded-md border border-slate-800 bg-slate-950/50 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={operatingActionClass}>
                      {operatingAction.label}
                    </Badge>
                    {operatingAction.approvalGated && (
                      <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
                        Approval gated
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm font-medium text-white">{operatingAction.headline}</div>
                  <p className="mt-1 text-xs text-slate-400">{operatingAction.detail}</p>
                  <Button
                    data-testid="admin-operating-primary"
                    type="button"
                    size="sm"
                    className="mt-3 bg-cyan-600 hover:bg-cyan-700 text-white"
                    onClick={() => setActiveTab(operatingAction.tab)}
                  >
                    {operatingAction.cta}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[560px]">
                {[
                  ["Open work", operatingSummary.totalOpenWork, "review"],
                  ["Critical", operatingSummary.criticalItems, "review"],
                  ["Overdue", operatingSummary.overdueVerifications, "overdue"],
                  ["Verifications", operatingSummary.pendingVerifications, "verifications"],
                  ["Failed payments", operatingSummary.failedPayments, "payments"],
                  ["Legal", operatingSummary.legalEscalations, "review"],
                  ["Offer reviews", operatingSummary.offerAttributionReviews, "review"],
                  ["Monthly revenue", `$${operatingSummary.monthlyRevenueUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "overview"],
                ].map(([label, value, tab]) => (
                  <button
                    key={label}
                    data-testid={`admin-operating-metric-${String(label).toLowerCase().replace(/\s+/g, "-")}`}
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
                <h2 id="runtime-failure-heading" className="text-sm font-semibold text-white">Runtime failure signals</h2>
                <Badge variant="outline" className={operationalFailures?.totalFailures ? "border-amber-500/30 text-amber-300" : "border-emerald-500/30 text-emerald-300"}>
                  {operationalFailures?.totalFailures ?? 0} since startup
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-xs text-slate-400">
                Redacted process-local counters for failed provider and runtime operations. Restarting the server resets this view; durable provider evidence remains in the operating ledger.
              </p>
            </div>
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:max-w-3xl">
              {operationalFailures?.signals.length ? operationalFailures.signals.slice(0, 4).map((signal) => (
                <div key={`${signal.scope}:${signal.operation}`} className="min-w-0 border-l border-slate-700 pl-3 text-xs">
                  <div className="truncate font-medium text-slate-200" title={`${signal.scope}: ${signal.operation}`}>
                    {signal.scope}: {signal.operation}
                  </div>
                  <div className="mt-1 text-slate-500">
                    {signal.count} occurrence{signal.count === 1 ? "" : "s"} · last {new Date(signal.lastOccurredAt).toLocaleString()}
                  </div>
                </div>
              )) : (
                <div className="text-xs text-slate-500">No redacted failure signals have been recorded by this server process.</div>
              )}
            </div>
          </div>
        </section>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5 mb-8">
          {statCards.map((s) => (
            <Card key={s.label} className="bg-slate-900/60 border-slate-800/50">
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
              All Fees
            </TabsTrigger>
            <TabsTrigger value="overdue" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
              Overdue {(operatingCounts?.overdueVerifications ?? overdue?.length ?? 0) > 0 && <Badge className="ml-1 bg-orange-500 text-white text-xs px-1.5">{operatingCounts?.overdueVerifications ?? overdue?.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="verifications" className="data-[state=active]:bg-yellow-500/20 data-[state=active]:text-yellow-400">
              Verifications {(operatingCounts?.pendingVerifications ?? pendingVerifications?.length ?? 0) > 0 && <Badge className="ml-1 bg-yellow-500 text-white text-xs px-1.5">{operatingCounts?.pendingVerifications ?? pendingVerifications?.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="review" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400">
              Review {(operatingCounts?.reviewTotal ?? reviewQueue?.length ?? 0) > 0 && <Badge className="ml-1 bg-cyan-500 text-white text-xs px-1.5">{operatingCounts?.reviewTotal ?? reviewQueue?.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="payments" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
              Payments
            </TabsTrigger>
            <TabsTrigger
              value="discovery"
              data-testid="admin-job-discovery-tab"
              className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-300"
            >
              Job discovery
            </TabsTrigger>
          </TabsList>

          <TabsContent value="discovery" data-testid="admin-job-discovery-panel">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
              <Card className="bg-slate-900/60 border-slate-800/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base text-white">
                    <Activity className="h-5 w-5 text-blue-300" />
                    Job discovery scheduler
                    <Badge
                      variant="outline"
                      className={scrapingStatus?.scheduler.isStarted
                        ? "border-emerald-500/30 text-emerald-300"
                        : "border-slate-600 text-slate-400"}
                    >
                      {scrapingStatus?.scheduler.isStarted ? "Scheduled" : "Stopped"}
                    </Badge>
                    {scrapingStatus?.scheduler.isRunning && (
                      <Badge variant="outline" className="border-blue-500/30 text-blue-300">
                        Running
                      </Badge>
                    )}
                    <ScraperRunOutcomeBadge outcome={scrapingStatus?.scheduler.lastRunOutcome} />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["Ready sources", scrapingStatus?.coverage.readySources ?? 0],
                      ["Fresh sources", scrapingStatus?.coverage.freshReadySources ?? 0],
                      ["Source-specific adapters", scrapingStatus?.coverage.configuredDedicatedAdapterSources ?? 0],
                      ["Generic adapters", (scrapingStatus?.coverage.configuredGenericRssAdapterSources ?? 0) + (scrapingStatus?.coverage.configuredGenericHtmlAdapterSources ?? 0)],
                      ["Fresh no-listing sources", scrapingStatus?.coverage.freshZeroListingSources ?? scraperSourceOutcomes.freshEmpty],
                      ["Fresh failed sources", scrapingStatus?.coverage.freshFailedLatestSources ?? scraperSourceOutcomes.freshFailed],
                      ["Fresh partial sources", scrapingStatus?.coverage.freshPartialLatestSources ?? scraperSourceOutcomes.freshPartial],
                      ["Historical source outcomes", scraperSourceOutcomes.staleOutcomes],
                      ["Registry sources", scrapingStatus?.coverage.registeredSources ?? 0],
                      ["Completed cycles", scrapingStatus?.scheduler.totalRunsCompleted ?? 0],
                      ["Clean cycles", scrapingStatus?.scheduler.totalSuccessfulRuns ?? 0],
                      ["Partial cycles", scrapingStatus?.scheduler.totalPartialRuns ?? 0],
                      ["Failed cycles", scrapingStatus?.scheduler.totalFailedRuns ?? 0],
                      ["Jobs saved", scrapingStatus?.scheduler.totalJobsScraped ?? 0],
                      ["Alert matches", scrapingStatus?.scheduler.lastJobAlertsProcessed ?? 0],
                      ["Concurrent source cap", scrapingStatus?.executionPolicy.maxConcurrentScrapes ?? 0],
                      ["Source timeout", `${Math.round((scrapingStatus?.executionPolicy.scrapeTimeoutMs ?? 0) / 1000)}s`],
                      ["Current attention signals", (scrapingStatus?.coverage.freshSourceIssues ?? scraperSourceOutcomes.freshIssues) + (scrapingStatus?.scheduler.errors.length ?? 0) + (scrapingStatus?.coverage.unavailableConfiguredSources ?? 0)],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                        <div className="text-xs text-slate-500">{label}</div>
                        <div className="mt-1 text-lg font-semibold text-white">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Last cycle</div>
                      <div className="mt-1 text-slate-200">
                        {scrapingStatus?.scheduler.lastRunAt
                          ? new Date(scrapingStatus.scheduler.lastRunAt).toLocaleString()
                          : "No recorded cycle"}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Next scheduled run</div>
                      <div className="mt-1 text-slate-200">
                        {scrapingStatus?.scheduler.nextRunAt
                          ? new Date(scrapingStatus.scheduler.nextRunAt).toLocaleString()
                          : "Not scheduled"}
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-xs leading-5 text-slate-500">
                    Adapter type describes the parser implementation, not verified production coverage. Use each source's health and latest outcome to assess discovery reliability.
                  </p>
                  {(scrapingStatus?.coverage.unconfiguredSources ?? 0) > 0 && (
                    <div data-testid="admin-scraping-coverage-gap" className="mt-4 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
                      <div className="font-medium">Source registry needs configuration</div>
                      <p className="mt-1 text-xs text-blue-200">
                        {scrapingStatus?.coverage.unconfiguredSources} registered source{scrapingStatus?.coverage.unconfiguredSources === 1 ? " is" : "s are"} not configured for this deployment. The scheduler only runs ready sources with durable provenance.
                      </p>
                    </div>
                  )}
                  {(scrapingStatus?.coverage.unavailableConfiguredSources ?? 0) > 0 && (
                    <div data-testid="admin-scraping-unavailable-sources" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <div className="font-medium">Configured sources need attention</div>
                      <p className="mt-1 text-xs text-amber-200">
                        {scrapingStatus?.coverage.unavailableConfiguredSources} active source{scrapingStatus?.coverage.unavailableConfiguredSources === 1 ? " is" : "s are"} configured but not ready. They are excluded from scheduling until initialization succeeds.
                      </p>
                    </div>
                  )}
                  {(scrapingStatus?.coverage.freshZeroListingSources ?? scraperSourceOutcomes.freshEmpty) > 0 && (
                    <div data-testid="admin-scraping-empty-sources" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <div className="font-medium">Source scans returned no listings</div>
                      <p className="mt-1 text-xs text-amber-200">
                        {scrapingStatus?.coverage.freshZeroListingSources ?? scraperSourceOutcomes.freshEmpty} active source{(scrapingStatus?.coverage.freshZeroListingSources ?? scraperSourceOutcomes.freshEmpty) === 1 ? " returned" : "s returned"} no listings in the last 24 hours. This is not a transport failure, but it is not evidence of current discovery coverage.
                      </p>
                    </div>
                  )}
                  {((scrapingStatus?.coverage.freshFailedLatestSources ?? scraperSourceOutcomes.freshFailed) + (scrapingStatus?.coverage.freshPartialLatestSources ?? scraperSourceOutcomes.freshPartial)) > 0 && (
                    <div data-testid="admin-scraping-outcome-issues" className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                      <div className="font-medium">Latest source outcomes need attention</div>
                      <p className="mt-1 text-xs text-red-200">
                        {scrapingStatus?.coverage.freshFailedLatestSources ?? scraperSourceOutcomes.freshFailed} failed and {scrapingStatus?.coverage.freshPartialLatestSources ?? scraperSourceOutcomes.freshPartial} partial source outcome{((scrapingStatus?.coverage.freshFailedLatestSources ?? scraperSourceOutcomes.freshFailed) + (scrapingStatus?.coverage.freshPartialLatestSources ?? scraperSourceOutcomes.freshPartial)) === 1 ? " was" : "s were"} recorded in the last 24 hours. Inspect the source health table before relying on full discovery coverage.
                      </p>
                    </div>
                  )}
                  {scrapingStatus?.scheduler.jobAlertRefreshFailed && (
                    <div data-testid="admin-scraping-alert-refresh-failed" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <div className="font-medium">Job alerts need refresh attention</div>
                      <p className="mt-1 text-xs text-amber-200">
                        The scrape completed, but internal job-alert matching could not refresh. Existing discovery results remain available and no external job-match notification was sent.
                      </p>
                    </div>
                  )}
                  {scrapingStatus?.scheduler.errors.length ? (
                    <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <div className="font-medium">Latest source issues</div>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-200">
                        {scrapingStatus.scheduler.errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="bg-slate-900/60 border-slate-800/50">
                <CardHeader>
                  <CardTitle className="text-base text-white">Runtime schedule</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="scraping-interval" className="text-slate-300">Interval (minutes)</Label>
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
                      <Label htmlFor="scraping-max-jobs" className="text-slate-300">Maximum jobs per run</Label>
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
                        Limit discovery to selected sources
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
                      {scrapingStatus?.scheduler.isStarted ? "Update schedule" : "Start schedule"}
                    </Button>
                    <Button
                      data-testid="admin-stop-scraping-scheduler"
                      variant="outline"
                      className="border-slate-700 text-slate-200"
                      disabled={!scrapingStatus?.scheduler.isStarted || startScrapingScheduler.isPending || stopScrapingScheduler.isPending || runScrapingNow.isPending}
                      onClick={() => stopScrapingScheduler.mutate()}
                    >
                      <Pause className="mr-2 h-4 w-4" />
                      Stop
                    </Button>
                    <Button
                      data-testid="admin-run-scraping-now"
                      variant="outline"
                      className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                      disabled={startScrapingScheduler.isPending || stopScrapingScheduler.isPending || runScrapingNow.isPending || scrapingStatus?.scheduler.isRunning}
                      onClick={() => runScrapingNow.mutate()}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Run discovery now
                    </Button>
                  </div>
                  <div className="text-xs text-slate-500">
                    Current: every {scrapingStatus?.scheduler.intervalMinutes ?? 60} minutes, up to {scrapingStatus?.scheduler.maxJobsPerRun ?? 100} jobs per run.
                    {scrapingStatus?.scheduler.enabledPlatforms?.length
                      ? ` Restricted to ${scrapingStatus.scheduler.enabledPlatforms.length} selected source${scrapingStatus.scheduler.enabledPlatforms.length === 1 ? "" : "s"}.`
                      : " All active configured sources are included."}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="mt-4 bg-slate-900/60 border-slate-800/50">
              <CardHeader>
                <CardTitle className="text-base text-white">Active source health</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 pr-4 text-left">Source</th>
                        <th className="py-2 pr-4 text-left">Adapter</th>
                        <th className="py-2 pr-4 text-left">Readiness</th>
                        <th className="py-2 pr-4 text-left">Latest outcome</th>
                        <th className="py-2 pr-4 text-left">Freshness</th>
                        <th className="py-2 pr-4 text-left">Listings</th>
                        <th className="py-2 pr-4 text-left">Last attempt</th>
                        <th className="py-2 text-left">Last successful scrape</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scrapingStatus?.platforms.map((platform) => {
                        const sourceHealth = getScraperSourceHealthSummary(platform);
                        return (
                        <tr key={platform.id} className="border-b border-slate-800/50">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{platform.name}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{platform.tier} · {platform.category || "General"}</div>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge
                              variant="outline"
                              className={platform.adapter.kind === "dedicated"
                                ? "border-blue-500/30 text-blue-300"
                                : "border-slate-600 text-slate-300"}
                            >
                              {platform.adapter.label}
                            </Badge>
                            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{platform.adapter.detail}</p>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant="outline" className={platform.readiness === "ready" ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}>
                              {platform.readiness === "ready" ? "Ready" : "Unavailable"}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant="outline" className={sourceHealth.tone}>{sourceHealth.label}</Badge>
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
                                ? "Fresh"
                                : platform.freshness === "stale"
                                  ? "Stale"
                                  : "Awaiting scan"}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4 text-slate-300">
                            {sourceHealth.jobCount === null ? "No recorded run" : sourceHealth.jobCount}
                          </td>
                          <td className="py-3 pr-4 text-slate-300">
                            {platform.lastScrapeAttemptedAt ? new Date(platform.lastScrapeAttemptedAt).toLocaleString() : "No recorded attempt"}
                          </td>
                          <td className="py-3 text-slate-300">
                            {platform.lastScraped ? new Date(platform.lastScraped).toLocaleString() : "Awaiting first successful scrape"}
                          </td>
                        </tr>
                      );
                      })}
                      {(!scrapingStatus || scrapingStatus.platforms.length === 0) && (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">No active configured scraper sources.</td>
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
                <CardTitle className="text-white text-base">All Success Fees</CardTitle>
                {(operatingCounts?.feesTotal ?? 0) > (fees?.length ?? 0) && (
                  <p className="text-xs text-slate-400">Showing the newest 100 of {operatingCounts?.feesTotal} success fees.</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="text-left py-2 pr-4">User</th>
                        <th className="text-left py-2 pr-4">Employer / Role</th>
                        <th className="text-left py-2 pr-4">Salary</th>
                        <th className="text-left py-2 pr-4">Monthly Fee</th>
                        <th className="text-left py-2 pr-4">Status</th>
                        <th className="text-left py-2 pr-4">Next Verification</th>
                        <th className="text-left py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fees?.map((fee) => (
                        <tr key={fee.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{fee.userName ?? "Unknown"}</div>
                            <div className="text-xs text-slate-500">{fee.userEmail ?? "—"}</div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="text-white">{fee.employerName}</div>
                            <div className="text-xs text-slate-500">{fee.jobTitle}</div>
                          </td>
                          <td className="py-3 pr-4 text-slate-300">
                            ${fee.monthlySalary.toLocaleString()}/mo
                          </td>
                          <td className="py-3 pr-4 text-cyan-400 font-medium">
                            {formatCurrency(fee.monthlyFeeAmount, fee.currency)}/mo
                          </td>
                          <td className="py-3 pr-4">
                            <StatusBadge status={fee.status} />
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
                                Status
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-orange-400 hover:text-orange-300 px-2"
                                onClick={() => {
                                  setEscalateDialog({ open: true, feeId: fee.id, userName: fee.userName ?? "Unknown" });
                                }}
                              >
                                <Gavel className="h-3 w-3 mr-1" />
                                Escalate
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-slate-400 hover:text-white px-2"
                                onClick={() => setNoteDialog({ open: true, feeId: fee.id })}
                              >
                                Note
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(!fees || fees.length === 0) && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No success fees found.
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
                  Overdue Verifications
                </CardTitle>
                {(operatingCounts?.overdueVerifications ?? 0) > (overdue?.length ?? 0) && (
                  <p className="text-xs text-slate-400">Showing the 100 oldest of {operatingCounts?.overdueVerifications} overdue records.</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="text-left py-2 pr-4">User</th>
                        <th className="text-left py-2 pr-4">Employer / Role</th>
                        <th className="text-left py-2 pr-4">Monthly Fee</th>
                        <th className="text-left py-2 pr-4">Days Overdue</th>
                        <th className="text-left py-2 pr-4">Grace Expired</th>
                        <th className="text-left py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overdue?.map((fee) => (
                        <tr key={fee.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{fee.userName ?? "Unknown"}</div>
                            <div className="text-xs text-slate-500">{fee.userEmail ?? "—"}</div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="text-white">{fee.employerName}</div>
                            <div className="text-xs text-slate-500">{fee.jobTitle}</div>
                          </td>
                          <td className="py-3 pr-4 text-cyan-400">
                            {formatCurrency(fee.monthlyFeeAmount)}/mo
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`font-bold ${fee.daysOverdue > 14 ? "text-red-400" : "text-orange-400"}`}>
                              {fee.daysOverdue} days
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            {fee.graceExpired ? (
                              <span className="text-red-400 font-medium">Yes — Suspend</span>
                            ) : (
                              <span className="text-yellow-400">No — In Grace</span>
                            )}
                          </td>
                          <td className="py-3">
                            <div className="flex gap-1">
                              {fee.graceExpired && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs text-red-400 hover:text-red-300 px-2"
                                  onClick={() => updateStatus.mutate({ feeId: fee.id, status: "suspended", notes: `Auto-suspended: verification overdue by ${fee.daysOverdue} days` })}
                                >
                                  <Ban className="h-3 w-3 mr-1" />
                                  Suspend
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-orange-400 hover:text-orange-300 px-2"
                                onClick={() => setEscalateDialog({ open: true, feeId: fee.id, userName: fee.userName ?? "Unknown" })}
                              >
                                <Gavel className="h-3 w-3 mr-1" />
                                Escalate
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(!overdue || overdue.length === 0) && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500">
                            No overdue verifications.
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
                  Pending Verification Reviews
                </CardTitle>
                {(operatingCounts?.pendingVerifications ?? 0) > (pendingVerifications?.length ?? 0) && (
                  <p className="text-xs text-slate-400">Showing the newest 100 of {operatingCounts?.pendingVerifications} pending verifications.</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {pendingVerifications?.map((v) => (
                    <div key={v.id} className="border border-slate-800 rounded-lg p-4 bg-slate-900/40">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-white">{v.userName ?? "Unknown"}</span>
                            <StatusBadge status={v.verificationType ?? "initial"} />
                            <StatusBadge status={v.documentType ?? "other"} />
                          </div>
                          <div className="text-sm text-slate-400">
                            {v.employerName} — {v.jobTitle}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Submitted: {formatDate(v.submittedAt)} · Salary: ${v.monthlySalary?.toLocaleString()}/mo
                          </div>
                          {v.hasDocument && (
                            <button
                              type="button"
                              onClick={() => verificationDocumentDownload.mutate({ verificationId: v.id })}
                              disabled={verificationDocumentDownload.isPending && verificationDocumentDownload.variables?.verificationId === v.id}
                              className="text-xs text-cyan-400 hover:text-cyan-300 mt-1 inline-flex items-center gap-1"
                            >
                              <FileText className="h-3 w-3" />
                              View Document
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
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-500/50 text-red-400 hover:bg-red-500/10 h-8"
                            onClick={() => reviewVerification.mutate({ verificationId: v.id, approved: false, notes: "Document insufficient or invalid" })}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!pendingVerifications || pendingVerifications.length === 0) && (
                    <div className="py-8 text-center text-slate-500">
                      No pending verifications.
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
                  Operating Review Queue
                </CardTitle>
                {(operatingCounts?.reviewTotal ?? 0) > (reviewQueue?.length ?? 0) && (
                  <p className="text-xs text-slate-400">Showing the newest 100 of {operatingCounts?.reviewTotal} open reviews.</p>
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
                                <span className="text-xs text-slate-500">{item.entityType} #{item.entityId}</span>
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
                                      Manual decision
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
                                User #{item.userId} - Created {formatDate(item.createdAt)}
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
                                Evidence
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
                                {item.category === "privacy_deletion" ? "Record review" : "Resolve"}
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
                                {item.category === "privacy_deletion" ? "Close request" : "Dismiss"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ))}
                  {(!reviewQueue || reviewQueue.length === 0) && (
                    <div className="py-8 text-center text-slate-500">
                      No open review items.
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
                  Payment History
                </CardTitle>
                {(operatingCounts?.paymentsTotal ?? 0) > (payments?.length ?? 0) && (
                  <p className="text-xs text-slate-400">Showing the newest 50 of {operatingCounts?.paymentsTotal} payments.</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="text-left py-2 pr-4">User</th>
                        <th className="text-left py-2 pr-4">Employer</th>
                        <th className="text-left py-2 pr-4">Amount</th>
                        <th className="text-left py-2 pr-4">Status</th>
                        <th className="text-left py-2 pr-4">Period</th>
                        <th className="text-left py-2">Paid At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments?.map((p) => (
                        <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{p.userName ?? "Unknown"}</div>
                            <div className="text-xs text-slate-500">{p.userEmail ?? "—"}</div>
                          </td>
                          <td className="py-3 pr-4 text-slate-300">{p.employerName ?? "—"}</td>
                          <td className="py-3 pr-4 text-green-400 font-medium">
                            {formatCurrency(p.amount, p.currency)}
                          </td>
                          <td className="py-3 pr-4">
                            <StatusBadge status={p.status} />
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
                            No payments recorded yet.
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
                ? reviewDialog.status === "resolved" ? "Record Privacy Review" : "Close Privacy Request"
                : reviewDialog.status === "resolved" ? "Resolve Review Item" : "Dismiss Review Item"}
            </DialogTitle>
          </DialogHeader>
          {isPrivacyDeletionDialog ? (
            <p className="text-sm text-amber-200/80">
              A resolved decision records an itemized, restart-safe execution plan. Planning does not delete account data, revoke providers, or override an active legal hold.
            </p>
          ) : null}
          <div>
            <Label className="text-slate-300">Resolution Note</Label>
            <Textarea
              value={reviewResolution}
              onChange={(e) => setReviewResolution(e.target.value)}
              placeholder={isPrivacyDeletionDialog
                ? "Record the retention basis, data eligible for erasure, and the separate execution work required..."
                : "Describe what was reviewed and why this item can be closed..."}
              className="bg-slate-800 border-slate-700 text-white mt-1"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewDialog({ open: false, itemId: null, status: "resolved" })}>Cancel</Button>
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
                ? reviewDialog.status === "resolved" ? "Record and plan" : "Close request"
                : reviewDialog.status === "resolved" ? "Resolve" : "Dismiss"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Change Dialog */}
      <Dialog open={statusDialog.open} onOpenChange={(o) => !o && setStatusDialog({ open: false, feeId: null, currentStatus: "" })}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>Update Fee Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-slate-300">New Status</Label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white text-sm"
              >
                {["pending_verification", "active", "paused", "ended", "suspended", "disputed"].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-slate-300">Note (optional)</Label>
              <Textarea
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder="Reason for status change..."
                className="bg-slate-800 border-slate-700 text-white mt-1"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStatusDialog({ open: false, feeId: null, currentStatus: "" })}>Cancel</Button>
            <Button
              className="bg-cyan-600 hover:bg-cyan-700"
              disabled={updateStatus.isPending}
              onClick={() => {
                if (statusDialog.feeId) {
                  updateStatus.mutate({ feeId: statusDialog.feeId, status: newStatus as any, notes: statusNote || undefined });
                }
              }}
            >
              Update Status
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
              Flag for Legal Escalation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              This will mark <span className="text-white font-medium">{escalateDialog.userName}</span>'s account as disputed and suspend it. This action is logged and cannot be undone without manual review.
            </p>
            <div>
              <Label className="text-slate-300">Reason for Escalation</Label>
              <Textarea
                value={escalateReason}
                onChange={(e) => setEscalateReason(e.target.value)}
                placeholder="Describe the non-compliance or reason for legal escalation..."
                className="bg-slate-800 border-slate-700 text-white mt-1"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEscalateDialog({ open: false, feeId: null, userName: "" })}>Cancel</Button>
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
              Confirm Escalation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Note Dialog */}
      <Dialog open={noteDialog.open} onOpenChange={(o) => !o && setNoteDialog({ open: false, feeId: null })}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>Add Admin Note</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-slate-300">Note</Label>
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add an internal note..."
              className="bg-slate-800 border-slate-700 text-white mt-1"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNoteDialog({ open: false, feeId: null })}>Cancel</Button>
            <Button
              className="bg-cyan-600 hover:bg-cyan-700"
              disabled={!noteText.trim() || addNote.isPending}
              onClick={() => {
                if (noteDialog.feeId) {
                  addNote.mutate({ feeId: noteDialog.feeId, note: noteText });
                }
              }}
            >
              Save Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
