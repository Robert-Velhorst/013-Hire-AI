import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Mail,
  Send,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { getApplicationEmailPanelPolicy } from "@/lib/applicationEmailPanelPolicy";
import { saveDraftThenRequestApproval } from "@/lib/applicationEmailApprovalRequest";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type Provider = "gmail" | "outlook";

const copy = {
  en: {
    title: "Email application",
    loadError: "Could not load the email draft or approval status.",
    retryLoad: "Reload status",
    prepare: "Prepare email",
    preparing: "Preparing...",
    provider: "Mailbox provider",
    recipient: "Recipient from job listing",
    subject: "Subject",
    message: "Message",
    resume: "Resume attachment",
    warning:
      "The address comes from the job listing and is not independently verified. Mailbox send permission is required.",
    save: "Save draft",
    request: "Request approval",
    approve: "Approve exact email",
    reject: "Reject",
    send: "Send approved email now",
    sending: "Sending...",
    retry: "Prepare a new draft",
    readOnly:
      "This application is no longer pending. Email details are read-only and cannot be sent again.",
    eligibilityReasons: {
      application_not_found: "This application is unavailable.",
      application_not_pending: "Email submission is available only while the application is pending.",
      listing_not_current: "This vacancy may be closed or out of date, so email submission is unavailable.",
      not_fully_remote: "This listing does not clearly confirm a fully remote role. Hybrid and on-site roles cannot be submitted by email.",
      missing_application_email: "The vacancy does not provide an application email address.",
      invalid_application_email: "The application email address in this listing is invalid.",
      storage_unavailable: "Email submission requires the configured application database.",
    } as Record<string, string>,
    sent: "The mailbox provider accepted the email. Delivery to the recipient is not guaranteed.",
    unknown:
      "Outcome unknown. Do not retry until you have checked the mailbox.",
    statuses: {
      draft: "Draft",
      pending_approval: "Approval pending",
      ready: "Approved, not sent",
      sending: "Sending",
      sent: "Accepted by provider",
      failed: "Not sent",
      unknown: "Outcome unknown",
      cancelled: "Cancelled",
    } as Record<string, string>,
  },
  nl: {
    title: "Sollicitatie per e-mail",
    loadError:
      "Het e-mailconcept of de goedkeuringsstatus kon niet worden geladen.",
    retryLoad: "Status opnieuw laden",
    prepare: "E-mail voorbereiden",
    preparing: "Voorbereiden...",
    provider: "E-mailprovider",
    recipient: "Ontvanger uit vacature",
    subject: "Onderwerp",
    message: "Bericht",
    resume: "Bijgevoegd cv",
    warning:
      "Het adres komt uit de vacature en is niet onafhankelijk geverifieerd. Verzendrechten voor de mailbox zijn vereist.",
    save: "Concept opslaan",
    request: "Goedkeuring aanvragen",
    approve: "Exacte e-mail goedkeuren",
    reject: "Afwijzen",
    send: "Goedgekeurde e-mail nu verzenden",
    sending: "Verzenden...",
    retry: "Nieuw concept voorbereiden",
    readOnly:
      "Deze sollicitatie is niet meer in behandeling. De e-mailgegevens zijn alleen-lezen en kunnen niet opnieuw worden verzonden.",
    eligibilityReasons: {
      application_not_found: "Deze sollicitatie is niet beschikbaar.",
      application_not_pending: "E-mail solliciteren kan alleen zolang de sollicitatie in behandeling is.",
      listing_not_current: "Deze vacature is mogelijk gesloten of verouderd. E-mail solliciteren is daarom niet beschikbaar.",
      not_fully_remote: "Deze vacature bevestigt niet duidelijk dat het werk volledig op afstand is. Hybride en kantoorfuncties kunnen niet per e-mail worden aangeboden.",
      missing_application_email: "De vacature bevat geen e-mailadres voor sollicitaties.",
      invalid_application_email: "Het e-mailadres voor sollicitaties in deze vacature is ongeldig.",
      storage_unavailable: "E-mail solliciteren vereist de ingestelde applicatiedatabase.",
    } as Record<string, string>,
    sent: "De e-mailprovider heeft de e-mail geaccepteerd. Aflevering bij de ontvanger is niet gegarandeerd.",
    unknown:
      "Uitkomst onbekend. Probeer niet opnieuw voordat je de mailbox hebt gecontroleerd.",
    statuses: {
      draft: "Concept",
      pending_approval: "Wacht op goedkeuring",
      ready: "Goedgekeurd, niet verzonden",
      sending: "Wordt verzonden",
      sent: "Geaccepteerd door provider",
      failed: "Niet verzonden",
      unknown: "Uitkomst onbekend",
      cancelled: "Geannuleerd",
    } as Record<string, string>,
  },
} as const;

