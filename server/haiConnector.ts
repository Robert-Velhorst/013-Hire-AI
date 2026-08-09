import { createHash, timingSafeEqual } from "node:crypto";
import {
  getApplicationCampaign,
  getAutonomousRunState,
  getUserHaiStatusCounts,
} from "./db";
import {
  defaultHaiConnectorConfig,
  type HaiConnectorConfig,
  validateHaiConnectorConfig,
} from "./haiConnectorConfig";
import { getOperationalFailureSnapshot } from "./operationalFailureLog";

export type { HaiConnectorConfig } from "./haiConnectorConfig";

export const HAI_CONNECTOR_PROTOCOL_VERSION = "1.0";
export const HAI_CONNECTOR_AGENT_VERSION = "1.1.0";

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

function constantTimeTokenMatch(expected: string, actual: string) {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const actualDigest = createHash("sha256").update(actual).digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

export async function buildHaiJobSearchSnapshot(userId: number): Promise<HaiJobSearchSnapshot> {
  const [campaign, counts, autonomousRun] = await Promise.all([
    getApplicationCampaign(userId),
    getUserHaiStatusCounts(userId),
    getAutonomousRunState(userId),
  ]);
  const runtimeSignals = getOperationalFailureSnapshot(1);
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
      latestAt: runtimeSignals.signals[0]?.lastOccurredAt ?? null,
    },
    nextActions,
    scope: "Read-only aggregate Hire.AI status. No personal profile, job, document, message, credential, payment amount, raw audit data, or individual runtime failure label is included.",
  };
}

export class HaiConnectorService {
  readonly configError: string | null;

  constructor(
    readonly config: HaiConnectorConfig = defaultHaiConnectorConfig(),
    private readonly snapshotProvider: SnapshotProvider = buildHaiJobSearchSnapshot
  ) {
    this.configError = validateHaiConnectorConfig(config);
  }

  get configured() {
    return this.config.enabled && !this.configError && Boolean(this.config.userId);
  }

  authorize(token: string) {
    return this.configured && constantTimeTokenMatch(this.config.token, token);
  }

  status() {
    return {
      enabled: this.config.enabled,
      configured: this.configured,
      provider: "HAI A2A read-only status connector",
      endpoint: this.configured ? this.config.endpointUrl : undefined,
      configError: this.config.enabled ? this.configError ?? undefined : undefined,
      capabilities: ["authenticated aggregate job-search and runtime health status", "A2A 1.0-shaped Agent Card and SendMessage response"],
      restrictions: ["one configured user", "read-only", "no personal data", "no provider calls", "no application, approval, message, billing, or workflow mutation"],
    };
  }

  agentCard() {
    if (!this.configured) return null;
    return {
      name: "Hire.AI controlled status",
      description: "Local, token-authenticated aggregate job-search and runtime health status for HAI. This connector cannot execute or approve work.",
      supportedInterfaces: [{ url: this.config.endpointUrl, protocolBinding: "JSONRPC", protocolVersion: HAI_CONNECTOR_PROTOCOL_VERSION }],
      version: HAI_CONNECTOR_AGENT_VERSION,
      capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["application/json"],
      skills: [{
        id: "hire_ai_read_only_status",
        name: "Hire.AI read-only status",
        description: "Returns bounded aggregate application, review, connector, campaign, autonomous-run, and runtime health status without personal data or failure labels.",
        tags: ["job-search", "status", "read-only", "local-first"],
        examples: ["Summarize the current Hire.AI operating status."],
      }],
      securitySchemes: {
        haiLocalBearer: { httpAuthSecurityScheme: { scheme: "Bearer", description: "Configured local HAI connector token." } },
      },
      securityRequirements: [{ haiLocalBearer: [] }],
    };
  }

  async snapshot() {
    if (!this.configured || !this.config.userId) throw new Error("HAI connector is unavailable.");
    return await this.snapshotProvider(this.config.userId);
  }
}
