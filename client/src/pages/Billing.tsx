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
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  DollarSign, FileText, CheckCircle, Clock, AlertTriangle,
  XCircle, Upload, ExternalLink, RefreshCw, Briefcase, Calendar, Shield, ClipboardCheck
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending_verification: { label: "Pending Verification", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    active: { label: "Active", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    paused: { label: "Paused", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
    ended: { label: "Ended", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
    suspended: { label: "Suspended", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    disputed: { label: "Disputed", className: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-500/20 text-gray-400" };
  return <Badge className={`text-xs border ${cfg.className}`}>{cfg.label}</Badge>;
}

function PaymentStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    paid: { label: "Paid", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    pending: { label: "Pending", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    failed: { label: "Failed", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    refunded: { label: "Refunded", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-500/20 text-gray-400" };
  return <Badge className={`text-xs border ${cfg.className}`}>{cfg.label}</Badge>;
}

function ComplianceRiskBadge({ risk }: { risk: SuccessFeeComplianceRisk }) {
  const map: Record<SuccessFeeComplianceRisk, string> = {
    low: "border-green-500/30 bg-green-500/10 text-green-300",
    medium: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
    high: "border-orange-500/30 bg-orange-500/10 text-orange-300",
    critical: "border-red-500/30 bg-red-500/10 text-red-300",
  };
  return <Badge className={`text-xs border ${map[risk]}`}>{risk}</Badge>;
}

function ComplianceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    needs_attention: { label: "Needs Attention", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    due_soon: { label: "Verification Due", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    clear: { label: "Current", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    none: { label: "No Active Fee", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-500/20 text-gray-400 border-gray-500/30" };
  return <Badge className={`text-xs border ${cfg.className}`}>{cfg.label}</Badge>;
}

interface VerificationUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  successFeeId: number;
  onSuccess: () => void;
}

function VerificationUploadDialog({ open, onOpenChange, successFeeId, onSuccess }: VerificationUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>("");
  const [documentType, setDocumentType] = useState<"paystub" | "employment_letter" | "bank_statement" | "other">("paystub");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submitVerification = trpc.successFees.submitVerification.useMutation({
    onSuccess: () => {
      toast.success("Verification document submitted successfully!");
      onSuccess();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message || "Failed to submit verification"),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error("File must be under 10MB"); return; }
    setFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setFileBase64((ev.target?.result as string).split(",")[1]);
    reader.readAsDataURL(f);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#0d1117] border-[#21262d] text-white">
        <DialogHeader>
          <DialogTitle>Submit Verification Document</DialogTitle>
          <DialogDescription className="text-gray-400">
            Upload proof of continued employment (paystub, employment letter, or bank statement).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-gray-300">Document Type</Label>
            <Select value={documentType} onValueChange={(v) => setDocumentType(v as typeof documentType)}>
              <SelectTrigger className="bg-[#161b22] border-[#30363d] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#161b22] border-[#30363d]">
                <SelectItem value="paystub">Paystub</SelectItem>
                <SelectItem value="employment_letter">Employment Letter</SelectItem>
                <SelectItem value="bank_statement">Bank Statement</SelectItem>
                <SelectItem value="other">Other</SelectItem>
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
                <p className="text-sm">Click to upload PDF or image</p>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={handleFileChange} className="hidden" />

          <Button
            onClick={() => submitVerification.mutate({ successFeeId, documentBase64: fileBase64, documentType, documentFileName: file?.name ?? "document.pdf", documentMimeType: file?.type ?? "application/pdf" })}
            disabled={!file || submitVerification.isPending}
            className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
          >
            {submitVerification.isPending ? "Uploading..." : "Submit Verification"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Billing() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [reportHireOpen, setReportHireOpen] = useState(false);
  const [reportHireApplicationId, setReportHireApplicationId] = useState<number | undefined>(undefined);
  const [verifyDialogFeeId, setVerifyDialogFeeId] = useState<number | null>(null);
  const [employmentEndFeeId, setEmploymentEndFeeId] = useState<number | null>(null);
  const [employmentEndDate, setEmploymentEndDate] = useState(() => new Date().toISOString().slice(0, 10));
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
  const { data: payments = [] } = trpc.successFees.getPaymentHistory.useQuery();
  const { data: offerAttributionReviews = [] } = trpc.successFees.getOfferAttributionReviews.useQuery();

  const reportEmploymentEnded = trpc.successFees.reportEmploymentEnded.useMutation({
    onSuccess: (data) => {
      setEmploymentEndResult(data);
      toast.success("Employment end recorded for admin review.");
      refetchFees();
    },
    onError: (err) => toast.error(err.message || "Failed to report employment end"),
  });

  const retryBillingCheckout = trpc.successFees.retryBillingCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
      }
      toast.success("Secure Stripe Checkout opened. No new success-fee record or subscription was created by Hire.AI.");
      refetchFees();
    },
    onError: (err) => toast.error(err.message || "Could not reopen secure Stripe Checkout"),
  });

  const getBillingPortal = trpc.successFees.getBillingPortalUrl.useMutation({
    onSuccess: (data) => window.open(data.url, "_blank"),
    onError: (err) => toast.error(err.message || "Could not open billing portal"),
  });

  const activeFees = fees.filter(f => ["active", "pending_verification"].includes(f.status));
  const totalMonthlyFees = feeSummary?.monthlyFeeCents ?? 0;
  const totalPaid = payments.filter(p => p.status === "paid").reduce((sum, p) => sum + p.amount, 0);
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
  const employmentEndFee = employmentEndFeeId
    ? fees.find((fee) => fee.id === employmentEndFeeId) ?? null
    : null;
  const employmentEndControl = getEmploymentEndControlSummary(employmentEndFee, employmentEndDate);
  const employmentEndCompletion = employmentEndResult
    ? getEmploymentEndCompletionSummary(employmentEndResult)
    : null;

  const openEmploymentEndDialog = (feeId: number) => {
    setEmploymentEndFeeId(feeId);
    setEmploymentEndDate(new Date().toISOString().slice(0, 10));
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
        <p>Please sign in to view billing.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Billing & Success Fees</h1>
            <p className="text-gray-400 mt-1">Manage your success fee arrangements and payment history</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            {fees.some(f => f.stripeSubscriptionId) && (
              <Button
                variant="outline"
                onClick={() => getBillingPortal.mutate()}
                disabled={getBillingPortal.isPending}
                className="flex-1 border-[#30363d] text-gray-300 hover:bg-[#21262d] gap-1.5 sm:flex-none"
              >
                <ExternalLink className="w-4 h-4" /> Billing Portal
              </Button>
            )}
            <Button
              onClick={() => {
                setReportHireApplicationId(undefined);
                setReportHireOpen(true);
              }}
              className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-semibold gap-1.5 sm:flex-none"
            >
              🎉 Report a Hire
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-3">
          <Card className="bg-[#161b22] border-[#21262d]">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase className="w-4 h-4 text-cyan-400" />
                <span className="text-gray-400 text-sm">Active Fees</span>
              </div>
              <p className="text-2xl font-bold text-white">{feeSummary?.activeFees ?? 0}</p>
            </CardContent>
          </Card>
          <Card className="bg-[#161b22] border-[#21262d]">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-cyan-400" />
                <span className="text-gray-400 text-sm">Monthly Fees</span>
              </div>
              <p className="text-2xl font-bold text-white">${(totalMonthlyFees / 100).toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-[#161b22] border-[#21262d]">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-gray-400 text-sm">Total Paid</span>
              </div>
              <p className="text-2xl font-bold text-white">${(totalPaid / 100).toFixed(2)}</p>
            </CardContent>
          </Card>
        </div>

        <Card data-testid="billing-compliance-control" className="bg-[#161b22] border-cyan-500/30 mb-6">
          <CardHeader>
            <CardTitle className="text-white flex flex-wrap items-center gap-2">
              <Shield className="h-4 w-4 text-cyan-300" />
              Success-fee operating control
              <ComplianceStatusBadge status={complianceSummary.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-cyan-200">{complianceAction.label}</p>
                  <ComplianceRiskBadge risk={complianceAction.risk} />
                  <Badge className="border-[#30363d] bg-[#0d1117] text-gray-300">
                    {complianceAction.approvalGated ? "Approval-gated" : "Internal"}
                  </Badge>
                  {complianceAction.proofRequired && (
                    <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                      Proof required
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-400">{complianceAction.detail}</p>
                <p className="mt-2 text-xs text-gray-500">{complianceSummary.nextAction}</p>
              </div>
              <Button
                data-testid="billing-compliance-primary"
                variant="outline"
                className="border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10"
                onClick={handleComplianceAction}
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                {complianceAction.cta}
              </Button>
            </div>

            <div className="grid gap-2 text-xs text-gray-400 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Offer reviews", complianceSummary.pendingOfferAttributions],
                ["Suspended", complianceSummary.suspendedFees],
                ["Paused", complianceSummary.pausedFees],
                ["Disputed", complianceSummary.disputedFees],
                ["Pending proof", complianceSummary.pendingVerification],
                ["Overdue", complianceSummary.overdueVerifications],
                ["Due soon", complianceSummary.dueSoonVerifications],
                [
                  "Next due",
                  complianceSummary.nextVerificationDue
                    ? complianceSummary.nextVerificationDue.toLocaleDateString()
                    : "None",
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
            <p className="text-sm font-semibold text-cyan-400 mb-2">How Hire.AI Success Fees Work</p>
            <div className="grid grid-cols-1 gap-4 text-xs text-gray-400 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-white font-medium">1. Free to Use</span>
                <span>Use Hire.AI to automate your job search at no upfront cost.</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-white font-medium">2. Land a Job</span>
                <span>Report your hire and upload your offer letter. We verify and set up a 5% monthly fee.</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-white font-medium">3. Ongoing Fee</span>
                <span>Pay 5% of your monthly salary while employed. Verify every 90 days. Stop when you leave.</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {offerAttributionReviews.length > 0 && (
          <Card className="bg-[#161b22] border-amber-500/30 mb-6">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Offer Attribution Reviews
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
                          <span className="text-sm text-gray-400">Pending success-fee attribution</span>
                        </div>
                        <p className="mt-2 font-medium text-white">
                          {job?.title || "Application"}{job?.company ? ` at ${job.company}` : ""}
                        </p>
                        {response?.summary ? (
                          <p className="mt-1 text-sm text-gray-400">{response.summary}</p>
                        ) : review.approval.description ? (
                          <p className="mt-1 text-sm text-gray-400">{review.approval.description}</p>
                        ) : null}
                        <p className="mt-2 text-xs text-gray-500">
                          Approval #{review.approval.id}
                          {response?.receivedAt ? ` - Response received ${new Date(response.receivedAt).toLocaleDateString()}` : ""}
                        </p>
                      </div>
                      <Button
                        className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                        onClick={() => {
                          setReportHireApplicationId(applicationId ?? undefined);
                          setReportHireOpen(true);
                        }}
                      >
                        Report Hire
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Active Success Fees */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Success Fee Arrangements</h2>
          {fees.length === 0 ? (
            <Card className="bg-[#161b22] border-[#21262d]">
              <CardContent className="p-8 text-center">
                <Briefcase className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 font-medium">No success fees yet</p>
                <p className="text-gray-500 text-sm mt-1">When you land a job through Hire.AI, report it here to set up your success fee arrangement.</p>
                <Button
                  onClick={() => {
                    setReportHireApplicationId(undefined);
                    setReportHireOpen(true);
                  }}
                  className="mt-4 bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  I Got Hired!
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
                          <p className="text-cyan-400 font-bold">${(fee.monthlyFeeAmount / 100).toFixed(2)}<span className="text-gray-500 text-xs font-normal">/mo</span></p>
                          <p className="text-gray-500 text-xs">{fee.feePercent}% of ${fee.monthlySalary.toLocaleString()}</p>
                        </div>
                      </div>

                      {/* Verification status */}
                      {fee.status === "active" && daysUntilVerification !== null && (
                        <div className={`flex items-center gap-2 text-xs p-2 rounded mb-3 ${isVerificationDue ? "bg-red-500/10 text-red-400 border border-red-500/20" : daysUntilVerification <= 14 ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20" : "bg-[#0d1117] text-gray-500"}`}>
                          {isVerificationDue ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                          {isVerificationDue
                            ? "Verification overdue! Submit proof of employment to avoid suspension."
                            : daysUntilVerification <= 14
                            ? `Verification due in ${daysUntilVerification} days`
                            : `Next verification: ${new Date(fee.nextVerificationDue!).toLocaleDateString()}`}
                        </div>
                      )}

                      {fee.status === "pending_verification" && (
                        <div className="flex items-center gap-2 text-xs p-2 rounded mb-3 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          <Clock className="w-3.5 h-3.5" />
                          Offer letter is under review. Billing begins only after you confirm in secure Stripe Checkout.
                        </div>
                      )}

                      {needsBillingCheckout && (
                        <div className="mb-3 flex flex-col gap-2 rounded border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 text-cyan-100">
                            <p className="font-medium">Secure billing confirmation required</p>
                            <p className="mt-1 text-cyan-100/70">Hire.AI will reuse an open Checkout session or replace only an expired one.</p>
                          </div>
                          <Button
                            size="sm"
                            data-testid="retry-success-fee-checkout"
                            onClick={() => retryBillingCheckout.mutate({ successFeeId: fee.id, confirmBillingSetup: true })}
                            disabled={retryBillingCheckout.isPending}
                            className="shrink-0 bg-cyan-500 text-xs font-semibold text-black hover:bg-cyan-600"
                          >
                            <ExternalLink className="mr-1 h-3 w-3" />
                            {retryBillingCheckout.isPending ? "Opening..." : "Open Stripe Checkout"}
                          </Button>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                        <Calendar className="w-3.5 h-3.5" />
                        Started {new Date(fee.startDate).toLocaleDateString()}
                        {fee.offerLetterUrl && (
                          <>
                            <span className="text-gray-600">·</span>
                            <a href={fee.offerLetterUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-500 hover:underline flex items-center gap-0.5">
                              <FileText className="w-3 h-3" /> Offer Letter
                            </a>
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
                            <Upload className="w-3 h-3" /> Submit Verification
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
                            <XCircle className="w-3 h-3" /> Report Employment Ended
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
                    {isFetchingNextFeePage ? "Loading..." : "Load older arrangements"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Payment History */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Payment History</h2>
          {payments.length === 0 ? (
            <Card className="bg-[#161b22] border-[#21262d]">
              <CardContent className="p-6 text-center">
                <DollarSign className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">No payments yet</p>
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
                          ${(payment.amount / 100).toFixed(2)} {payment.currency}
                        </p>
                        {payment.periodStart && payment.periodEnd && (
                          <p className="text-gray-500 text-xs mt-0.5">
                            {new Date(payment.periodStart).toLocaleDateString()} – {new Date(payment.periodEnd).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <PaymentStatusBadge status={payment.status} />
                        {payment.paidAt && (
                          <span className="text-gray-500 text-xs">{new Date(payment.paidAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
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
            <DialogTitle>Report Employment Ended</DialogTitle>
            <DialogDescription className="text-gray-400">
              Record the end date and send the final success-fee obligation to admin review.
            </DialogDescription>
          </DialogHeader>

          {employmentEndCompletion ? (
            <div data-testid="employment-end-completion-control" className="space-y-4">
              <div className="rounded-md border border-cyan-500/30 bg-cyan-500/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                    {employmentEndCompletion.label}
                  </Badge>
                  <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-200">
                    Admin review
                  </Badge>
                </div>
                <p className="mt-3 font-medium text-white">{employmentEndCompletion.headline}</p>
                <p className="mt-1 text-sm text-gray-400">{employmentEndCompletion.detail}</p>
              </div>

              <div className="grid gap-2">
                {employmentEndCompletion.checkpoints.map((checkpoint) => (
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
                    <span>{checkpoint.label}</span>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  onClick={closeEmploymentEndDialog}
                  className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                >
                  Done
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
                <Label htmlFor="employment-end-date" className="text-gray-300">Employment End Date</Label>
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
                    {employmentEndControl.label}
                  </Badge>
                  <Badge className="border-[#30363d] bg-[#0d1117] text-gray-300">
                    {employmentEndControl.risk}
                  </Badge>
                </div>
                <p className="font-medium text-white">{employmentEndControl.headline}</p>
                <p className="mt-1 text-sm text-gray-400">{employmentEndControl.detail}</p>
              </div>

              <div className="grid gap-2">
                {employmentEndControl.checkpoints.map((checkpoint) => (
                  <div
                    key={checkpoint}
                    className="flex items-start gap-2 rounded-md border border-[#30363d] bg-[#161b22] p-3 text-sm text-gray-300"
                  >
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                    <span>{checkpoint}</span>
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
                  Cancel
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
                  {reportEmploymentEnded.isPending ? "Recording..." : "Record Employment End"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="rounded-md border border-[#30363d] bg-[#161b22] p-4 text-sm text-gray-400">
              Select an active success-fee record before reporting employment ended.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
