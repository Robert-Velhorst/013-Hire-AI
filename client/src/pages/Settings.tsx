import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Shield, Zap, Globe, Settings as SettingsIcon, LogOut, User, ChevronLeft, Loader2, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { localeLabels, SUPPORTED_LOCALES, type SupportedLocale } from "@shared/localization";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const { user, loading, isAuthenticated, logout } = useAuth();
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
      toast.success("Deletion review requested");
      utils.privacy.getDeletionRequest.invalidate();
    },
    onError: (error) => toast.error(error.message || "Unable to request deletion review"),
  });
  const cancelDeletionRequest = trpc.privacy.cancelDeletionRequest.useMutation({
    onSuccess: () => {
      toast.success("Deletion request cancelled");
      utils.privacy.getDeletionRequest.invalidate();
    },
    onError: (error) => toast.error(error.message || "Unable to cancel deletion request"),
  });
  const updateProfile = trpc.profile.update.useMutation({
    onSuccess: () => toast.success("Settings saved"),
    onError: (error) => toast.error(error.message || "Failed to save settings"),
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

  const handleLogout = async () => {
    await logout();
    setLocation("/");
    toast.success("Logged out successfully");
  };

  const handleSaveSettings = () => {
    let existingPreferences: Record<string, unknown> = {};
    try {
      existingPreferences = profile?.preferences ? JSON.parse(profile.preferences) : {};
    } catch {
      existingPreferences = {};
    }

    updateProfile.mutate({
      preferences: JSON.stringify({
        ...existingPreferences,
        mode: autoApply ? "auto_apply" : "review_first",
        dailyApplicationLimit: Number(maxApplicationsPerDay),
        scanFrequency,
      }),
    });
  };

  const handleExportData = async () => {
    const result = await privacyExport.refetch();
    if (!result.data) {
      toast.error("Unable to create the data export. Try again shortly.");
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
    toast.success("Data export created. Sensitive document bytes and connector credentials are excluded.");
  };

  const deletionRequestActive = deletionRequest?.status === "open" || deletionRequest?.status === "in_progress";
  const deletionStatusText = deletionRequestActive
    ? "Your request is awaiting operator review. No data has been deleted."
    : deletionRequest?.status === "resolved"
      ? "An operator recorded a retention decision. This status does not mean that data was deleted."
      : deletionRequest?.status === "dismissed"
        ? "The previous deletion request was cancelled or closed without deletion."
        : "No account deletion review is currently open.";

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Activity className="h-12 w-12 text-cyan-400 animate-pulse mx-auto mb-4" />
          <p className="text-slate-400">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setLocation("/")}>
            <Activity className="h-8 w-8 text-cyan-400" />
            <span className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Hire.AI
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              className="text-slate-300 hover:text-white"
              onClick={() => setLocation("/dashboard")}
            >
              Dashboard
            </Button>
            <Button
              variant="ghost"
              className="text-slate-300 hover:text-white"
              onClick={() => setLocation("/profile")}
            >
              Profile
            </Button>
            
            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600">
                  <span className="text-white font-semibold">
                    {user?.name?.charAt(0).toUpperCase() || "U"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-slate-900 border-slate-800" align="end">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium text-white">{user?.name || "User"}</p>
                  <p className="text-xs text-slate-400">{user?.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-slate-800" />
                <DropdownMenuItem 
                  className="text-slate-300 focus:bg-slate-800 focus:text-white cursor-pointer"
                  onClick={() => setLocation("/profile")}
                >
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-cyan-400 bg-cyan-500/10 focus:bg-cyan-500/20 focus:text-cyan-400 cursor-pointer"
                  onClick={() => setLocation("/settings")}
                >
                  <SettingsIcon className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-800" />
                <DropdownMenuItem 
                  className="text-red-400 focus:bg-red-500/10 focus:text-red-400 cursor-pointer"
                  onClick={handleLogout}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Back Button */}
        <Button
          variant="ghost"
          className="text-slate-400 hover:text-white mb-6"
          onClick={() => setLocation("/dashboard")}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
          <p className="text-slate-400">Manage application preparation and job scanning preferences</p>
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
                Application Preparation
              </CardTitle>
              <CardDescription className="text-slate-400">
                Configure how Hire.AI prepares matching jobs for your review
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-white">Accelerated Preparation</Label>
                  <p className="text-sm text-slate-400">
                    Automatically prepare high-fit applications for final review
                  </p>
                </div>
                <Switch
                  checked={autoApply}
                  onCheckedChange={setAutoApply}
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-white">Max Preparations Per Day</Label>
                <Select value={maxApplicationsPerDay} onValueChange={setMaxApplicationsPerDay}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="5" className="text-white">5 applications</SelectItem>
                    <SelectItem value="10" className="text-white">10 applications</SelectItem>
                    <SelectItem value="20" className="text-white">20 applications</SelectItem>
                    <SelectItem value="25" className="text-white">25 applications</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  Keep the daily review queue focused and manageable
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Job Scanning Settings */}
          <Card className="bg-slate-900/50 border-slate-800/50">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Globe className="h-5 w-5 text-blue-400" />
                Job Scanning
              </CardTitle>
              <CardDescription className="text-slate-400">
                Configure how often we scan for new job opportunities
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="text-white">Scan Frequency</Label>
                <Select value={scanFrequency} onValueChange={setScanFrequency}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="hourly" className="text-white">Every hour</SelectItem>
                    <SelectItem value="continuous" className="text-white">Every 15 minutes</SelectItem>
                    <SelectItem value="daily" className="text-white">Once daily</SelectItem>
                    <SelectItem value="twice-daily" className="text-white">Twice daily</SelectItem>
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
                Privacy & Security
              </CardTitle>
              <CardDescription className="text-slate-400">
                Manage your data and account security
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-4 rounded-lg bg-slate-800/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-white font-medium">Export Your Data</p>
                  <p className="text-sm text-slate-400">Download your profile, records, preferences, and audit history. Private file bytes and connector credentials remain excluded.</p>
                </div>
                <Button
                  variant="outline"
                  className="border-slate-700 text-slate-300"
                  onClick={handleExportData}
                  disabled={privacyExport.isFetching}
                >
                  {privacyExport.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Export
                </Button>
              </div>
              <div className="flex flex-col gap-4 rounded-lg border border-red-500/20 bg-red-500/5 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-white">Account deletion review</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Request an operator review of account erasure and legal retention. Active billing, disputes, verification records, or legal holds may require limited evidence to remain.
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
                        Cancel request
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="border-slate-800 bg-slate-900 text-white">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel the deletion review?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                          This closes the open request. It does not change any existing retention or account records.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-slate-700 bg-transparent text-slate-300">Keep request</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-slate-700 text-white hover:bg-slate-600"
                          onClick={() => cancelDeletionRequest.mutate()}
                        >
                          Cancel request
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
                        Request review
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="border-slate-800 bg-slate-900 text-white">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Request account deletion review?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                          Hire.AI will open a high-priority operator review. This does not immediately delete data or override active payment, dispute, verification, or legal retention obligations.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-slate-700 bg-transparent text-slate-300">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 text-white hover:bg-red-700"
                          onClick={() => requestDeletion.mutate({})}
                        >
                          Request review
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
              Cancel
            </Button>
            <Button
              className="bg-gradient-to-r from-cyan-500 to-blue-600"
              onClick={handleSaveSettings}
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Settings
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
