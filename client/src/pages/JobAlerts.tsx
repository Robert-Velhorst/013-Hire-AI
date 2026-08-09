import { useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Bell,
  Plus,
  Trash2,
  Loader2,
  Search,
  MapPin,
  DollarSign,
  Briefcase,
  Clock,
  Mail,
  CheckCircle,
} from "lucide-react";
import { useLocale, type TranslationKey } from "@/contexts/LocaleContext";

const jobTypeLabels: Record<string, TranslationKey> = {
  "full-time": "fullTime",
  "part-time": "partTime",
  contract: "contract",
  temporary: "temporary",
};

export default function JobAlerts() {
  const { user, loading: authLoading } = useAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // Form state
  const [alertName, setAlertName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [platforms, setPlatforms] = useState("");
  const [minSalary, setMinSalary] = useState("");
  const [jobTypes, setJobTypes] = useState<string[]>(["full-time"]);
  const [frequency, setFrequency] = useState("daily");
  const { locale, t } = useLocale();

  // Fetch alerts
  const {
    data: alertPages,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = trpc.alerts.listPage.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined }
  );
  const alerts = useMemo(
    () => alertPages?.pages.flatMap((page) => page.items) ?? [],
    [alertPages]
  );

  // Mutations
  const createMutation = trpc.alerts.create.useMutation({
    onSuccess: () => {
      toast.success(t("matchingRuleCreated"));
      setIsCreateOpen(false);
      resetForm();
      refetch();
    },
    onError: () => {
      toast.error(t("createAlertFailed"));
    },
  });

  const deleteMutation = trpc.alerts.delete.useMutation({
    onSuccess: () => {
      toast.success(t("alertDeleted"));
      refetch();
    },
    onError: () => {
      toast.error(t("deleteAlertFailed"));
    },
  });

  const toggleMutation = trpc.alerts.toggle.useMutation({
    onSuccess: () => {
      toast.success(t("alertUpdated"));
      refetch();
    },
    onError: () => {
      toast.error(t("updateAlertFailed"));
    },
  });

  const resetForm = () => {
    setAlertName("");
    setKeywords("");
    setLocation("");
    setPlatforms("");
    setMinSalary("");
    setJobTypes(["full-time"]);
    setFrequency("daily");
  };

  const handleCreate = () => {
    if (!alertName || !keywords) {
      toast.error(t("requiredFields"));
      return;
    }

    createMutation.mutate({
      name: alertName,
      keywords,
      locations: location || undefined,
      platforms: platforms || undefined,
      minSalary: minSalary ? parseInt(minSalary) : undefined,
      jobTypes: jobTypes.join(","),
      frequency: frequency as "instant" | "daily" | "weekly",
    });
  };

  const handleDelete = (id: number) => {
    if (confirm(t("deleteAlertConfirm"))) {
      deleteMutation.mutate({ alertId: id });
    }
  };

  const handleToggle = (id: number, isActive: boolean) => {
    toggleMutation.mutate({ alertId: id, isActive: !isActive });
  };

  const getFrequencyLabel = (freq: string) => {
    switch (freq) {
      case "instant": return t("hourly");
      case "daily": return t("daily");
      case "weekly": return t("weekly");
      default: return freq;
    }
  };

  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Bell className="h-6 w-6 text-cyan-400" />
              {t("jobAlertsTitle")}
            </h1>
            <p className="text-slate-400">{t("jobAlertsDescription")}</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-cyan-500 to-blue-600">
                <Plus className="w-4 h-4 mr-2" />
                {t("createAlert")}
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
              <DialogHeader>
                <DialogTitle>{t("createJobAlert")}</DialogTitle>
                <DialogDescription className="text-slate-400">
                  {t("createAlertDescription")}
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t("alertName")}</Label>
                  <Input
                    id="name"
                    placeholder={t("alertNamePlaceholder")}
                    value={alertName}
                    onChange={(e) => setAlertName(e.target.value)}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="keywords">{t("keywords")}</Label>
                  <Input
                    id="keywords"
                    placeholder={t("keywordsPlaceholder")}
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    className="bg-slate-800 border-slate-700"
                  />
                  <p className="text-xs text-slate-500">{t("commaSeparatedKeywords")}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">{t("optionalLocation")}</Label>
                  <Input
                    id="location"
                    placeholder={t("locationPlaceholder")}
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="platforms">{t("optionalSources")}</Label>
                  <Input
                    id="platforms"
                    placeholder={t("sourcesPlaceholder")}
                    value={platforms}
                    onChange={(e) => setPlatforms(e.target.value)}
                    className="bg-slate-800 border-slate-700"
                  />
                  <p className="text-xs text-slate-500">{t("commaSeparatedSources")}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="salary">{t("optionalMinimumSalary")}</Label>
                  <Input
                    id="salary"
                    type="number"
                    placeholder={t("minimumSalaryPlaceholder")}
                    value={minSalary}
                    onChange={(e) => setMinSalary(e.target.value)}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("jobTypes")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {["full-time", "part-time", "contract", "temporary"].map((type) => (
                      <Badge
                        key={type}
                        variant={jobTypes.includes(type) ? "default" : "outline"}
                        className={`cursor-pointer ${
                          jobTypes.includes(type)
                            ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                            : "border-slate-600 text-slate-400 hover:border-slate-500"
                        }`}
                        onClick={() => {
                          if (jobTypes.includes(type)) {
                            setJobTypes(jobTypes.filter((t) => t !== type));
                          } else {
                            setJobTypes([...jobTypes, type]);
                          }
                        }}
                      >
                        {t(jobTypeLabels[type])}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="frequency">{t("matchingCadence")}</Label>
                  <Select value={frequency} onValueChange={setFrequency}>
                    <SelectTrigger className="bg-slate-800 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="instant">{t("hourly")}</SelectItem>
                      <SelectItem value="daily">{t("daily")}</SelectItem>
                      <SelectItem value="weekly">{t("weekly")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  className="bg-gradient-to-r from-cyan-500 to-blue-600"
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  {t("createAlert")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Alerts List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
          </div>
        ) : alerts.length > 0 ? (
          <div className="grid gap-4">
            {alerts.map((alert: any) => (
              <Card key={alert.id} className="bg-slate-900/50 border-slate-700/50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-white">{alert.name}</h3>
                        <Badge
                          variant="outline"
                          className={alert.isActive 
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                          }
                        >
                          {alert.isActive ? t("active") : t("paused")}
                        </Badge>
                        <Badge variant="outline" className="border-slate-600 text-slate-400">
                          <Clock className="w-3 h-3 mr-1" />
                          {getFrequencyLabel(alert.frequency)}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap gap-3 text-sm text-slate-400">
                        <span className="flex items-center gap-1">
                          <Search className="w-3 h-3" />
                          {alert.keywords}
                        </span>
                        {alert.locations && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {alert.locations}
                          </span>
                        )}
                        {alert.platforms && (
                          <span className="flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            {alert.platforms}
                          </span>
                        )}
                        {alert.minSalary && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            ${(alert.minSalary / 1000).toFixed(0)}k+
                          </span>
                        )}
                        {alert.jobTypes && (
                          <span className="flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            {alert.jobTypes}
                          </span>
                        )}
                      </div>

                      {alert.lastTriggered && (
                        <p className="text-xs text-slate-500 mt-2">
                          {t("lastMatched", { date: new Date(alert.lastTriggered).toLocaleDateString(locale) })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={alert.isActive}
                        onCheckedChange={() => handleToggle(alert.id, alert.isActive)}
                        aria-label={t("toggleAlert", { action: t(alert.isActive ? "pause" : "activate"), name: alert.name })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => handleDelete(alert.id)}
                        aria-label={t("deleteAlert", { name: alert.name })}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {hasNextPage ? (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-700"
                  disabled={isFetchingNextPage}
                  onClick={() => fetchNextPage()}
                >
                  {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Load more
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <Card className="bg-slate-900/50 border-slate-700/50">
            <CardContent className="py-16 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                <Bell className="w-10 h-10 text-cyan-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">{t("noJobAlerts")}</h3>
              <p className="text-slate-400 mb-6 max-w-md mx-auto">
                {t("noJobAlertsDescription")}
              </p>
              <Button
                className="bg-gradient-to-r from-cyan-500 to-blue-600"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t("createFirstAlert")}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tips Card */}
        <Card className="bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10 border-cyan-500/30">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Mail className="h-5 w-5 text-cyan-400" />
              {t("alertTips")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-slate-300">
            <ul className="list-disc space-y-2 pl-5">
              <li>{t("alertTipSpecific")}</li>
              <li>{t("alertTipMultiple")}</li>
              <li>{t("alertTipCadence")}</li>
              <li>{t("alertTipReview")}</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