export function ApplicationEmailSubmissionPanel({
  applicationId,
  applicationStatus,
}: {
  applicationId: number;
  applicationStatus: string;
}) {
  const { locale } = useLocale();
  const text = locale === "nl" ? copy.nl : copy.en;
  const utils = trpc.useUtils();
  const [provider, setProvider] = useState<Provider>("gmail");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const {
    data,
    isLoading,
    isError: submissionError,
    refetch: refetchSubmission,
  } = trpc.applications.getEmailSubmission.useQuery({ applicationId });
  const {
    data: eligibility,
    isLoading: eligibilityLoading,
    isError: eligibilityError,
    refetch: refetchEligibility,
  } = trpc.applications.getEmailSubmissionEligibility.useQuery(
    { applicationId },
    { enabled: applicationStatus === "pending" }
  );
  const {
    data: approvals = [],
    isError: approvalsError,
    refetch: refetchApprovals,
  } = trpc.applications.listApprovals.useQuery({
    applicationIds: [applicationId],
  });
  const approval = useMemo(
    () =>
      approvals.find(
        item =>
          item.applicationId === applicationId &&
          item.approvalType === "application_email_submission" &&
          item.entityType === "application"
      ),
    [approvals, applicationId]
  );
  const panelPolicy = getApplicationEmailPanelPolicy(
    applicationStatus,
    Boolean(data),
    eligibility?.eligible === true
  );
  const eligibilityNotice =
    applicationStatus === "pending" && eligibility && !eligibility.eligible
      ? text.eligibilityReasons[eligibility.reason] || text.eligibilityReasons.not_fully_remote
      : null;

  useEffect(() => {
    if (!data) return;
    setProvider(data.provider);
    setSubject(data.subject);
    setMessage(data.message);
  }, [data?.id, data?.updatedAt, data?.subject, data?.message]);

  const refresh = async () => {
    await Promise.all([
      utils.applications.getEmailSubmission.invalidate({ applicationId }),
      utils.applications.getEmailSubmissionEligibility.invalidate({ applicationId }),
      utils.applications.listApprovals.invalidate({
        applicationIds: [applicationId],
      }),
      utils.applications.listPage.invalidate(),
      utils.applications.getSummary.invalidate(),
    ]);
  };
  const prepareMutation = trpc.applications.prepareEmailSubmission.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success(text.title);
    },
    onError: error => toast.error(error.message),
  });
  const updateMutation =
    trpc.applications.updateEmailSubmissionDraft.useMutation({
      onSuccess: async () => {
        await refresh();
        toast.success(text.save);
      },
      onError: error => toast.error(error.message),
    });
  const requestMutation =
    trpc.applications.requestEmailSubmissionApproval.useMutation({
      onSuccess: async () => {
        await refresh();
        toast.success(text.request);
      },
      onError: error => toast.error(error.message),
    });
  const resolveMutation =
    trpc.applications.resolveEmailSubmissionApproval.useMutation({
      onSuccess: async () => {
        await refresh();
      },
      onError: error => toast.error(error.message),
    });
  const sendMutation = trpc.applications.sendEmailSubmission.useMutation({
    onSuccess: async result => {
      await refresh();
      toast.success(result.confirmation);
    },
    onError: error => {
      toast.error(error.message);
      void refresh();
    },
  });

  if (isLoading || (applicationStatus === "pending" && eligibilityLoading))
    return <div className="text-sm text-slate-400">{text.preparing}</div>;
  if (submissionError || approvalsError || (applicationStatus === "pending" && eligibilityError)) {
    return (
      <section
        className="space-y-3 rounded-md border border-rose-500/30 bg-rose-500/5 p-3"
        role="alert"
        data-testid="application-email-load-error"
      >
        <div className="flex items-start gap-2 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{text.loadError}</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void Promise.all([
              refetchSubmission(),
              refetchApprovals(),
              applicationStatus === "pending" ? refetchEligibility() : Promise.resolve(),
            ])
          }
        >
          {text.retryLoad}
        </Button>
      </section>
    );
  }
  if (!panelPolicy.visible && !eligibilityNotice) return null;

  if (!data && eligibilityNotice) {
    return (
      <p
        className="rounded border border-slate-700 bg-slate-900/50 p-3 text-sm text-slate-400"
        role="status"
        data-testid="application-email-ineligible"
      >
        {eligibilityNotice}
      </p>
    );
  }

  return (
    <section className="space-y-3" data-testid="application-email-submission">
      <Separator className="bg-slate-700" />
      <div className="space-y-3 rounded-md border border-slate-700 bg-slate-800/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <Mail className="h-4 w-4" />
            {text.title}
          </h4>
          {data && (
            <Badge variant="outline">
              {text.statuses[data.status] || data.status}
            </Badge>
          )}
        </div>
        {!data ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">{text.provider}</span>
            <div
              className="inline-flex rounded border border-slate-700 p-0.5"
              role="group"
              aria-label={text.provider}
            >
              {(["gmail", "outlook"] as const).map(option => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={provider === option ? "secondary" : "ghost"}
                  onClick={() => setProvider(option)}
                >
                  {option === "gmail" ? "Gmail" : "Outlook"}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              disabled={prepareMutation.isPending}
              onClick={() =>
                prepareMutation.mutate({ applicationId, provider })
              }
            >
              {prepareMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              {prepareMutation.isPending ? text.preparing : text.prepare}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1 text-sm">
              <div className="text-xs text-slate-500">{text.recipient}</div>
              <div className="break-all text-slate-200">{data.recipient}</div>
              <div className="pt-1 text-xs text-slate-500">{text.resume}</div>
              <div className="break-all text-slate-300">
                {data.resumeFileName} ({Math.ceil(data.resumeSize / 1024)} KB)
              </div>
            </div>
            <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {text.warning}
            </div>
            {eligibilityNotice && (
              <p className="rounded border border-slate-700 bg-slate-900/50 p-2 text-xs text-slate-400" role="status">
                {eligibilityNotice}
              </p>
            )}
            <label className="block space-y-1 text-xs text-slate-400">
              {text.subject}
              <Input
                value={subject}
                onChange={event => setSubject(event.target.value)}
                maxLength={500}
                disabled={!panelPolicy.canPrepare || data.status !== "draft"}
                className="mt-1"
              />
            </label>
            <label className="block space-y-1 text-xs text-slate-400">
              {text.message}
              <Textarea
                value={message}
                onChange={event => setMessage(event.target.value)}
                maxLength={50_000}
                rows={7}
                disabled={!panelPolicy.canPrepare || data.status !== "draft"}
                className="mt-1"
              />
            </label>
            {data.failureMessage && (
              <p className="text-xs text-rose-300">{data.failureMessage}</p>
            )}
            {applicationStatus !== "pending" && !panelPolicy.canPrepare && (
              <p className="rounded border border-slate-700 bg-slate-900/50 p-2 text-xs text-slate-400">
                {text.readOnly}
              </p>
            )}
            {data.status === "draft" && panelPolicy.canPrepare && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={updateMutation.isPending}
                  onClick={() =>
                    updateMutation.mutate({ applicationId, subject, message })
                  }
                >
                  {text.save}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    requestMutation.isPending ||
                    updateMutation.isPending ||
                    !subject.trim() ||
                    !message.trim()
                  }
                  onClick={() =>
                    void saveDraftThenRequestApproval(
                      () =>
                        updateMutation.mutateAsync({
                          applicationId,
                          subject,
                          message,
                        }),
                      () => requestMutation.mutate({ applicationId })
                    )
                  }
                >
                  {text.request}
                </Button>
              </div>
            )}
            {data.status === "pending_approval" &&
              panelPolicy.canPrepare &&
              approval?.status === "pending" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={resolveMutation.isPending}
                    onClick={() =>
                      resolveMutation.mutate({
                        approvalId: approval.id,
                        status: "approved",
                        decisionNote:
                          "Approved the exact application email and resume attachment.",
                      })
                    }
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {text.approve}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={resolveMutation.isPending}
                    onClick={() =>
                      resolveMutation.mutate({
                        approvalId: approval.id,
                        status: "rejected",
                        decisionNote: "Rejected the application email draft.",
                      })
                    }
                  >
                    {text.reject}
                  </Button>
                </div>
              )}
            {data.status === "ready" && panelPolicy.canPrepare && (
              <Button
                type="button"
                size="sm"
                disabled={sendMutation.isPending}
                onClick={() => sendMutation.mutate({ applicationId })}
              >
                {sendMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {sendMutation.isPending ? text.sending : text.send}
              </Button>
            )}
            {data.status === "sent" && (
              <p className="flex items-start gap-2 text-xs text-emerald-200">
                <CheckCircle className="h-4 w-4 shrink-0" />
                {text.sent}
              </p>
            )}
            {data.status === "unknown" && (
              <p className="flex items-start gap-2 text-xs text-rose-200">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                {text.unknown}
              </p>
            )}
            {(data.status === "failed" || data.status === "cancelled") &&
              panelPolicy.canPrepare && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">
                    {text.provider}
                  </span>
                  <div
                    className="inline-flex rounded border border-slate-700 p-0.5"
                    role="group"
                    aria-label={text.provider}
                  >
                    {(["gmail", "outlook"] as const).map(option => (
                      <Button
                        key={option}
                        type="button"
                        size="sm"
                        variant={provider === option ? "secondary" : "ghost"}
                        onClick={() => setProvider(option)}
                      >
                        {option === "gmail" ? "Gmail" : "Outlook"}
                      </Button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={prepareMutation.isPending}
                    onClick={() =>
                      prepareMutation.mutate({ applicationId, provider })
                    }
                  >
                    {prepareMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="mr-2 h-4 w-4" />
                    )}
                    {prepareMutation.isPending ? text.preparing : text.retry}
                  </Button>
                </div>
              )}
          </>
        )}
      </div>
    </section>
  );
}
