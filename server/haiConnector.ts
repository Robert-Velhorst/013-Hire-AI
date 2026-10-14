import { createHash, timingSafeEqual } from "node:crypto";
import {
  getActiveJobPage,
  getApplicationCampaign,
  getAutonomousRunState,
  getOperationalFailureAggregateSnapshot,
  getUserHaiStatusCounts,
  getUserById,
} from "./db";
import {
  defaultHaiConnectorConfig,
  type HaiConnectorConfig,
  validateHaiConnectorConfig,
} from "./haiConnectorConfig";
import { defaultJobSearchFilters } from "@shared/jobSearchFilters";

export type { HaiConnectorConfig } from "./haiConnectorConfig";

export const HAI_CONNECTOR_PROTOCOL_VERSION = "1.0";
export const HAI_CONNECTOR_AGENT_VERSION = "1.2.1";
const HAI_REMOTE_JOB_RESULT_LIMIT = 10;

export type HaiJobSearchSnapshot = {
  generatedAt: string;
  campaignStatus: "active" | "paused" | "completed" | "archived" | "not_configured";
  readinessScore: number | null;
  automationMode: "review_first" | "auto_apply" | "not_configured";
  applications: {
    total: number;
    prepared: number;
    submitted: number;
    interviews: number;
    offers: number;
  };
  pendingApprovals: number;
  connectedProviders: number;
  connectorsNeedingAttention: number;
  activeSuccessFees: number;
  autonomousRun: {
    status: "running" | "completed" | "failed" | "skipped" | "never_run";
    lastCompletedAt: string | null;
  };
  runtimeSignals: {
    totalFailures: number;
    uniqueSignals: number;
    latestAt: string | null;
  };
  nextActions: string[];
  scope: string;
};

type SnapshotProvider = (userId: number) => Promise<HaiJobSearchSnapshot>;

export type HaiRemoteJob = {
  id: number;
  title: string;
  company: string;
  location: string | null;
  jobType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  applicationUrl: string | null;
  sourceUrl: string | null;
  postedAt: string | null;
};

type RemoteJobSearchProvider = (query: string) => Promise<HaiRemoteJob[]>;

function safeJobUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function buildHaiRemoteJobResults(query: string): Promise<HaiRemoteJob[]> {
  const page = await getActiveJobPage({
    limit: HAI_REMOTE_JOB_RESULT_LIMIT,
    filters: {
      ...defaultJobSearchFilters,
      query,
      remoteOnly: true,
      listingSafety: "clear",
    },
  });

  return page.items.map(job => ({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    jobType: job.jobType,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    applicationUrl: safeJobUrl(job.applicationUrl),
    sourceUrl: safeJobUrl(job.sourceUrl),
    postedAt: job.postedDate?.toISOString() ?? null,
  }));
}

