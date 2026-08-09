import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Shield, Zap, Globe, ChevronLeft, Loader2, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { localeLabels, SUPPORTED_LOCALES, type SupportedLocale } from "@shared/localization";
import AppHeader from "@/components/AppHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Settings() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { locale, setLocale, t } = useLocale();
  
  // Settings state
  const [autoApply, setAutoApply] = useState(false);
  const [scanFrequency, setScanFrequency] = useState("daily");
  const [maxApplicationsPerDay, setMaxApplicationsPerDay] = useState("10");
  const { data: profile } = trpc.profile.get.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const privacyExport = trpc.privacy.exportData.useQuery(undefined, {
    enabled: false,
  });
  const { data: deletionRequest } = trpc.privacy.getDeletionRequest.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const requestDeletion = trpc.privacy.requestDeletion.useMutation({
    onSuccess: () => {
      toast.success(t("deletionReviewRequested"));
      utils.privacy.getDeletionRequest.invalidate();
    },
    onError: (error) => toast.error(error.message || t("deletionReviewRequestFailed")),
  });
  const cancelDeletionRequest = trpc.privacy.cancelDeletionRequest.useMutation({
    onSuccess: () => {
      toast.success(t("deletionRequestCancelled"));
      utils.privacy.getDeletionRequest.invalidate();
    },
    onError: (error) => toast.error(error.message || t("deletionRequestCancelFailed")),
  });
  const updatePreferences = trpc.profile.updatePreferences.useMutation({
    onSuccess: async () => {
      await utils.profile.get.invalidate();
      toast.success(t("settingsSaved"));
    },
    onError: (error) => toast.error(error.message || t("settingsSaveFailed")),
  });
  const updateLocale = trpc.auth.updateLocale.useMutation({
    onSuccess: ({ locale: savedLocale }) => {
      setLocale(savedLocale);
      utils.auth.me.setData(undefined, (current) => current ? { ...current, locale: savedLocale } : current);
      toast.success(t("languageSaved"));
    },
    onError: (error) => toast.error(error.message || t("languageSaveFailed")),
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
      setAutoApply(saved.mode === "auto_apply");
      setMaxApplicationsPerDay(String(saved.dailyApplicationLimit || 10));
      setScanFrequency(saved.scanFrequency || "daily");
    } catch {
      // Keep conservative defaults for legacy preference data.
    }
  }, [profile?.preferences]);

  const handleSaveSettings = () => {
    updatePreferences.mutate({
      mode: autoApply ? "auto_apply" : "review_first",
      dailyApplicationLimit: Number(maxApplicationsPerDay),
      scanFrequency: scanFrequency as "continuous" | "hourly" | "daily" | "twice-daily",
    });
  };

  const handleExportData = async () => {
    const result = await privacyExport.refetch();
    if (!result.data) {
      toast.error(t("dataExportFailed"));
      return;
    }
    const exportData = {
      account: {
        id: user?.id,
        name: user?.name,
        email: user?.email,
      },
      ...result.data,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hire-ai-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(t("dataExportCreated"));
  };

  const deletionRequestActive = deletionRequest?.status === "open" || deletionRequest?.status === "in_progress";
  const deletionStatusText = deletionRequestActive
    ? t("deletionStatusOpen")
    : deletionRequest?.status === "resolved"
      ? t("deletionStatusResolved")
      : deletionRequest?.status === "dismissed"
        ? t("deletionStatusDismissed")
        : t("deletionStatusNone");

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Activity className="h-12 w-12 text-cyan-400 animate-pulse mx-auto mb-4" />
          <p className="text-slate-400">{t("loadingSettings")}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader currentPage="settings" />

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Back Button */}
        <Button
          variant="ghost"
          className="text-slate-400 hover:text-white mb-6"
          onClick={() => setLocation("/dashboard")}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          {t("backToDashboard")}
        </Button>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t("settings")}</h1>
          <p className="text-slate-400">{t("settingsDescription")}</p>
        </div>

        <div className="space-y-6">
          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Globe className="h-5 w-5 text-cyan-400" />
                {t("language")}
              </CardTitle>
              <CardDescription className="text-slate-400">
                {t("languageDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={locale}
                onValueChange={(value) => updateLocale.mutate({ locale: value as SupportedLocale })}
                disabled={updateLocale.isPending}
              >
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white" aria-label={t("language")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {SUPPORTED_LOCALES.map((supportedLocale) => (
                    <SelectItem key={supportedLocale} value={supportedLocale} className="text-white">
                      {localeLabels[supportedLocale]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Application Preparation Settings */}
          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Zap className="h-5 w-5 text-cyan-400" />
                {t("applicationPreparation")}
              </CardTitle>
              <CardDescription className="text-slate-400">
                {t("applicationPreparationDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="accelerated-preparation" className="text-white">{t("acceleratedPreparation")}</Label>
                  <p className="text-sm text-slate-400">
                    {t("acceleratedPreparationDescription")}
                  </p>
                </div>
                <Switch
                  id="accelerated-preparation"
                  checked={autoApply}
                  onCheckedChange={setAutoApply}
                  aria-label={t("acceleratedPreparation")}
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-white">{t("maxPreparationsPerDay")}</Label>
                <Select value={maxApplicationsPerDay} onValueChange={setMaxApplicationsPerDay}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white" aria-label={t("maximumPreparationsLabel")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {[5, 10, 20, 25].map((count) => (
                      <SelectItem key={count} value={String(count)} className="text-white">
                        {t("applicationsCount", { count })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  {t("dailyReviewQueueDescription")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Job Scanning Settings */}
          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Globe className="h-5 w-5 text-blue-400" />
                {t("jobScanning")}
              </CardTitle>
              <CardDescription className="text-slate-400">
                {t("jobScanningDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="text-white">{t("scanFrequency")}</Label>
                <Select value={scanFrequency} onValueChange={setScanFrequency}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white" aria-label={t("scanFrequency")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="hourly" className="text-white">{t("everyHour")}</SelectItem>
                    <SelectItem value="continuous" className="text-white">{t("everyFifteenMinutes")}</SelectItem>
                    <SelectItem value="daily" className="text-white">{t("onceDaily")}</SelectItem>
                    <SelectItem value="twice-daily" className="text-white">{t("twiceDaily")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Privacy & Security */}
          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-400" />
                {t("privacySecurity")}
              </CardTitle>
              <CardDescription className="text-slate-400">
                {t("privacySecurityDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-4 rounded-lg bg-slate-800/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-white font-medium">{t("exportYourData")}</p>
                  <p className="text-sm text-slate-400">{t("exportDataDescription")}</p>
                </div>
                <Button
                  variant="outline"
                  className="border-slate-700 text-slate-300"
                  onClick={handleExportData}
                  disabled={privacyExport.isFetching}
                >
                  {privacyExport.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t("export")}
                </Button>
              </div>
              <div className="flex flex-col gap-4 rounded-lg border border-red-500/20 bg-red-500/5 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-white">{t("accountDeletionReview")}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {t("accountDeletionReviewDescription")}
                  </p>
                  <p className="mt-2 text-xs text-slate-500" data-testid="privacy-deletion-status">
                    {deletionStatusText}
                  </p>
                </div>
                {deletionRequestActive ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="shrink-0 border-slate-700 text-slate-300"
                        disabled={cancelDeletionRequest.isPending}
                      >
                        {cancelDeletionRequest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {t("cancelRequest")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="border-slate-800 bg-slate-900 text-white">
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("cancelDeletionReviewTitle")}</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                          {t("cancelDeletionReviewDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-slate-700 bg-transparent text-slate-300">{t("keepRequest")}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-slate-700 text-white hover:bg-slate-600"
                          onClick={() => cancelDeletionRequest.mutate()}
                        >
                          {t("cancelRequest")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="shrink-0 border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                        disabled={requestDeletion.isPending}
                      >
                        {requestDeletion.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                        {t("requestReview")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="border-slate-800 bg-slate-900 text-white">
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("requestDeletionReviewTitle")}</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                          {t("requestDeletionReviewDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-slate-700 bg-transparent text-slate-300">{t("cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 text-white hover:bg-red-700"
                          onClick={() => requestDeletion.mutate({})}
                        >
                          {t("requestReview")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end gap-4">
            <Button
              variant="outline"
              className="border-slate-700 text-slate-300"
              onClick={() => setLocation("/dashboard")}
            >
              {t("cancel")}
            </Button>
            <Button
              className="bg-gradient-to-r from-cyan-500 to-blue-600"
              onClick={handleSaveSettings}
              disabled={updatePreferences.isPending}
            >
              {updatePreferences.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("saveSettings")}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
