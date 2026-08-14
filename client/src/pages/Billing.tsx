import { useMemo, useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportHireDialog } from "@/components/ReportHireDialog";
import {
  getEmploymentEndCompletionSummary,
  getEmploymentEndControlSummary,
  type EmploymentEndReportResultLike,
} from "@/lib/employmentEndControl";
import { getSuccessFeeComplianceAction, getSuccessFeeComplianceSummaryFromAggregates, type SuccessFeeComplianceRisk } from "@/lib/successFeeCompliance";
import { openExternalUrl } from "@/lib/externalUrl";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useLocale, type TranslationKey } from "@/contexts/LocaleContext";
import { formatBillingCalendarDate, formatBillingCurrency, formatBillingDate, formatBillingSalary, getLocalCalendarDate } from "@/lib/billingPresentation";
import { getVerificationUploadMimeType, validateVerificationUpload, VERIFICATION_UPLOAD_ACCEPT } from "@shared/documentUploads";
import { readFileAsBase64 } from "@/lib/documentUpload";
import {
  DollarSign, FileText, CheckCircle, Clock, AlertTriangle,
  XCircle, Upload, ExternalLink, RefreshCw, Briefcase, Calendar, Shield, ClipboardCheck, PartyPopper
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const map: Record<string, { labelKey: TranslationKey; className: string }> = {
    pending_verification: { labelKey: "pendingVerification", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    active: { labelKey: "active", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    paused: { labelKey: "paused", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
    ended: { labelKey: "ended", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
    suspended: { labelKey: "suspended", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    disputed: { labelKey: "disputed", className: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  };
  const cfg = map[status];
  return <Badge className={`text-xs border ${cfg?.className ?? "bg-gray-500/20 text-gray-400"}`}>{cfg ? t(cfg.labelKey) : status}</Badge>;
}

function PaymentStatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const map: Record<string, { labelKey: TranslationKey; className: string }> = {
    paid: { labelKey: "paid", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    pending: { labelKey: "pending", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    failed: { labelKey: "failed", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    refunded: { labelKey: "refunded", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  };
  const cfg = map[status];
  return <Badge className={`text-xs border ${cfg?.className ?? "bg-gray-500/20 text-gray-400"}`}>{cfg ? t(cfg.labelKey) : status}</Badge>;
}

function ComplianceRiskBadge({ risk }: { risk: SuccessFeeComplianceRisk }) {
  const { t } = useLocale();
  const map: Record<SuccessFeeComplianceRisk, string> = {
    low: "border-green-500/30 bg-green-500/10 text-green-300",
    medium: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
    high: "border-orange-500/30 bg-orange-500/10 text-orange-300",
    critical: "border-red-500/30 bg-red-500/10 text-red-300",
  };
  const labelKey: Record<SuccessFeeComplianceRisk, TranslationKey> = {
    low: "severityLow", medium: "severityMedium", high: "severityHigh", critical: "severityCritical",
  };
  return <Badge className={`text-xs border ${map[risk]}`}>{t(labelKey[risk])}</Badge>;
}

function ComplianceStatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const map: Record<string, { labelKey: TranslationKey; className: string }> = {
    needs_attention: { labelKey: "needsAttention", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    due_soon: { labelKey: "verificationDue", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    clear: { labelKey: "current", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    none: { labelKey: "noActiveFee", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
  };
  const cfg = map[status];
  return <Badge className={`text-xs border ${cfg?.className ?? "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>{cfg ? t(cfg.labelKey) : status}</Badge>;
}

interface VerificationUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  successFeeId: number;
  onSuccess: () => void;
}

function VerificationUploadDialog({ open, onOpenChange, successFeeId, onSuccess }: VerificationUploadDialogProps) {
  const { t } = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>("");
  const [documentType, setDocumentType] = useState<"paystub" | "employment_letter" | "bank_statement" | "other">("paystub");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileReadIdRef = useRef(0);

  const submitVerification = trpc.successFees.submitVerification.useMutation({
    onSuccess: () => {
      toast.success(t("verificationSubmitted"));
      fileReadIdRef.current += 1;
      setFile(null);
      setFileBase64("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message || t("verificationSubmitFailed")),
  });

  const resetUpload = () => {
    fileReadIdRef.current += 1;
    setFile(null);
    setFileBase64("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetUpload();
    onOpenChange(nextOpen);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const readId = ++fileReadIdRef.current;
    setFile(null);
    setFileBase64("");
    const validationError = validateVerificationUpload(f);
    if (validationError) {
      toast.error(validationError);
      e.target.value = "";
      return;
    }
    try {
      const base64 = await readFileAsBase64(f);
      if (readId !== fileReadIdRef.current) return;
      setFile(f);
      setFileBase64(base64);
    } catch (error) {
      if (readId === fileReadIdRef.current) {
        toast.error(error instanceof Error ? error.message : t("fileReadFailed"));
        e.target.value = "";
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md bg-[#0d1117] border-[#21262d] text-white">
        <DialogHeader>
          <DialogTitle>{t("submitVerificationDocument")}</DialogTitle>
          <DialogDescription className="text-gray-400">
            {t("verificationDocumentDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-gray-300">{t("documentType")}</Label>
            <Select value={documentType} onValueChange={(v) => setDocumentType(v as typeof documentType)}>
              <SelectTrigger className="bg-[#161b22] border-[#30363d] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#161b22] border-[#30363d]">
                <SelectItem value="paystub">{t("paystub")}</SelectItem>
                <SelectItem value="employment_letter">{t("employmentLetter")}</SelectItem>
                <SelectItem value="bank_statement">{t("bankStatement")}</SelectItem>
                <SelectItem value="other">{t("otherLabel")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div
            className="border-2 border-dashed border-[#30363d] rounded-lg p-4 text-center cursor-pointer hover:border-cyan-500/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? (
              <div className="flex items-center justify-center gap-2 text-green-400">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm">{file.name}</span>
              </div>
            ) : (
              <div className="text-gray-500">
                <Upload className="w-6 h-6 mx-auto mb-1" />
                <p className="text-sm">{t("clickToUploadDocument")}</p>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept={VERIFICATION_UPLOAD_ACCEPT} onChange={handleFileChange} className="hidden" />

          <Button
            onClick={() => submitVerification.mutate({ successFeeId, documentBase64: fileBase64, documentType, documentFileName: file!.name, documentMimeType: getVerificationUploadMimeType(file!)! })}
            disabled={!file || !fileBase64 || submitVerification.isPending}
            className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
          >
            {submitVerification.isPending ? t("uploading") : t("submitVerification")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Billing() {
  const { user, loading: authLoading } = useAuth();
  const { locale, t } = useLocale();
  const [, setLocation] = useLocation();
  const [reportHireOpen, setReportHireOpen] = useState(false);
  const [reportHireApplicationId, setReportHireApplicationId] = useState<number | undefined>(undefined);
  const [verifyDialogFeeId, setVerifyDialogFeeId] = useState<number | null>(null);
  const [employmentEndFeeId, setEmploymentEndFeeId] = useState<number | null>(null);
  const [employmentEndDate, setEmploymentEndDate] = useState(getLocalCalendarDate);
  const [employmentEndResult, setEmploymentEndResult] = useState<EmploymentEndReportResultLike | null>(null);

  const {
    data: feePages,
    refetch: refetchFees,
    fetchNextPage: fetchNextFeePage,
    hasNextPage: hasNextFeePage,
    isFetchingNextPage: isFetchingNextFeePage,
  } = trpc.successFees.listMyFeePage.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined }
  );
  const fees = useMemo(() => feePages?.pages.flatMap((page) => page.items) ?? [], [feePages]);
  const { data: feeSummary } = trpc.successFees.getMyFeeSummary.useQuery();
  const {
    data: paymentPages,
    fetchNextPage: fetchNextPaymentPage,
    hasNextPage: hasNextPaymentPage,
    isFetchingNextPage: isFetchingNextPaymentPage,
  } = trpc.successFees.getPaymentPage.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined }
  );
  const payments = useMemo(
    () => paymentPages?.pages.flatMap((page) => page.items) ?? [],
    [paymentPages]
  );
  const { data: paymentSummary } = trpc.successFees.getPaymentSummary.useQuery();
  const { data: offerAttributionReviewPage } = trpc.successFees.getOfferAttributionReviewPage.useQuery({ limit: 25 });
  const offerAttributionReviews = offerAttributionReviewPage?.items ?? [];

  const reportEmploymentEnded = trpc.successFees.reportEmploymentEnded.useMutation({
    onSuccess: (data) => {
      setEmploymentEndResult(data);
      toast.success(t("employmentEndRecorded"));
      refetchFees();
    },
    onError: (err) => toast.error(err.message || t("employmentEndReportFailed")),
  });

  const retryBillingCheckout = trpc.successFees.retryBillingCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        if (!openExternalUrl(data.checkoutUrl)) {
          toast.error(t("invalidCheckoutUrl"));
          return;
        }
      }
      toast.success(t("checkoutOpened"));
      refetchFees();
    },
    onError: (err) => toast.error(err.message || t("checkoutOpenFailed")),
  });

  const getBillingPortal = trpc.successFees.getBillingPortalUrl.useMutation({
    onSuccess: (data) => {
      if (!openExternalUrl(data.url)) toast.error(t("invalidBillingPortalUrl"));
    },
    onError: (err) => toast.error(err.message || t("billingPortalOpenFailed")),
  });

  const offerLetterDownload = trpc.successFees.getOfferLetterDownloadUrl.useMutation({
    onSuccess: (data) => {
      if (!openExternalUrl(data.url)) toast.error(t("invalidOfferLetterUrl"));
    },
    onError: (err) => toast.error(err.message || t("offerLetterOpenFailed")),
  });

  const activeFees = fees.filter(f => ["active", "pending_verification"].includes(f.status));
  const paidByCurrency = paymentSummary?.paidByCurrency ?? [];
  const monthlyByCurrency = paymentSummary?.monthlyByCurrency ?? [];
  const complianceSummary = getSuccessFeeComplianceSummaryFromAggregates(
    feeSummary ?? {
      activeFees: 0,
      suspendedFees: 0,
      pausedFees: 0,
      disputedFees: 0,
      pendingVerification: 0,
      overdueVerifications: 0,
      dueSoonVerifications: 0,
      monthlyFeeCents: 0,
      nextVerificationDue: null,
    },
    offerAttributionReviews.length
  );
  const complianceAction = getSuccessFeeComplianceAction(complianceSummary);
  const complianceCopy = {
    review_offer_attribution: ["offerAttributionReview", "offerAttributionReviewDetail", "openReviewQueue"],
    resolve_disputed_fee: ["successFeeDisputeReview", "successFeeDisputeReviewDetail", "reviewBilling"],
    resolve_suspended_payment: ["paymentRecoveryRequired", "paymentRecoveryDetail", "reviewBilling"],
    review_paused_billing: ["pausedBillingReview", "pausedBillingReviewDetail", "reviewBilling"],
    submit_verification: ["verificationOverdue", "verificationOverdueDetail", "submitVerification"],
    prepare_verification: ["verificationPending", "verificationPendingDetail", "reviewFees"],
    monitor: ["complianceCurrent", "complianceCurrentDetail", "viewFees"],
    report_hire: ["noActiveSuccessFee", "noActiveSuccessFeeDetail", "reportAcceptedHire"],
  } satisfies Record<typeof complianceAction.id, [TranslationKey, TranslationKey, TranslationKey]>;
  const [complianceLabelKey, complianceDetailKey, complianceCtaKey] = complianceCopy[complianceAction.id];
  const employmentEndFee = employmentEndFeeId
    ? fees.find((fee) => fee.id === employmentEndFeeId) ?? null
    : null;
  const employmentEndControl = getEmploymentEndControlSummary(employmentEndFee, employmentEndDate);
  const employmentEndCompletion = employmentEndResult
    ? getEmploymentEndCompletionSummary(employmentEndResult)
    : null;
  const employmentEndHasSubscription = Boolean(employmentEndFee?.stripeSubscriptionId);
  const employmentEndControlCheckpointKeys: TranslationKey[] = [
    "employmentEndCheckpointDate",
    employmentEndHasSubscription ? "employmentEndCheckpointStripe" : "employmentEndCheckpointNoStripe",
    "employmentEndCheckpointStatus",
    "employmentEndCheckpointAudit",
  ];
  const employmentEndCompletionCheckpointKeys: TranslationKey[] = [
    "employmentEndCompleteStatus",
    employmentEndResult?.stripeSubscriptionCancelled ? "employmentEndCompleteStripe" : "employmentEndCompleteNoStripe",
    "employmentEndCompleteAudit",
    "employmentEndCompleteReview",
  ];

  const openEmploymentEndDialog = (feeId: number) => {
    setEmploymentEndFeeId(feeId);
    setEmploymentEndDate(getLocalCalendarDate());
    setEmploymentEndResult(null);
  };

  const closeEmploymentEndDialog = () => {
    setEmploymentEndFeeId(null);
    setEmploymentEndResult(null);
  };

  const handleComplianceAction = () => {
    if (complianceAction.id === "report_hire") {
      setReportHireApplicationId(undefined);
      setReportHireOpen(true);
      return;
    }

    if (complianceAction.id === "submit_verification") {
      const targetFee = fees.find((fee) => {
        if (!["active", "pending_verification"].includes(fee.status)) return false;
        if (!fee.nextVerificationDue) return false;
        return new Date(fee.nextVerificationDue).getTime() <= Date.now();
      }) || feeSummary?.actionableFee || activeFees[0];

      if (targetFee) {
        setVerifyDialogFeeId(targetFee.id);
        return;
      }
    }

    if (complianceAction.route !== "/billing") {
      setLocation(complianceAction.route);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-white">
        <p>{t("signInForBilling")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">{t("billingSuccessFees")}</h1>
            <p className="text-gray-400 mt-1">{t("billingDescription")}</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            {fees.some(f => f.stripeSubscriptionId) && (
              <Button
                variant="outline"
                onClick={() => getBillingPortal.mutate()}
                disabled={getBillingPortal.isPending}
                className="flex-1 border-[#30363d] text-gray-300 hover:bg-[#21262d] gap-1.5 sm:flex-none"
              >
                <ExternalLink className="w-4 h-4" /> {t("billingPortal")}
              </Button>
            )}
            <Button
              onClick={() => {
                setReportHireApplicationId(undefined);
                setReportHireOpen(true);
              }}
              className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-semibold gap-1.5 sm:flex-none"
            >
              <PartyPopper className="h-4 w-4" /> {t("reportHire")}
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-3">
          <Card className="bg-[#161b22] border-[#21262d]">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase className="w-4 h-4 text-cyan-400" />
                <span className="text-gray-400 text-sm">{t("activeFees")}</span>
              </div>
              <p className="text-2xl font-bold text-white">{feeSummary?.activeFees ?? 0}</p>
            </CardContent>
          </Card>
          <Card className="bg-[#161b22] border-[#21262d]">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-cyan-400" />
                <span className="text-gray-400 text-sm">{t("monthlyFees")}</span>
              </div>
              <div className="space-y-1">
                {monthlyByCurrency.length > 0 ? monthlyByCurrency.map((total, index) => (
                  <p key={total.currency} className={index === 0 ? "text-2xl font-bold text-white" : "text-sm font-semibold text-gray-300"}>
                    {formatBillingCurrency(total.totalCents, total.currency, locale)}
                  </p>
                )) : (
                  <p className="text-2xl font-bold text-white">{formatBillingCurrency(0, "USD", locale)}</p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#161b22] border-[#21262d]">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-gray-400 text-sm">{t("totalPaid")}</span>
              </div>
              <div className="space-y-1">
                {paidByCurrency.length > 0 ? paidByCurrency.map((total, index) => (
                  <p key={total.currency} className={index === 0 ? "text-2xl font-bold text-white" : "text-sm font-semibold text-gray-300"}>
                    {formatBillingCurrency(total.totalCents, total.currency, locale)}
                  </p>
                )) : (
                  <p className="text-2xl font-bold text-white">{formatBillingCurrency(0, "USD", locale)}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card data-testid="billing-compliance-control" className="bg-[#161b22] border-cyan-500/30 mb-6">
          <CardHeader>
            <CardTitle className="text-white flex flex-wrap items-center gap-2">
              <Shield className="h-4 w-4 text-cyan-300" />
              {t("successFeeOperatingControl")}
              <ComplianceStatusBadge status={complianceSummary.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-cyan-200">{t(complianceLabelKey)}</p>
                  <ComplianceRiskBadge risk={complianceAction.risk} />
                  <Badge className="border-[#30363d] bg-[#0d1117] text-gray-300">
                    {complianceAction.approvalGated ? t("billingApprovalGated") : t("internalAction")}
                  </Badge>
                  {complianceAction.proofRequired && (
                    <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                      {t("proofRequired")}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-400">{t(complianceDetailKey)}</p>
                <p className="mt-2 text-xs text-gray-500">{t(`successFeeNextAction_${complianceAction.id}` as TranslationKey)}</p>
              </div>
              <Button
                data-testid="billing-compliance-primary"
                variant="outline"
                className="border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10"
                onClick={handleComplianceAction}
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                {t(complianceCtaKey)}
              </Button>
            </div>

            <div className="grid gap-2 text-xs text-gray-400 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [t("offerReviews"), complianceSummary.pendingOfferAttributions],
                [t("suspended"), complianceSummary.suspendedFees],
                [t("paused"), complianceSummary.pausedFees],
                [t("disputed"), complianceSummary.disputedFees],
                [t("pendingProof"), complianceSummary.pendingVerification],
                [t("overdue"), complianceSummary.overdueVerifications],
                [t("dueSoon"), complianceSummary.dueSoonVerifications],
                [
                  t("nextDue"),
                  complianceSummary.nextVerificationDue
                    ? formatBillingCalendarDate(complianceSummary.nextVerificationDue, locale)
                    : t("noneLabel"),
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-[#30363d] bg-[#0d1117] p-3">
                  <p className="text-gray-500">{label}</p>
                  <p className="mt-1 font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* How It Works */}
        <Card className="bg-[#161b22] border-[#21262d] mb-6">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-cyan-400 mb-2">{t("howSuccessFeesWork")}</p>
            <div className="grid grid-cols-1 gap-4 text-xs text-gray-400 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-white font-medium">{t("successFeeStepOne")}</span>
                <span>{t("successFeeStepOneDescription")}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-white font-medium">{t("successFeeStepTwo")}</span>
                <span>{t("successFeeStepTwoDescription")}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-white font-medium">{t("successFeeStepThree")}</span>
                <span>{t("successFeeStepThreeDescription")}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {offerAttributionReviews.length > 0 && (
          <Card className="bg-[#161b22] border-amber-500/30 mb-6">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                {t("offerAttributionReviews")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {offerAttributionReviews.map((review) => {
                const application = review.application as any;
                const response = review.latestEmployerResponse;
                const job = application?.job;
                const applicationId = review.approval.applicationId ?? application?.id;

                return (
                  <div key={review.approval.id} className="rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                            {review.approval.riskLevel}
                          </Badge>
                          <span className="text-sm text-gray-400">{t("pendingSuccessFeeAttribution")}</span>
                        </div>
                        <p className="mt-2 font-medium text-white">
                          {job?.title || t("applicationLabel")}{job?.company ? ` ${t("atCompany", { company: job.company })}` : ""}
                        </p>
                        {response?.summary ? (
                          <p className="mt-1 text-sm text-gray-400">{response.summary}</p>
                        ) : review.approval.description ? (
                          <p className="mt-1 text-sm text-gray-400">{review.approval.description}</p>
                        ) : null}
                        <p className="mt-2 text-xs text-gray-500">
                          {t("approvalNumber", { id: review.approval.id })}
                          {response?.receivedAt ? ` - ${t("responseReceived", { date: formatBillingDate(response.receivedAt, locale) })}` : ""}
                        </p>
                      </div>
                      <Button
                        className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                        onClick={() => {
                          setReportHireApplicationId(applicationId ?? undefined);
                          setReportHireOpen(true);
                        }}
                      >
                        {t("reportHire")}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {offerAttributionReviewPage?.hasMore && (
                <div className="flex flex-col gap-2 border-t border-amber-500/20 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-amber-200">
                    {t("showingPendingReviews", { shown: 25, total: offerAttributionReviewPage.total })}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-amber-500/30 text-amber-200 hover:bg-amber-500/10"
                    onClick={() => setLocation("/applications")}
                  >
                    <Briefcase className="mr-2 h-4 w-4" />
                    {t("openApplications")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Active Success Fees */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">{t("successFeeArrangements")}</h2>
          {fees.length === 0 ? (
            <Card className="bg-[#161b22] border-[#21262d]">
              <CardContent className="p-8 text-center">
                <Briefcase className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 font-medium">{t("noSuccessFees")}</p>
                <p className="text-gray-500 text-sm mt-1">{t("noSuccessFeesDescription")}</p>
                <Button
                  onClick={() => {
                    setReportHireApplicationId(undefined);
                    setReportHireOpen(true);
                  }}
                  className="mt-4 bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  {t("gotHired")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {fees.map(fee => {
                const isVerificationDue = fee.nextVerificationDue && new Date(fee.nextVerificationDue) < new Date();
                const needsBillingCheckout = fee.status === "pending_verification" && !fee.stripeSubscriptionId;
                const daysUntilVerification = fee.nextVerificationDue
                  ? Math.ceil((new Date(fee.nextVerificationDue).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : null;

                return (
                  <Card key={fee.id} className="bg-[#161b22] border-[#21262d]">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="font-semibold text-white">{fee.jobTitle}</p>
                            <StatusBadge status={fee.status} />
                          </div>
                          <p className="text-gray-400 text-sm">{fee.employerName}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-cyan-400 font-bold">{formatBillingCurrency(fee.monthlyFeeAmount, fee.currency, locale)}<span className="text-gray-500 text-xs font-normal">{t("perMonth")}</span></p>
                          <p className="text-gray-500 text-xs">{t("percentOfSalary", { percent: fee.feePercent, salary: formatBillingSalary(fee.monthlySalary, fee.currency, locale) })}</p>
                        </div>
                      </div>

                      {/* Verification status */}
                      {fee.status === "active" && daysUntilVerification !== null && (
                        <div className={`flex items-center gap-2 text-xs p-2 rounded mb-3 ${isVerificationDue ? "bg-red-500/10 text-red-400 border border-red-500/20" : daysUntilVerification <= 14 ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20" : "bg-[#0d1117] text-gray-500"}`}>
                          {isVerificationDue ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                          {isVerificationDue
                            ? t("verificationOverdueWarning")
                            : daysUntilVerification <= 14
                            ? t("verificationDueInDays", { count: daysUntilVerification })
                            : t("nextVerificationDate", { date: formatBillingCalendarDate(fee.nextVerificationDue!, locale) })}
                        </div>
                      )}

                      {fee.status === "pending_verification" && (
                        <div className="flex items-center gap-2 text-xs p-2 rounded mb-3 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          <Clock className="w-3.5 h-3.5" />
                          {t("offerLetterUnderReview")}
                        </div>
                      )}

                      {needsBillingCheckout && (
                        <div className="mb-3 flex flex-col gap-2 rounded border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 text-cyan-100">
                            <p className="font-medium">{t("secureBillingRequired")}</p>
                            <p className="mt-1 text-cyan-100/70">{t("secureBillingDescription")}</p>
                          </div>
                          <Button
                            size="sm"
                            data-testid="retry-success-fee-checkout"
                            onClick={() => retryBillingCheckout.mutate({ successFeeId: fee.id, confirmBillingSetup: true })}
                            disabled={retryBillingCheckout.isPending}
                            className="shrink-0 bg-cyan-500 text-xs font-semibold text-black hover:bg-cyan-600"
                          >
                            <ExternalLink className="mr-1 h-3 w-3" />
                            {retryBillingCheckout.isPending ? t("opening") : t("openStripeCheckout")}
                          </Button>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                        <Calendar className="w-3.5 h-3.5" />
                        {t("startedDate", { date: formatBillingCalendarDate(fee.startDate, locale) })}
                        {fee.hasOfferLetter && (
                          <>
                            <span className="text-gray-600" aria-hidden="true">&middot;</span>
                            <button
                              type="button"
                              onClick={() => offerLetterDownload.mutate({ successFeeId: fee.id })}
                              disabled={offerLetterDownload.isPending && offerLetterDownload.variables?.successFeeId === fee.id}
                              className="text-cyan-500 hover:underline disabled:opacity-60 flex items-center gap-0.5"
                            >
                              <FileText className="w-3 h-3" /> {t("offerLetter")}
                            </button>
                          </>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {(fee.status === "active" || isVerificationDue) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setVerifyDialogFeeId(fee.id)}
                            className="border-[#30363d] text-gray-300 hover:bg-[#21262d] text-xs gap-1"
                          >
                            <Upload className="w-3 h-3" /> {t("submitVerification")}
                          </Button>
                        )}
                        {["active", "pending_verification"].includes(fee.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="open-employment-end-dialog"
                            onClick={() => openEmploymentEndDialog(fee.id)}
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs gap-1"
                          >
                            <XCircle className="w-3 h-3" /> {t("reportEmploymentEnded")}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {hasNextFeePage && (
                <div className="flex justify-center pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fetchNextFeePage()}
                    disabled={isFetchingNextFeePage}
                    className="border-[#30363d] text-gray-300 hover:bg-[#21262d]"
                  >
                    {isFetchingNextFeePage ? t("loadingShort") : t("loadOlderArrangements")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Payment History */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">{t("paymentHistory")}</h2>
          {payments.length === 0 ? (
            <Card className="bg-[#161b22] border-[#21262d]">
              <CardContent className="p-6 text-center">
                <DollarSign className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">{t("noPayments")}</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-[#161b22] border-[#21262d]">
              <CardContent className="p-0">
                <div className="divide-y divide-[#21262d]">
                  {payments.map(payment => (
                    <div key={payment.id} className="flex items-center justify-between p-4">
                      <div>
                        <p className="text-white text-sm font-medium">
                          {formatBillingCurrency(payment.amount, payment.currency, locale)}
                        </p>
                        {payment.periodStart && payment.periodEnd && (
                          <p className="text-gray-500 text-xs mt-0.5">
                            {formatBillingCalendarDate(payment.periodStart, locale)} - {formatBillingCalendarDate(payment.periodEnd, locale)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <PaymentStatusBadge status={payment.status} />
                        {payment.paidAt && (
                          <span className="text-gray-500 text-xs">{formatBillingDate(payment.paidAt, locale)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {hasNextPaymentPage && (
            <div className="flex justify-center pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => fetchNextPaymentPage()}
                disabled={isFetchingNextPaymentPage}
                className="border-[#30363d] text-gray-300 hover:bg-[#21262d]"
              >
                {isFetchingNextPaymentPage ? t("loadingShort") : t("loadOlderPayments")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ReportHireDialog
        open={reportHireOpen}
        onOpenChange={setReportHireOpen}
        applicationId={reportHireApplicationId}
        onSuccess={() => refetchFees()}
      />

      {verifyDialogFeeId !== null && (
        <VerificationUploadDialog
          open={true}
          onOpenChange={(open) => { if (!open) setVerifyDialogFeeId(null); }}
          successFeeId={verifyDialogFeeId}
          onSuccess={() => refetchFees()}
        />
      )}

      <Dialog
        open={employmentEndFeeId !== null}
        onOpenChange={(open) => {
          if (!open) closeEmploymentEndDialog();
        }}
      >
        <DialogContent className="max-w-xl bg-[#0d1117] border-[#21262d] text-white">
          <DialogHeader>
            <DialogTitle>{t("reportEmploymentEnded")}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {t("reportEmploymentEndedDescription")}
            </DialogDescription>
          </DialogHeader>

          {employmentEndCompletion ? (
            <div data-testid="employment-end-completion-control" className="space-y-4">
              <div className="rounded-md border border-cyan-500/30 bg-cyan-500/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                    {t("employmentEndClosureRecorded")}
                  </Badge>
                  <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-200">
                    {t("adminReview")}
                  </Badge>
                </div>
                <p className="mt-3 font-medium text-white">{t("employmentEndReviewOpen")}</p>
                <p className="mt-1 text-sm text-gray-400">{t("employmentEndCompletionDetail")}</p>
              </div>

              <div className="grid gap-2">
                {employmentEndCompletion.checkpoints.map((checkpoint, index) => (
                  <div
                    key={checkpoint.label}
                    className="flex items-start gap-2 rounded-md border border-[#30363d] bg-[#161b22] p-3 text-sm text-gray-300"
                  >
                    {checkpoint.state === "complete" ? (
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                    ) : checkpoint.state === "not_required" ? (
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    )}
                    <span>{t(employmentEndCompletionCheckpointKeys[index])}</span>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  onClick={closeEmploymentEndDialog}
                  className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                >
                  {t("done")}
                </Button>
              </DialogFooter>
            </div>
          ) : employmentEndFee ? (
            <div data-testid="employment-end-evidence-control" className="space-y-4">
              <div className="rounded-md border border-[#30363d] bg-[#161b22] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium text-white">{employmentEndFee.jobTitle}</p>
                    <p className="text-sm text-gray-400">{employmentEndFee.employerName}</p>
                  </div>
                  <StatusBadge status={employmentEndFee.status} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="employment-end-date" className="text-gray-300">{t("employmentEndDate")}</Label>
                <Input
                  id="employment-end-date"
                  type="date"
                  value={employmentEndDate}
                  onChange={(event) => setEmploymentEndDate(event.target.value)}
                  className="bg-[#161b22] border-[#30363d] text-white"
                />
              </div>

              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-200">
                    {t(employmentEndControl.canReport ? "employmentEndFinalReview" : "employmentEndNotReportable")}
                  </Badge>
                  <Badge className="border-[#30363d] bg-[#0d1117] text-gray-300">
                    {t(employmentEndControl.risk === "high" ? "severityHigh" : "severityMedium")}
                  </Badge>
                </div>
                <p className="font-medium text-white">{t(employmentEndControl.canReport ? "employmentEndOpenReview" : "employmentEndClosedRecord")}</p>
                <p className="mt-1 text-sm text-gray-400">
                  {t(employmentEndHasSubscription ? "employmentEndStripeDetail" : "employmentEndLocalDetail", { date: formatBillingCalendarDate(employmentEndDate, locale) })}
                </p>
              </div>

              <div className="grid gap-2">
                {employmentEndControl.checkpoints.map((checkpoint, index) => (
                  <div
                    key={checkpoint}
                    className="flex items-start gap-2 rounded-md border border-[#30363d] bg-[#161b22] p-3 text-sm text-gray-300"
                  >
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                    <span>{t(employmentEndControlCheckpointKeys[index])}</span>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEmploymentEndDialog}
                  className="border-[#30363d] text-gray-300 hover:bg-[#21262d]"
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  data-testid="confirm-employment-ended"
                  disabled={!employmentEndControl.canReport || !employmentEndDate || reportEmploymentEnded.isPending}
                  onClick={() => {
                    reportEmploymentEnded.mutate({
                      successFeeId: employmentEndFee.id,
                      endDate: new Date(`${employmentEndDate}T00:00:00.000Z`).toISOString(),
                    });
                  }}
                  className="bg-red-500 hover:bg-red-600 text-white"
                >
                  {reportEmploymentEnded.isPending ? t("recording") : t("recordEmploymentEnd")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="rounded-md border border-[#30363d] bg-[#161b22] p-4 text-sm text-gray-400">
              {t("selectActiveFeeFirst")}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
