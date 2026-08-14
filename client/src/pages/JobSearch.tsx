import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  formatAutonomousRunSummary,
  hasAutonomousRunAttention,
} from "@/lib/autonomousRunSummary";
import { getAutonomousPolicyControlAction } from "@/lib/autonomousPolicyControl";
import {
  buildJobDecisionMutationInput,
  buildJobPreparationDecisionInput,
  type JobDecisionLifecycleAction,
} from "@/lib/jobDecisionActions";
import { getApplicationEvidenceGateSummary } from "@/lib/applicationEvidenceGates";
import { getSafeExternalUrl, openExternalUrl } from "@/lib/externalUrl";
import { getJobMatchDecisionSummary } from "@/lib/jobMatchDecisionSummary";
import { getJobSourcingControlSummary } from "@/lib/jobSourcingControl";
import { getJobDiscoveryStatusSummary } from "@/lib/jobDiscoveryStatus";
import { getJobListingDate } from "@/lib/jobListingDate";
import { formatJobSalary } from "@/lib/jobSalary";
import {
  getJobSearchAutonomousPolicy,
  isJobSearchAutonomousPolicyDirty,
} from "@/lib/jobSearchAutonomousPolicy";
import {
  countActiveJobSearchFilters,
  defaultJobSearchFilters,
  filterJobListings,
  type JobApplicationProcessFilter,
  type JobExperienceLevel,
  type JobListingSafetyFilter,
  type JobPostedWithin,
  type JobSearchFilterState,
  type JobTypeFilter,
} from "@/lib/jobSearchFilters";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Search,
  MapPin,
  Building2,
  Clock,
  DollarSign,
  Briefcase,
  Star,
  Heart,
  ExternalLink,
  Sparkles,
  Target,
  TrendingUp,
  Loader2,
  RefreshCw,
  BookmarkPlus,
  Send,
  AlertCircle,
  ClipboardCheck,
  Save,
  XCircle,
} from "lucide-react";
import { assessListingSafety } from "@shared/listingSafety";
import { useLocale } from "@/contexts/LocaleContext";