export function parseHaiRemoteJobSearchQuery(message: string) {
  const match = message.trim().match(
    /^(?:find|search)(?:\s+me)?(?:\s+for)?\s+remote\s+jobs(?:\s+(?:for|about|matching))?(?:\s*:\s*|\s+)?([\s\S]*)$/i
  );
  if (!match) return null;
  return (match[1] ?? "").trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

function constantTimeTokenMatch(expected: string, actual: string) {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const actualDigest = createHash("sha256").update(actual).digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

export async function buildHaiJobSearchSnapshot(userId: number): Promise<HaiJobSearchSnapshot> {
  const [campaign, counts, autonomousRun, runtimeSignals] = await Promise.all([
    getApplicationCampaign(userId),
    getUserHaiStatusCounts(userId),
    getAutonomousRunState(userId),
    getOperationalFailureAggregateSnapshot(),
  ]);
  const nextActions = [
    counts.pendingApprovals > 0 ? `Review ${counts.pendingApprovals} pending approval${counts.pendingApprovals === 1 ? "" : "s"}.` : "",
    counts.connectorsNeedingAttention > 0 ? `Resolve ${counts.connectorsNeedingAttention} connector setup item${counts.connectorsNeedingAttention === 1 ? "" : "s"}.` : "",
    campaign?.status === "paused" ? "Resume the paused campaign before scheduled preparation can continue." : "",
    counts.applications.interviews > 0 ? `Review ${counts.applications.interviews} active interview application${counts.applications.interviews === 1 ? "" : "s"}.` : "",
    runtimeSignals.totalFailures > 0 ? "Review aggregate runtime failure signals in Hire.AI administration." : "",
  ].filter(Boolean).slice(0, 4);

  return {
    generatedAt: new Date().toISOString(),
    campaignStatus: campaign?.status ?? "not_configured",
    readinessScore: campaign?.readinessScore ?? null,
    automationMode: campaign?.automationMode ?? "not_configured",
    applications: counts.applications,
    pendingApprovals: counts.pendingApprovals,
    connectedProviders: counts.connectedProviders,
    connectorsNeedingAttention: counts.connectorsNeedingAttention,
    activeSuccessFees: counts.activeSuccessFees,
    autonomousRun: {
      status: autonomousRun?.lastStatus ?? "never_run",
      lastCompletedAt: autonomousRun?.lastCompletedAt?.toISOString() ?? null,
    },
    runtimeSignals: {
      totalFailures: runtimeSignals.totalFailures,
      uniqueSignals: runtimeSignals.uniqueSignals,
      latestAt: runtimeSignals.latestAt,
    },
    nextActions,
    scope: "Read-only aggregate Hire.AI status. No personal profile, job, document, message, credential, payment amount, raw audit data, or individual runtime failure label is included.",
  };
}

export class HaiConnectorService {
  readonly configError: string | null;

  constructor(
    readonly config: HaiConnectorConfig = defaultHaiConnectorConfig(),
    private readonly snapshotProvider: SnapshotProvider = buildHaiJobSearchSnapshot,
    private readonly remoteJobSearchProvider: RemoteJobSearchProvider = buildHaiRemoteJobResults
  ) {
    this.configError = validateHaiConnectorConfig(config);
  }

  get configured() {
    return this.config.enabled && !this.configError && Boolean(this.config.userId);
  }

  async authorize(token: string) {
    const userId = this.config.userId;
    if (!this.configured || !userId || !constantTimeTokenMatch(this.config.token, token)) return false;
    // A configured bearer does not override account suspension or erasure.
    const user = await getUserById(userId);
    return user?.id === userId && user.accountStatus === "active";
  }

  status() {
    return {
      enabled: this.config.enabled,
      configured: this.configured,
      provider: "HAI A2A read-only job discovery and status connector",
      endpoint: this.configured ? this.config.endpointUrl : undefined,
      configError: this.config.enabled ? this.configError ?? undefined : undefined,
      capabilities: ["authenticated aggregate status", "deduplicated remote job search", "A2A 1.0-shaped Agent Card and SendMessage response"],
      restrictions: ["one configured user", "read-only", "no personal data", "no provider calls", "no application, approval, message, billing, or workflow mutation"],
    };
  }

  agentCard() {
    if (!this.configured) return null;
    return {
      name: "Hire.AI remote job discovery",
      description: "Local, token-authenticated access to deduplicated remote job listings and aggregate Hire.AI status. This connector cannot execute or approve work.",
      supportedInterfaces: [{ url: this.config.endpointUrl, protocolBinding: "JSONRPC", protocolVersion: HAI_CONNECTOR_PROTOCOL_VERSION }],
      version: HAI_CONNECTOR_AGENT_VERSION,
      capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["application/json"],
      skills: [
        {
          id: "hire_ai_read_only_status",
          name: "Hire.AI read-only status",
          description: "Returns bounded aggregate application, review, connector, campaign, autonomous-run, and runtime health status without personal data or failure labels.",
          tags: ["status", "read-only", "local-first"],
          examples: ["Summarize the current Hire.AI operating status."],
        },
        {
          id: "hire_ai_remote_job_search",
          name: "Hire.AI remote job search",
          description: "Searches current, deduplicated, remote-only listings with clear listing-safety status. Returns at most 10 public job fields and screened HTTPS links; no candidate data is shared.",
          tags: ["remote-jobs", "job-search", "read-only"],
          examples: ["Find remote jobs for a product designer."],
        },
      ],
      securitySchemes: {
        haiLocalBearer: { httpAuthSecurityScheme: { scheme: "Bearer", description: "Configured local HAI connector token." } },
      },
      securityRequirements: [{ schemes: { haiLocalBearer: [] } }],
    };
  }

  async snapshot() {
    if (!this.configured || !this.config.userId) throw new Error("HAI connector is unavailable.");
    return await this.snapshotProvider(this.config.userId);
  }

  async searchRemoteJobs(query: string) {
    if (!this.configured) throw new Error("HAI connector is unavailable.");
    const normalizedQuery = query.trim();
    if (Array.from(normalizedQuery).length > 200) {
      throw new Error("Remote job search queries must be at most 200 characters.");
    }
    const jobs = await this.remoteJobSearchProvider(normalizedQuery);
    return jobs.slice(0, HAI_REMOTE_JOB_RESULT_LIMIT);
  }
}