export default function JobSearch() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { locale, t } = useLocale();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedJobType, setSelectedJobType] = useState<JobTypeFilter>("all");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [salaryRange, setSalaryRange] = useState<[number, number]>([0, 300000]);
  const [salaryCurrency, setSalaryCurrency] = useState("");
  const selectedSalaryCurrency = /^[A-Z]{3}$/.test(salaryCurrency) ? salaryCurrency : "all";
  const [showRemoteOnly, setShowRemoteOnly] = useState(true);
  const [selectedExperienceLevel, setSelectedExperienceLevel] = useState<JobExperienceLevel>("all");
  const [selectedApplicationProcess, setSelectedApplicationProcess] = useState<JobApplicationProcessFilter>("all");
  const [postedWithin, setPostedWithin] = useState<JobPostedWithin>("all");
  const [visaSponsorshipOnly, setVisaSponsorshipOnly] = useState(false);
  const [openHiringSupportOnly, setOpenHiringSupportOnly] = useState(false);
  const [diversityFriendlyOnly, setDiversityFriendlyOnly] = useState(false);
  const [salaryDisclosedOnly, setSalaryDisclosedOnly] = useState(false);
  const [listingSafety, setListingSafety] = useState<JobListingSafetyFilter>(defaultJobSearchFilters.listingSafety);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [autonomousMode, setAutonomousMode] = useState<"review_first" | "auto_apply">("review_first");
  const [requireHumanReview, setRequireHumanReview] = useState(true);
  const [allowUnsupportedATS, setAllowUnsupportedATS] = useState(false);
  const [createFollowUps, setCreateFollowUps] = useState(false);

  const jobSearchFilters = useMemo<JobSearchFilterState>(() => ({
    query: searchQuery,
    location: selectedLocation,
    jobType: selectedJobType,
    platformId: selectedPlatform,
    salaryRange,
    salaryCurrency: selectedSalaryCurrency,
    remoteOnly: showRemoteOnly,
    experienceLevel: selectedExperienceLevel,
    applicationProcess: selectedApplicationProcess,
    visaSponsorshipOnly,
    openHiringSupportOnly,
    diversityFriendlyOnly,
    salaryDisclosedOnly,
    postedWithin,
    listingSafety,
  }), [
    diversityFriendlyOnly,
    openHiringSupportOnly,
    postedWithin,
    salaryDisclosedOnly,
    listingSafety,
    salaryRange,
    selectedSalaryCurrency,
    selectedLocation,
    searchQuery,
    selectedApplicationProcess,
    selectedExperienceLevel,
    selectedJobType,
    selectedPlatform,
    showRemoteOnly,
    visaSponsorshipOnly,
  ]);
  const [serverJobSearchFilters, setServerJobSearchFilters] = useState(jobSearchFilters);

  useEffect(() => {
    const timer = window.setTimeout(() => setServerJobSearchFilters(jobSearchFilters), 250);
    return () => window.clearTimeout(timer);
  }, [jobSearchFilters]);

  // The API applies the same canonical filter contract before pagination.
  const {
    data: jobPages,
    isLoading: jobsLoading,
    isFetchingNextPage: jobsFetchingNextPage,
    hasNextPage: hasMoreJobs,
    fetchNextPage: fetchMoreJobs,
    refetch: refetchJobs,
  } = trpc.jobs.listPage.useInfiniteQuery(
    { limit: 50, filters: serverJobSearchFilters },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined }
  );
  const jobsList = useMemo(
    () => jobPages?.pages.flatMap((page) => page.items) ?? [],
    [jobPages]
  );
  const visibleJobIds = useMemo(
    () => (jobsList || []).map((job) => job.id),
    [jobsList]
  );

  // Fetch platforms
  const { data: platformsData } = trpc.platforms.list.useQuery();
  const {
    data: discoveryStatus,
    refetch: refetchDiscoveryStatus,
  } = trpc.jobs.getDiscoveryStatus.useQuery();
  const { data: selectedJobSources } = trpc.jobs.getSources.useQuery(
    { id: selectedJob?.id ?? 0 },
    { enabled: Boolean(selectedJob?.id) }
  );

  // Fetch user profile for matching
  const {
    data: profileData,
    isLoading: profileLoading,
    refetch: refetchProfileData,
  } = trpc.profile.get.useQuery(undefined, { enabled: Boolean(user) });
  const { data: autonomousPlan, refetch: refetchAutonomousPlan } = trpc.automation.plan.useQuery(
    {
      mode: autonomousMode,
      remoteOnly: showRemoteOnly,
      requireHumanReview,
      allowUnsupportedATS,
      createFollowUps,
    },
    { enabled: Boolean(user) }
  );
  const visibleJobIdChunks = useMemo(() => {
    const chunks: number[][] = [];
    for (let index = 0; index < visibleJobIds.length; index += 250) {
      chunks.push(visibleJobIds.slice(index, index + 250));
    }
    return chunks;
  }, [visibleJobIds]);
  const applicationDecisionQueries = trpc.useQueries((queries) =>
    visibleJobIdChunks.map((jobIds) => queries.applications.listDecisions(
      { jobIds },
      { enabled: Boolean(user) && jobIds.length > 0 }
    ))
  );
  const applicationDecisions = useMemo<any[]>(
    () => applicationDecisionQueries.flatMap((query) => (query.data ?? []) as any[]),
    [applicationDecisionQueries]
  );
  const refetchApplicationDecisions = () =>
    Promise.all(applicationDecisionQueries.map((query) => query.refetch()));
  const jobMatchQueries = trpc.useQueries((queries) =>
    visibleJobIdChunks.map((jobIds) => queries.matching.getMatchesForJobs(
      { jobIds },
      { enabled: Boolean(user) && jobIds.length > 0 }
    ))
  );
  const jobMatches = useMemo<any[]>(
    () => jobMatchQueries.flatMap((query) => (query.data ?? []) as any[]),
    [jobMatchQueries]
  );
  const refetchJobMatches = () =>
    Promise.all(jobMatchQueries.map((query) => query.refetch()));
  const {
    data: operatingLedger,
    refetch: refetchOperatingLedger,
  } = trpc.applications.getOperatingLedger.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const {
    data: schedulerStatus,
    refetch: refetchSchedulerStatus,
  } = trpc.automation.schedulerStatus.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const preparationEvidenceGate = useMemo(() => {
    const summary = getApplicationEvidenceGateSummary(
      { status: "pending" },
      autonomousPlan?.evidenceGates || []
    );
    return summary.gates[0] || null;
  }, [autonomousPlan?.evidenceGates]);

  const autonomousEnabled = useMemo(() => {
    try {
      return JSON.parse(profileData?.preferences || "{}").autonomousEnabled === true;
    } catch {
      return false;
    }
  }, [profileData?.preferences]);

  useEffect(() => {
    if (!profileData?.preferences) return;

    const saved = getJobSearchAutonomousPolicy(profileData.preferences);
    setAutonomousMode(saved.mode);
    setShowRemoteOnly(saved.remoteOnly);
    setRequireHumanReview(saved.requireHumanReview);
    setAllowUnsupportedATS(saved.allowUnsupportedATS);
    setCreateFollowUps(saved.createFollowUps);
  }, [profileData?.preferences]);

  const jobSearchPolicyDraft = {
    mode: autonomousMode,
    remoteOnly: showRemoteOnly,
    requireHumanReview,
    allowUnsupportedATS,
    createFollowUps,
  };
  const hasUnsavedJobSearchPolicy = isJobSearchAutonomousPolicyDirty(
    profileData?.preferences,
    jobSearchPolicyDraft
  ) && Boolean(user) && !profileLoading;

  // AI Match mutation
  const matchMutation = trpc.matching.calculateMatch.useMutation({
    onSuccess: async (data: any) => {
      const score = data.overallScore || data.matchScore || 0;
      if (data.analysisSource === "deterministic_fallback") {
        toast.info(t("profileMatchScore", { score }));
      } else {
        toast.success(t("aiMatchScore", { score }));
      }
      await refetchJobMatches();
    },
    onError: () => {
      toast.error(t("matchCalculationFailed"));
    },
  });

  const decideMutation = trpc.applications.decide.useMutation({
    onSuccess: async (result, variables) => {
      if (variables.decision === "save") {
        toast.success(t("jobSavedWithReason"));
      } else if (variables.decision === "ignore") {
        toast.success(t("jobIgnored"));
      } else {
        toast.success(t(result.existing ? "decisionUpdated" : "applicationDecisionRecorded"));
      }
      await Promise.all([
        refetchApplicationDecisions(),
        refetchAutonomousPlan(),
        refetchOperatingLedger(),
      ]);
    },
    onError: (error) => {
      toast.error(error.message || t("decisionRecordFailed"));
    },
  });

  const autonomousRunMutation = trpc.automation.run.useMutation({
    onSuccess: async (result: any) => {
      const message = formatAutonomousRunSummary(result);
      if (hasAutonomousRunAttention(result)) {
        toast.warning(message);
      } else {
        toast.success(message);
      }
      await Promise.all([
        refetchApplicationDecisions(),
        refetchAutonomousPlan(),
        refetchJobs(),
        refetchOperatingLedger(),
        refetchSchedulerStatus(),
      ]);
    },
    onError: () => toast.error(t("autonomousRunFailed")),
  });
  const saveJobSearchPolicyMutation = trpc.profile.updatePreferences.useMutation({
    onSuccess: async () => {
      toast.success(t("sourcingPolicySaved"));
      await Promise.all([
        refetchProfileData(),
        refetchAutonomousPlan(),
        refetchOperatingLedger(),
      ]);
    },
    onError: (error) => toast.error(error.message || t("sourcingPolicySaveFailed")),
  });

  const autonomousDecisionByJobId = useMemo(() => {
    return new Map((autonomousPlan?.decisions || []).map((decision: any) => [decision.jobId, decision]));
  }, [autonomousPlan?.decisions]);
  const applicationDecisionByJobId = useMemo(() => {
    return new Map((applicationDecisions || []).map((decision: any) => [decision.jobId, decision]));
  }, [applicationDecisions]);
  const latestJobMatchByJobId = useMemo(() => {
    const matches = new Map<number, any>();
    for (const match of jobMatches || []) {
      const current = matches.get(match.jobId);
      const matchUpdatedAt = new Date(match.updatedAt || match.createdAt).getTime();
      const currentUpdatedAt = current
        ? new Date(current.updatedAt || current.createdAt).getTime()
        : 0;
      if (!current || matchUpdatedAt > currentUpdatedAt) {
        matches.set(match.jobId, match);
      }
    }
    return matches;
  }, [jobMatches]);
  const platformNameById = useMemo(
    () => new Map((platformsData || []).map((platform) => [platform.id, platform.name])),
    [platformsData]
  );

  // Filter jobs
  const filteredJobs = useMemo(() => {
    if (!jobsList) return [];
    return filterJobListings(jobsList, jobSearchFilters);
  }, [jobSearchFilters, jobsList]);

  const activeFilterCount = useMemo(
    () => countActiveJobSearchFilters(jobSearchFilters),
    [jobSearchFilters]
  );

  const resetFilters = () => {
    setSearchQuery(defaultJobSearchFilters.query);
    setSelectedLocation(defaultJobSearchFilters.location);
    setSelectedJobType(defaultJobSearchFilters.jobType);
    setSelectedPlatform(defaultJobSearchFilters.platformId);
    setSalaryRange(defaultJobSearchFilters.salaryRange);
    setSalaryCurrency("");
    setShowRemoteOnly(defaultJobSearchFilters.remoteOnly);
    setSelectedExperienceLevel(defaultJobSearchFilters.experienceLevel);
    setSelectedApplicationProcess(defaultJobSearchFilters.applicationProcess);
    setPostedWithin(defaultJobSearchFilters.postedWithin);
    setVisaSponsorshipOnly(defaultJobSearchFilters.visaSponsorshipOnly);
    setOpenHiringSupportOnly(defaultJobSearchFilters.openHiringSupportOnly);
    setDiversityFriendlyOnly(defaultJobSearchFilters.diversityFriendlyOnly);
    setSalaryDisclosedOnly(defaultJobSearchFilters.salaryDisclosedOnly);
    setListingSafety(defaultJobSearchFilters.listingSafety);
  };

  const scoredJobs = useMemo(() => {
    return filteredJobs.map((job: any) => {
      const persistedMatch = latestJobMatchByJobId.get(job.id);
      const summary = getJobMatchDecisionSummary(
        persistedMatch ? { ...job, matchScore: persistedMatch.matchScore } : job,
        profileData,
        autonomousDecisionByJobId.get(job.id),
        applicationDecisionByJobId.get(job.id)
      );
      return { ...job, matchScore: summary.matchScore, matchSummary: summary };
    });
  }, [applicationDecisionByJobId, autonomousDecisionByJobId, filteredJobs, latestJobMatchByJobId, profileData]);

  // Group jobs by match score
  const groupedJobs = useMemo(() => {
    const excellent: any[] = [];
    const good: any[] = [];
    const fair: any[] = [];
    const decided: any[] = [];

    scoredJobs.forEach((job: any) => {
      if (job.matchSummary?.isDecided) decided.push(job);
      if (job.matchScore >= 80) excellent.push(job);
      else if (job.matchScore >= 60) good.push(job);
      else fair.push(job);
    });

    return { excellent, good, fair, decided, all: scoredJobs };
  }, [scoredJobs]);
  const sourcingControl = useMemo(() => getJobSourcingControlSummary(scoredJobs), [scoredJobs]);
  const discoveryControl = useMemo(
    () => getJobDiscoveryStatusSummary(discoveryStatus),
    [discoveryStatus]
  );
  const autonomousControl = useMemo(() => getAutonomousPolicyControlAction({
    plan: autonomousPlan,
    scheduler: schedulerStatus,
    campaign: operatingLedger?.campaign,
    settings: {
      autonomousEnabled,
      requireHumanReview,
    },
  }), [
    autonomousEnabled,
    autonomousPlan,
    operatingLedger?.campaign,
    requireHumanReview,
    schedulerStatus,
  ]);
  const autonomousControlTone = {
    low: "border-slate-700 text-slate-300",
    medium: "border-amber-500/40 text-amber-300",
    high: "border-red-500/40 text-red-300",
  }[autonomousControl.risk];

  const selectedJobSummary = useMemo(() => {
    if (!selectedJob) return null;
    const persistedMatch = latestJobMatchByJobId.get(selectedJob.id);
    return getJobMatchDecisionSummary(
      persistedMatch ? { ...selectedJob, matchScore: persistedMatch.matchScore } : selectedJob,
      profileData,
      autonomousDecisionByJobId.get(selectedJob.id),
      applicationDecisionByJobId.get(selectedJob.id)
    );
  }, [applicationDecisionByJobId, autonomousDecisionByJobId, latestJobMatchByJobId, profileData, selectedJob]);

  const handleApply = async (job: any) => {
    if (!user) {
      toast.error(t("signInToPrepareApplication"));
      return;
    }
    if (preparationEvidenceGate) {
      toast.info(preparationEvidenceGate.detail || t("resolveProfileEvidence"));
      setLocation(preparationEvidenceGate.route || "/profile");
      return;
    }
    const summary = getJobMatchDecisionSummary(
      job,
      profileData,
      autonomousDecisionByJobId.get(job.id),
      applicationDecisionByJobId.get(job.id)
    );
    decideMutation.mutate(buildJobPreparationDecisionInput(job, summary, "Job Search"));
  };

  const handleSaveJob = async (job: any) => {
    if (!user) {
      toast.error(t("signInToSaveJobs"));
      return;
    }
    const summary = getJobMatchDecisionSummary(
      job,
      profileData,
      autonomousDecisionByJobId.get(job.id),
      applicationDecisionByJobId.get(job.id)
    );
    decideMutation.mutate({
      jobId: job.id,
      decision: "save",
      decisionReason: `Saved ${job.title} at ${job.company} for later review. ${summary.nextAction}`,
      matchScore: summary.matchScore,
      riskLevel: summary.riskLevel === "high" ? "medium" : summary.riskLevel,
      reviewRequired: true,
      reviewReason: summary.missingSkills.length > 0
        ? `Saved to review missing skills: ${summary.missingSkills.join(", ")}.`
        : "Saved for later review from Job Search.",
    });
  };

  const handleDecisionLifecycleAction = (job: any, action: JobDecisionLifecycleAction) => {
    if (!user) {
      toast.error(t("signInToManageDecisions"));
      return;
    }

    const summary = getJobMatchDecisionSummary(
      job,
      profileData,
      autonomousDecisionByJobId.get(job.id),
      applicationDecisionByJobId.get(job.id)
    );
    decideMutation.mutate(buildJobDecisionMutationInput(job, summary, action));
  };

  const handleCalculateMatch = async (job: any) => {
    if (!user) {
      toast.error(t("signInToCalculateMatch"));
      return;
    }
    matchMutation.mutate({ jobId: job.id });
  };

  const handleAutonomousControlAction = () => {
    if (autonomousControl.runsAgent) {
      if (hasUnsavedJobSearchPolicy) {
        toast.info(t("savePolicyBeforeRun"));
        return;
      }
      autonomousRunMutation.mutate({
        mode: autonomousMode,
        remoteOnly: showRemoteOnly,
        requireHumanReview,
        allowUnsupportedATS,
        createFollowUps,
      });
      return;
    }

    setLocation(autonomousControl.route);
  };

  const handleSaveJobSearchPolicy = () => {
    saveJobSearchPolicyMutation.mutate({
      ...jobSearchPolicyDraft,
    });
  };

  const getMatchBadgeColor = (score: number) => {
    if (score >= 80) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (score >= 60) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  };

  const getFitBadgeClass = (fit: string) => {
    switch (fit) {
      case "fit":
        return "border-emerald-500/30 text-emerald-300";
      case "partial":
        return "border-amber-500/30 text-amber-300";
      case "gap":
        return "border-red-500/30 text-red-300";
      default:
        return "border-slate-600 text-slate-300";
    }
  };
  const getRiskLabel = (risk: string) => t(({
    low: "severityLow", medium: "severityMedium", high: "severityHigh",
  } as const)[risk as "low" | "medium" | "high"] || "severityMedium");
  const getFitLabel = (fit: string) => t(({
    fit: "fitLabel", partial: "partialFitLabel", gap: "gapLabel", unknown: "unknownLabel",
  } as const)[fit as "fit" | "partial" | "gap" | "unknown"] || "unknownLabel");
  const getDecisionLabel = (decision: string | null | undefined) => t(({
    review: "queueReview", apply: "queueReview", manual_apply: "queueManualTask", save: "saveForLater", ignore: "ignoreAction",
  } as const)[decision as "review" | "apply" | "manual_apply" | "save" | "ignore"] || "queueReview");
  const autonomousControlCopy = ({
    paused: ["controlPausedLabel", "controlPausedHeadline", "controlPausedCta"],
    blocked: ["controlBlockedLabel", "controlBlockedHeadline", "controlBlockedCta"],
    monitoring_attention: ["controlMonitoringLabel", "controlMonitoringHeadline", "controlMonitoringCta"],
    review_ready: ["controlReviewLabel", "controlReviewHeadline", "controlReviewCta"],
    manual_ready: ["controlManualLabel", "controlManualHeadline", "controlManualCta"],
    follow_up_ready: ["controlFollowUpLabel", "controlFollowUpHeadline", "controlFollowUpCta"],
    ready_to_run: ["controlRunLabel", "controlRunHeadline", "controlRunCta"],
    scheduled: ["controlScheduledLabel", "controlScheduledHeadline", "controlScheduledCta"],
    idle: ["controlIdleLabel", "controlIdleHeadline", "controlIdleCta"],
  } as const)[autonomousControl.status];
  const sourcingTone = {
    empty: "border-slate-700 bg-slate-900/50",
    blocked: "border-amber-500/40 bg-amber-500/10",
    review_ready: "border-emerald-500/40 bg-emerald-500/10",
    manual_tasks: "border-orange-500/40 bg-orange-500/10",
    save_for_later: "border-blue-500/40 bg-blue-500/10",
    low_signal: "border-slate-700 bg-slate-900/50",
  }[sourcingControl.status];
  const sourcingBadgeTone = {
    empty: "border-slate-600 text-slate-300",
    blocked: "border-amber-500/40 text-amber-300",
    review_ready: "border-emerald-500/40 text-emerald-300",
    manual_tasks: "border-orange-500/40 text-orange-300",
    save_for_later: "border-blue-500/40 text-blue-300",
    low_signal: "border-slate-600 text-slate-300",
  }[sourcingControl.status];
  const discoveryTone = {
    no_active_sources: "border-red-500/40 bg-red-500/10 text-red-100",
    awaiting_first_scan: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    stale: "border-orange-500/40 bg-orange-500/10 text-orange-100",
    degraded: "border-red-500/40 bg-red-500/10 text-red-100",
    partial: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    current: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  }[discoveryControl.status];

  const renderJobCard = (job: any, showMatchScore = true) => {
    const listingDate = getJobListingDate(job);
    const listingSafetyAssessment = assessListingSafety(job);

    return (
      <Card
        key={job.id}
        data-testid="job-card"
        data-job-id={job.id}
        className="group cursor-pointer border-slate-700/50 bg-slate-900/50 transition-all duration-300 hover:border-cyan-500/50"
        onClick={() => setSelectedJob(job)}
      >
      <CardContent className="p-4">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <button
                type="button"
                aria-label={t("openJobDetails", { title: job.title, company: job.company || t("companyFallback") })}
                className="min-w-0 truncate text-left font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedJob(job);
                }}
              >
                <h3 className="truncate">{job.title}</h3>
              </button>
              {showMatchScore && job.matchScore != null && (
                <Badge variant="outline" className={getMatchBadgeColor(job.matchScore)}>
                  <Target className="w-3 h-3 mr-1" />
                  {job.matchScore}%
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-400 mb-2">
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {job.company || t("companyFallback")}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {job.location || t("remoteFallback")}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {job.jobType && (
                <Badge variant="secondary" className="text-xs bg-slate-800 text-slate-300">
                  <Briefcase className="w-3 h-3 mr-1" />
                  {job.jobType}
                </Badge>
              )}
              {(job.salaryMin || job.salaryMax) && (
                <Badge variant="secondary" className="text-xs bg-slate-800 text-slate-300">
                  <DollarSign className="w-3 h-3 mr-1" />
                  {formatJobSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, locale)}
                </Badge>
              )}
              {listingDate && (
                <Badge variant="secondary" className="text-xs bg-slate-800 text-slate-300">
                  <Clock className="w-3 h-3 mr-1" />
                  {listingDate.source === "posted" ? t("listingPosted") : t("listingDiscovered")} {listingDate.date.toLocaleDateString(locale)}
                </Badge>
              )}
              {listingSafetyAssessment.status === "review" && (
                <Badge variant="secondary" className="text-xs border border-amber-500/40 bg-amber-500/10 text-amber-200">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {t("reviewSignals")}
                </Badge>
              )}
            </div>
            {job.matchSummary && (
              <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={getMatchBadgeColor(job.matchSummary.matchScore)}>
                    {getDecisionLabel(job.matchSummary.recommendedDecision)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={job.matchSummary.riskLevel === "high"
                      ? "border-amber-500/40 text-amber-300"
                      : job.matchSummary.riskLevel === "low"
                        ? "border-emerald-500/40 text-emerald-300"
                        : "border-blue-500/40 text-blue-300"}
                  >
                    {t("riskLabel", { risk: getRiskLabel(job.matchSummary.riskLevel) })}
                  </Badge>
                  {job.matchSummary.blockers.length > 0 && (
                    <Badge variant="outline" className="border-orange-500/40 text-orange-300">
                      {t("blockersCount", { count: job.matchSummary.blockers.length })}
                    </Badge>
                  )}
                  {job.matchSummary.isDecided && (
                    <Badge
                      data-testid="job-card-ledger-decision"
                      variant="outline"
                      className="border-cyan-500/40 text-cyan-300"
                    >
                      {t("ledgerDecision", { decision: getDecisionLabel(job.matchSummary.ledgerDecision) })}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-slate-400">{job.matchSummary.nextAction}</p>
                {job.matchSummary.ledgerDecisionReason && (
                  <p className="mt-2 line-clamp-1 text-xs text-slate-500">
                    {job.matchSummary.ledgerDecisionReason}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={t("saveJobForReview", { title: job.title })}
              className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleSaveJob(job);
              }}
            >
              <BookmarkPlus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
      </Card>
    );
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
            <h1 className="text-2xl font-bold text-white">{t("jobSearchTitle")}</h1>
            <p className="text-slate-400">
              {t("jobsAcrossPlatforms", { jobs: filteredJobs.length, platforms: platformsData?.length || 0 })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={autonomousMode} onValueChange={(value) => setAutonomousMode(value as "review_first" | "auto_apply")}>
              <SelectTrigger className="w-[150px] bg-slate-800 border-slate-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="review_first">{t("reviewFirst")}</SelectItem>
                <SelectItem value="auto_apply">{t("accelerated")}</SelectItem>
              </SelectContent>
            </Select>
            {hasUnsavedJobSearchPolicy && (
              <Badge data-testid="job-search-unsaved-policy" variant="outline" className="border-amber-500/40 text-amber-300">
                {t("unsavedPolicy")}
              </Badge>
            )}
            <Button
              data-testid="job-search-save-policy"
              variant="outline"
              size="sm"
              onClick={handleSaveJobSearchPolicy}
              disabled={!hasUnsavedJobSearchPolicy || saveJobSearchPolicyMutation.isPending || profileLoading}
            >
              {saveJobSearchPolicyMutation.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Save className="w-4 h-4 mr-2" />}
              {t("savePolicy")}
            </Button>
            <Button
              data-testid="job-search-autonomous-primary"
              size="sm"
              onClick={handleAutonomousControlAction}
              disabled={autonomousRunMutation.isPending && autonomousControl.runsAgent}
              className={autonomousControl.risk === "high"
                ? "bg-red-600 hover:bg-red-500"
                : autonomousControl.runsAgent
                  ? "bg-gradient-to-r from-cyan-500 to-blue-600"
                  : "bg-amber-600 hover:bg-amber-500"}
            >
              {autonomousRunMutation.isPending && autonomousControl.runsAgent
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : autonomousControl.runsAgent
                  ? <Sparkles className="w-4 h-4 mr-2" />
                  : <ExternalLink className="w-4 h-4 mr-2" />}
              {t(autonomousControlCopy[2])}
            </Button>
            <Button
              variant="outline"
              size="sm"
              title={t("refreshListingsDescription")}
              onClick={() => void Promise.all([refetchJobs(), refetchDiscoveryStatus()])}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {t("refreshListings")}
            </Button>
          </div>
        </div>

        {autonomousPlan && (
          <Card className="bg-slate-900/50 border-cyan-500/30">
            <CardContent className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    <h2 className="text-sm font-semibold text-white">{t("autonomousSourcingPlan")}</h2>
                  </div>
                  <p className="text-sm text-slate-400">
                     {t("autonomousPlanSummary", { scanned: autonomousPlan.summary.scanned, eligible: autonomousPlan.summary.eligible, review: autonomousPlan.summary.queuedForReview, manual: autonomousPlan.summary.manualApply })}
                    {autonomousPlan.summary.blocked > 0
                      ? ` ${t("blockedHighFitRoles", { count: autonomousPlan.summary.blocked })}`
                      : ""}
                    {autonomousPlan.summary.expiredJobsSkipped > 0
                      ? ` ${t("excludedStalePostings", { count: autonomousPlan.summary.expiredJobsSkipped })}`
                      : ""}
                  </p>
                  {autonomousPlan.policyWarnings?.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {autonomousPlan.policyWarnings.slice(0, 3).map((warning: string) => (
                        <p key={warning} className="text-xs text-amber-300">{warning}</p>
                      ))}
                    </div>
                  )}
                  {autonomousPlan.evidenceGates?.length > 0 && (
                    <div data-testid="job-search-autonomous-evidence-gates" className="mt-3 space-y-2">
                      {autonomousPlan.evidenceGates.slice(0, 3).map((gate: any) => (
                        <div key={gate.id || gate.label} className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-amber-200">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {gate.label || t("evidenceGateFallback")}
                          </div>
                          <p className="mt-1 text-xs text-amber-100/80">{gate.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div
                    data-testid="job-search-autonomous-control"
                    className="mt-3 rounded-md border border-slate-800 bg-slate-950/40 p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={autonomousControlTone}>
                        {t(autonomousControlCopy[0])}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={autonomousControl.approvalGated
                          ? "border-amber-500/40 text-amber-300"
                          : "border-slate-700 text-slate-300"}
                      >
                        {autonomousControl.approvalGated ? t("billingApprovalGated") : t("internalAction")}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium text-white">{t(autonomousControlCopy[1])}</p>
                    <p className="mt-1 text-sm text-slate-400">{autonomousControl.detail}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-7">
                  <div className="rounded-md bg-slate-800 px-3 py-2">
                    <p className="text-lg font-bold text-white">{autonomousPlan.summary.eligible}</p>
                    <p className="text-xs text-slate-400">{t("eligible")}</p>
                  </div>
                  <div className="rounded-md bg-slate-800 px-3 py-2">
                    <p className="text-lg font-bold text-cyan-400">{autonomousPlan.summary.queuedForReview}</p>
                    <p className="text-xs text-slate-400">{t("reviewLabel")}</p>
                  </div>
                  <div className="rounded-md bg-slate-800 px-3 py-2">
                    <p className="text-lg font-bold text-amber-400">{autonomousPlan.summary.manualApply}</p>
                    <p className="text-xs text-slate-400">{t("manualLabel")}</p>
                  </div>
                  <div className="rounded-md bg-slate-800 px-3 py-2">
                    <p className="text-lg font-bold text-red-300">{autonomousPlan.summary.blocked || 0}</p>
                    <p className="text-xs text-slate-400">{t("blockedLabel")}</p>
                  </div>
                  <div className="rounded-md bg-slate-800 px-3 py-2">
                    <p className="text-lg font-bold text-purple-400">{autonomousPlan.summary.followUpsActionReady ?? autonomousPlan.summary.followUpsDue}</p>
                    <p className="text-xs text-slate-400">{t("followUpsReady")}</p>
                  </div>
                  <div className="rounded-md bg-slate-800 px-3 py-2">
                    <p className="text-lg font-bold text-amber-400">{autonomousPlan.evidenceGates?.length || 0}</p>
                    <p className="text-xs text-slate-400">{t("gatesLabel")}</p>
                  </div>
                  <div className="rounded-md bg-slate-800 px-3 py-2">
                    <p className="text-lg font-bold text-slate-300">{autonomousPlan.summary.expiredJobsSkipped || 0}</p>
                    <p className="text-xs text-slate-400">{t("staleLabel")}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-300">
                  <Checkbox checked={requireHumanReview} onCheckedChange={(checked) => setRequireHumanReview(Boolean(checked))} />
                  {t("humanReview")}
                </label>
                <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-300">
                  <Checkbox checked={allowUnsupportedATS} onCheckedChange={(checked) => setAllowUnsupportedATS(Boolean(checked))} />
                  {t("manualTasks")}
                </label>
                <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-300">
                  <Checkbox checked={createFollowUps} onCheckedChange={(checked) => setCreateFollowUps(Boolean(checked))} />
                  {t("queueFollowUps")}
                </label>
              </div>
            </CardContent>
          </Card>
        )}

        <Card data-testid="job-sourcing-control" className={sourcingTone}>
          <CardContent className="p-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={sourcingBadgeTone}>
                    {sourcingControl.label}
                  </Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">
                    {t("visibleJobs", { count: sourcingControl.totalJobs })}
                  </Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">
                    {t("averageMatch", { score: sourcingControl.averageScore })}
                  </Badge>
                </div>
                <h2 className="text-xl font-semibold text-white">{t("sourcingControlTitle")}</h2>
                <p className="mt-1 text-sm text-slate-300">{sourcingControl.headline}</p>
                <p className="mt-2 max-w-3xl text-sm text-slate-400">{sourcingControl.nextAction}</p>
                <div
                  data-testid="job-discovery-status"
                  data-discovery-status={discoveryControl.status}
                  className={`mt-3 max-w-3xl rounded-md border px-3 py-2 ${discoveryTone}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-current text-current">
                      {discoveryControl.label}
                    </Badge>
                    <span className="text-xs font-medium">
                      {t("activeSourcesCount", { count: discoveryControl.activeSources })}
                    </span>
                    <span className="text-xs">
                      {t("freshSources24h", { count: discoveryControl.sourcesWithFreshScrape })}
                    </span>
                    <span className="text-xs">
                      {t("canonicalJobsCount", { count: discoveryControl.canonicalJobs })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 opacity-90">{discoveryControl.detail}</p>
                </div>
              </div>
              <Button
                data-testid="job-sourcing-primary"
                className="bg-cyan-600 hover:bg-cyan-500 lg:w-56"
                onClick={() => setActiveTab(sourcingControl.primaryTab)}
              >
                <Target className="mr-2 h-4 w-4" />
                {sourcingControl.primaryCta}
              </Button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-9">
              {[
                [t("reviewLabel"), sourcingControl.reviewReady, "excellent"],
                [t("manualLabel"), sourcingControl.manualTasks, "good"],
                [t("metricSave"), sourcingControl.saveForLater, "good"],
                [t("metricIgnore"), sourcingControl.ignored, "fair"],
                [t("decisionLabel"), sourcingControl.decided, "decided"],
                [t("blockedLabel"), sourcingControl.blocked, "all"],
                [t("metricHighRisk"), sourcingControl.highRisk, "all"],
                [t("metricHighMatch"), sourcingControl.highMatch, "excellent"],
                [t("metricAverage"), `${sourcingControl.averageScore}%`, "all"],
              ].map(([label, value, tab]) => (
                <button
                  key={String(label)}
                  type="button"
                  data-testid={`job-sourcing-metric-${String(label).toLowerCase().replace(/\s+/g, "-")}`}
                  className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-left transition hover:border-cyan-500/50 hover:bg-slate-900"
                  onClick={() => setActiveTab(String(tab))}
                >
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{value}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Search and Filters */}
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder={t("searchJobsPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-slate-800 border-slate-700"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Select value={selectedJobType} onValueChange={(value) => setSelectedJobType(value as JobTypeFilter)}>
                  <SelectTrigger className="w-[140px] bg-slate-800 border-slate-700">
                    <SelectValue placeholder={t("jobTypeFilter")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allJobTypes")}</SelectItem>
                    <SelectItem value="full-time">{t("fullTime")}</SelectItem>
                    <SelectItem value="part-time">{t("partTime")}</SelectItem>
                    <SelectItem value="contract">{t("contract")}</SelectItem>
                    <SelectItem value="temporary">{t("temporary")}</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                  <SelectTrigger className="w-[160px] bg-slate-800 border-slate-700">
                    <SelectValue placeholder={t("platformFilter")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allPlatforms")}</SelectItem>
                    {platformsData?.map((platform) => (
                      <SelectItem key={platform.id} value={platform.id.toString()}>
                        {platform.name}{platform.discoveryPolicy?.mode === "automated" ? "" : ` - ${t("integrationRequired")}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 rounded-md border border-slate-700">
                  <Checkbox
                    id="remote"
                    checked={showRemoteOnly}
                    onCheckedChange={(checked) => setShowRemoteOnly(checked as boolean)}
                  />
                  <label htmlFor="remote" className="text-sm text-slate-300 cursor-pointer">
                     {t("remoteOnly")}
                  </label>
                </div>
                <Select value={selectedExperienceLevel} onValueChange={(value) => setSelectedExperienceLevel(value as JobExperienceLevel)}>
                  <SelectTrigger data-testid="job-filter-experience" className="w-[150px] bg-slate-800 border-slate-700">
                    <SelectValue placeholder={t("experienceFilter")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allExperienceLevels")}</SelectItem>
                    <SelectItem value="entry">{t("entryLevel")}</SelectItem>
                    <SelectItem value="junior">{t("juniorLevel")}</SelectItem>
                    <SelectItem value="mid">{t("midLevel")}</SelectItem>
                    <SelectItem value="senior">{t("seniorLevel")}</SelectItem>
                    <SelectItem value="lead">{t("leadLevel")}</SelectItem>
                    <SelectItem value="executive">{t("executiveLevel")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={selectedApplicationProcess} onValueChange={(value) => setSelectedApplicationProcess(value as JobApplicationProcessFilter)}>
                  <SelectTrigger data-testid="job-filter-application-process" className="w-[150px] bg-slate-800 border-slate-700">
                    <SelectValue placeholder={t("applicationSystemFilter")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allSystems")}</SelectItem>
                    <SelectItem value="greenhouse">Greenhouse</SelectItem>
                    <SelectItem value="lever">Lever</SelectItem>
                    <SelectItem value="workday">Workday</SelectItem>
                    <SelectItem value="email">{t("emailLabel")}</SelectItem>
                    <SelectItem value="other">{t("otherLabel")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={listingSafety} onValueChange={(value) => setListingSafety(value as JobListingSafetyFilter)}>
                  <SelectTrigger data-testid="job-filter-listing-safety" className="w-[170px] bg-slate-800 border-slate-700">
                    <SelectValue placeholder={t("listingSafetyFilter")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clear">{t("noRiskSignals")}</SelectItem>
                    <SelectItem value="review">{t("needsReview")}</SelectItem>
                    <SelectItem value="all">{t("allNonBlocked")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={postedWithin} onValueChange={(value) => setPostedWithin(value as JobPostedWithin)}>
                  <SelectTrigger data-testid="job-filter-posted-within" className="w-[140px] bg-slate-800 border-slate-700">
                    <SelectValue placeholder={t("postedFilter")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("anyDate")}</SelectItem>
                    <SelectItem value="1">{t("past24Hours")}</SelectItem>
                    <SelectItem value="3">{t("past3Days")}</SelectItem>
                    <SelectItem value="7">{t("pastWeek")}</SelectItem>
                    <SelectItem value="30">{t("pastMonth")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-700">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-sm text-slate-400">{t("salaryRange")}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-300">
                    {selectedSalaryCurrency === "all"
                      ? t("chooseCurrency")
                      : formatJobSalary(salaryRange[0], salaryRange[1], selectedSalaryCurrency, locale)}
                  </span>
                  {activeFilterCount > 0 && (
                    <Button data-testid="job-filter-clear" type="button" size="sm" variant="ghost" className="h-7 px-2 text-slate-300" onClick={resetFilters}>
                      <XCircle className="mr-1 h-3.5 w-3.5" />
                      {t("clearFilters", { count: activeFilterCount })}
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-52 relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  data-testid="job-filter-location"
                  placeholder={t("jobLocationPlaceholder")}
                  value={selectedLocation}
                  onChange={(event) => setSelectedLocation(event.target.value)}
                  className="pl-10 bg-slate-800 border-slate-700"
                />
              </div>
              <Input
                data-testid="job-filter-salary-currency"
                value={salaryCurrency}
                onChange={(event) => {
                  const value = event.target.value.trim().toUpperCase();
                  setSalaryCurrency(value);
                }}
                placeholder={t("currencyCodePlaceholder")}
                maxLength={3}
                className="mb-3 bg-slate-800 border-slate-700 text-white"
              />
              <Slider
                value={salaryRange}
                onValueChange={(value) => setSalaryRange(value as [number, number])}
                min={0}
                max={300000}
                step={10000}
                className="w-full"
                disabled={selectedSalaryCurrency === "all"}
              />
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
                {[
                  ["visa-sponsorship", t("visaSponsorship"), visaSponsorshipOnly, setVisaSponsorshipOnly],
                  ["open-hiring-support", t("openHiringSupport"), openHiringSupportOnly, setOpenHiringSupportOnly],
                  ["diversity-friendly", t("diversityFriendly"), diversityFriendlyOnly, setDiversityFriendlyOnly],
                  ["salary-disclosed", t("salaryDisclosed"), salaryDisclosedOnly, setSalaryDisclosedOnly],
                ].map(([id, label, checked, setChecked]) => (
                  <div key={id as string} className="flex items-center gap-2">
                    <Checkbox
                      id={id as string}
                      checked={checked as boolean}
                      onCheckedChange={(value) => (setChecked as (next: boolean) => void)(value === true)}
                    />
                    <label htmlFor={id as string} className="text-sm text-slate-300 cursor-pointer">{label as string}</label>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Job Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto flex-wrap justify-start bg-slate-800/50 border border-slate-700">
            <TabsTrigger value="all" className="data-[state=active]:bg-slate-700">
              {t("allJobsCount", { count: filteredJobs.length })}
            </TabsTrigger>
            <TabsTrigger value="excellent" className="data-[state=active]:bg-emerald-900/50">
              <Star className="w-4 h-4 mr-1 text-emerald-400" />
              {t("excellentCount", { count: groupedJobs.excellent.length })}
            </TabsTrigger>
            <TabsTrigger value="good" className="data-[state=active]:bg-amber-900/50">
              <TrendingUp className="w-4 h-4 mr-1 text-amber-400" />
              {t("goodCount", { count: groupedJobs.good.length })}
            </TabsTrigger>
            <TabsTrigger value="fair" className="data-[state=active]:bg-slate-700">
              {t("fairCount", { count: groupedJobs.fair.length })}
            </TabsTrigger>
            <TabsTrigger value="decided" className="data-[state=active]:bg-cyan-900/50">
              <ClipboardCheck className="w-4 h-4 mr-1 text-cyan-400" />
              {t("decidedCount", { count: groupedJobs.decided.length })}
            </TabsTrigger>
          </TabsList>

          <div className="mt-4">
            {jobsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
              </div>
            ) : (
              <>
                <TabsContent value="all" className="mt-0">
                  <div className="grid gap-3">
                    {scoredJobs.map((job: any) => (
                      renderJobCard(job, false)
                    ))}
                    {scoredJobs.length === 0 && (
                      <div className="text-center py-12 text-slate-400">
                        {t("noMatchingJobs")}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="excellent" className="mt-0">
                  <div className="grid gap-3">
                    {groupedJobs.excellent.map((job: any) => (
                      renderJobCard(job)
                    ))}
                    {groupedJobs.excellent.length === 0 && (
                      <div className="text-center py-12 text-slate-400">
                        <Sparkles className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                        <p>{t("noExcellentMatches")}</p>
                        <p className="text-sm mt-2">{t("completeProfileForMatching")}</p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="good" className="mt-0">
                  <div className="grid gap-3">
                    {groupedJobs.good.map((job: any) => (
                      renderJobCard(job)
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="fair" className="mt-0">
                  <div className="grid gap-3">
                    {groupedJobs.fair.map((job: any) => (
                      renderJobCard(job)
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="decided" className="mt-0">
                  <div className="grid gap-3" data-testid="job-decided-tab">
                    {groupedJobs.decided.map((job: any) => (
                      renderJobCard(job)
                    ))}
                    {groupedJobs.decided.length === 0 && (
                      <div className="text-center py-12 text-slate-400">
                        <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                        <p>{t("noLedgerDecisions")}</p>
                      </div>
                    )}
                  </div>
                </TabsContent>
                {hasMoreJobs && (
                  <div className="mt-5 flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fetchMoreJobs()}
                      disabled={jobsFetchingNextPage}
                    >
                      {jobsFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {t("loadMoreJobs")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </Tabs>

        {/* Job Detail Dialog */}
        <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden bg-slate-900 border-slate-700">
            {selectedJob && (
              <>
                <DialogHeader>
                  <DialogTitle className="text-xl text-white">{selectedJob.title}</DialogTitle>
                  <DialogDescription className="flex items-center gap-4 text-slate-400">
                    <span className="flex items-center gap-1">
                      <Building2 className="w-4 h-4" />
                      {selectedJob.company || t("companyFallback")}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {selectedJob.location || t("remoteFallback")}
                    </span>
                  </DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[60vh] pr-4">
                  <div className="space-y-4">
                    {selectedJob.matchScore != null && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={getMatchBadgeColor(selectedJob.matchScore)}>
                          <Target className="w-4 h-4 mr-1" />
                          {t("matchPercent", { score: selectedJob.matchScore })}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleCalculateMatch(selectedJob)}
                          disabled={matchMutation.isPending}
                        >
                          <Sparkles className="w-4 h-4 mr-1" />
                          {t("recalculate")}
                        </Button>
                      </div>
                    )}

                    {selectedJobSummary && (
                      <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-medium text-slate-200">{t("matchDecision")}</h4>
                            <p className="mt-1 text-sm text-slate-400">{selectedJobSummary.nextAction}</p>
                          </div>
                          <Badge variant="outline" className={getMatchBadgeColor(selectedJobSummary.matchScore)}>
                            <Target className="w-3 h-3 mr-1" />
                            {selectedJobSummary.matchScore}% {selectedJobSummary.confidence}
                          </Badge>
                        </div>
                        <div className="grid gap-2 text-xs text-slate-400 md:grid-cols-4">
                          {[
                            [t("decisionLabel"), getDecisionLabel(selectedJobSummary.recommendedDecision)],
                            [t("riskHeading"), getRiskLabel(selectedJobSummary.riskLevel)],
                            [t("salaryLabel"), getFitLabel(selectedJobSummary.salaryFit)],
                            [t("locationLabel"), getFitLabel(selectedJobSummary.locationFit)],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded border border-slate-700/70 bg-slate-900/60 p-2">
                              <div className="text-slate-500">{label}</div>
                              <div className="mt-1 font-medium capitalize text-slate-200">{value}</div>
                            </div>
                          ))}
                        </div>
                        {selectedJobSummary.isDecided && (
                          <div
                            data-testid="job-detail-ledger-decision"
                            className="mt-3 rounded-md border border-cyan-500/30 bg-cyan-500/10 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-xs font-medium uppercase text-cyan-300">
                                   {t("operatingLedgerDecision")}
                                </div>
                                <p className="mt-1 text-sm text-slate-200">
                                  {getDecisionLabel(selectedJobSummary.ledgerDecision)}
                                  {selectedJobSummary.ledgerUpdatedAt
                                    ? ` ${t("recordedLabel")} ${selectedJobSummary.ledgerUpdatedAt.toLocaleDateString(locale)}`
                                    : ""}
                                </p>
                              </div>
                              <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
                                {getDecisionLabel(selectedJobSummary.ledgerDecision)}
                              </Badge>
                            </div>
                            {selectedJobSummary.ledgerDecisionReason && (
                              <p className="mt-2 text-xs text-slate-300">
                                {selectedJobSummary.ledgerDecisionReason}
                              </p>
                            )}
                            {selectedJobSummary.ledgerReviewReason && (
                              <p className="mt-1 text-xs text-slate-400">
                                {t("reviewContext", { context: selectedJobSummary.ledgerReviewReason })}
                              </p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              {selectedJobSummary.ledgerDecision !== "review" && (
                                <Button
                                  size="sm"
                                  data-testid="job-decision-reopen-review"
                                  disabled={decideMutation.isPending}
                                  onClick={() => handleDecisionLifecycleAction(selectedJob, "queue_review")}
                                >
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                  {t("reopenReview")}
                                </Button>
                              )}
                              {selectedJobSummary.ledgerDecision !== "save" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid="job-decision-save"
                                  disabled={decideMutation.isPending}
                                  onClick={() => handleDecisionLifecycleAction(selectedJob, "save")}
                                >
                                  <Heart className="mr-2 h-4 w-4" />
                                  {t("saveForLater")}
                                </Button>
                              )}
                              {selectedJobSummary.ledgerDecision !== "ignore" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid="job-decision-ignore"
                                  className="border-destructive/50 text-destructive"
                                  disabled={decideMutation.isPending}
                                  onClick={() => handleDecisionLifecycleAction(selectedJob, "ignore")}
                                >
                                  <XCircle className="mr-2 h-4 w-4" />
                                  {t("ignoreAction")}
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid="job-open-review-queue"
                                onClick={() => setLocation("/review-queue")}
                              >
                                <ClipboardCheck className="mr-2 h-4 w-4" />
                                {t("reviewQueue")}
                              </Button>
                            </div>
                          </div>
                        )}
                        {selectedJobSummary.reasons.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {selectedJobSummary.reasons.map((reason) => (
                              <div key={reason} className="flex items-start gap-2 text-xs text-emerald-300">
                                <Target className="mt-0.5 h-3 w-3 shrink-0" />
                                <span>{reason}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {selectedJobSummary.blockers.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {selectedJobSummary.blockers.map((blocker) => (
                              <div key={blocker} className="flex items-start gap-2 text-xs text-amber-300">
                                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                                <span>{blocker}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="mb-2 text-xs font-medium text-slate-300">{t("matchedSkills")}</div>
                            <div className="flex flex-wrap gap-1">
                              {selectedJobSummary.matchedSkills.length > 0 ? selectedJobSummary.matchedSkills.map((skill) => (
                                <Badge key={skill} variant="outline" className="border-emerald-500/30 text-emerald-300">
                                  {skill}
                                </Badge>
                              )) : (
                                <span className="text-xs text-slate-500">{t("noDirectSkillEvidence")}</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="mb-2 text-xs font-medium text-slate-300">{t("missingVerify")}</div>
                            <div className="flex flex-wrap gap-1">
                              {selectedJobSummary.missingSkills.length > 0 ? selectedJobSummary.missingSkills.map((skill) => (
                                <Badge key={skill} variant="outline" className="border-amber-500/30 text-amber-300">
                                  {skill}
                                </Badge>
                              )) : (
                                <span className="text-xs text-slate-500">{t("noMissingSkills")}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {["salaryFit", "locationFit"].map((key) => {
                            const label = key === "salaryFit" ? t("salaryFit") : t("locationFit");
                            const fit = key === "salaryFit" ? selectedJobSummary.salaryFit : selectedJobSummary.locationFit;
                            return (
                              <Badge key={key} variant="outline" className={getFitBadgeClass(fit)}>
                                {label}: {getFitLabel(fit)}
                              </Badge>
                            );
                          })}
                          {selectedJobSummary.remoteFit && (
                            <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
                              {t("remoteCompatible")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {selectedJob.jobType && (
                        <Badge variant="secondary" className="bg-slate-800">
                          <Briefcase className="w-3 h-3 mr-1" />
                          {selectedJob.jobType}
                        </Badge>
                      )}
                      {(selectedJob.salaryMin || selectedJob.salaryMax) && (
                        <Badge variant="secondary" className="bg-slate-800">
                          <DollarSign className="w-3 h-3 mr-1" />
                  {formatJobSalary(selectedJob.salaryMin, selectedJob.salaryMax, selectedJob.salaryCurrency, locale)}
                        </Badge>
                      )}
                    </div>

                    {selectedJobSources && selectedJobSources.sources.length > 1 && (
                      <div
                        data-testid="job-detail-source-coverage"
                        className="border-l-2 border-cyan-400 bg-slate-800/40 py-2 pl-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                           <p className="text-sm font-medium text-slate-200">{t("sourceCoverage")}</p>
                          <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
                             {t("linkedSourcesCount", { count: selectedJobSources.sources.length })}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                           {t("sourceCoverageDescription")}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {selectedJobSources.sources.map((source) => (
                            <Badge key={source.id} variant="outline" className="border-slate-600 text-slate-300">
                               {platformNameById.get(source.platformId) || t("platformNumber", { id: source.platformId })}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedJob.skills && (
                      <div>
                         <h4 className="text-sm font-medium text-slate-300 mb-2">{t("requiredSkills")}</h4>
                        <div className="flex flex-wrap gap-1">
                          {selectedJob.skills.split(",").map((skill: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs border-slate-600">
                              {skill.trim()}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <Separator className="bg-slate-700" />

                    <div>
                       <h4 className="text-sm font-medium text-slate-300 mb-2">{t("jobDescription")}</h4>
                      <p className="text-sm text-slate-400 whitespace-pre-wrap">
                         {selectedJob.description || t("noDescription")}
                      </p>
                    </div>
                  </div>
                </ScrollArea>

                <div className="flex flex-col gap-3 border-t border-slate-700 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSaveJob(selectedJob)}
                      disabled={decideMutation.isPending}
                    >
                      <Heart className="w-4 h-4 mr-1" />
                       {t("saveForLater")}
                    </Button>
                    {getSafeExternalUrl(selectedJob.applicationUrl) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openExternalUrl(selectedJob.applicationUrl)}
                      >
                        <ExternalLink className="w-4 h-4 mr-1" />
                         {t("viewOriginal")}
                      </Button>
                    )}
                  </div>
                  <Button
                    data-testid="job-prepare-or-resolve-evidence"
                     title={preparationEvidenceGate?.detail || t("queueControlledReview")}
                    onClick={() => handleApply(selectedJob)}
                    disabled={decideMutation.isPending}
                    className={preparationEvidenceGate
                      ? "border border-amber-500/50 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                      : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"}
                  >
                    {decideMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : preparationEvidenceGate ? (
                      <AlertCircle className="w-4 h-4 mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    {preparationEvidenceGate
                       ? t("resolveEvidence")
                      : selectedJobSummary?.recommendedDecision === "manual_apply"
                       ? t("queueManualTask")
                      : selectedJobSummary?.recommendedDecision === "ignore"
                         ? t("queueExceptionReview")
                         : t("queueReview")}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
