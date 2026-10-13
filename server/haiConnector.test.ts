import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as database from "./db";
import {
  buildHaiRemoteJobResults,
  HAI_CONNECTOR_AGENT_VERSION,
  HaiConnectorService,
  parseHaiRemoteJobSearchQuery,
  type HaiRemoteJob,
  type HaiJobSearchSnapshot,
} from "./haiConnector";
import { parseHaiConnectorUserId, validateHaiConnectorConfig } from "./haiConnectorConfig";
import { registerHaiConnectorRoutes } from "./haiConnectorRoutes";

const token = "hire-ai-hai-test-token-32-characters-long";
const snapshot: HaiJobSearchSnapshot = {
  generatedAt: "2026-08-09T00:00:00.000Z",
  campaignStatus: "active",
  readinessScore: 82,
  automationMode: "review_first",
  applications: { total: 7, prepared: 2, submitted: 5, interviews: 1, offers: 0 },
  pendingApprovals: 2,
  connectedProviders: 1,
  connectorsNeedingAttention: 1,
  activeSuccessFees: 0,
  autonomousRun: { status: "completed", lastCompletedAt: "2026-08-08T23:00:00.000Z" },
  runtimeSignals: { totalFailures: 0, uniqueSignals: 0, latestAt: null },
  nextActions: ["Review 2 pending approvals."],
  scope: "Read-only aggregate Hire.AI status.",
};

const servers: Server[] = [];
let ownerId: number;
beforeEach(async () => {
  await database.upsertUser({ openId: "hai-authorization-fixture", accountStatus: "active" });
  ownerId = (await database.getUserByOpenId("hai-authorization-fixture"))!.id;
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  vi.restoreAllMocks();
});

async function start(service: HaiConnectorService) {
  const app = express();
  registerHaiConnectorRoutes(app, service);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
  return `http://127.0.0.1:${address.port}`;
}

function configuredService(
  provider = vi.fn(async () => snapshot),
  jobSearchProvider = vi.fn(async () => [] as HaiRemoteJob[])
) {
  return {
    provider,
    jobSearchProvider,
    service: new HaiConnectorService({
      enabled: true,
      token,
      userId: ownerId,
      endpointUrl: "http://127.0.0.1:3000/api/hai/a2a",
    }, provider, jobSearchProvider),
  };
}

function sendMessage(extraMessage: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: "request-1",
    method: "SendMessage",
    params: {
      message: {
        messageId: "message-1",
        role: "ROLE_USER",
        parts: [{ text: "Summarize current Hire.AI status.", mediaType: "text/plain" }],
        ...extraMessage,
      },
    },
  };
}

describe("HAI connector configuration", () => {
  it("stays disabled by default and rejects weak or public connector configuration", () => {
    expect(validateHaiConnectorConfig({ enabled: false, token: "", userId: null, endpointUrl: "" })).toBeNull();
    expect(validateHaiConnectorConfig({ enabled: true, token: "short", userId: 1, endpointUrl: "http://127.0.0.1/a" })).toContain("32");
    expect(validateHaiConnectorConfig({ enabled: true, token, userId: 1, endpointUrl: "https://example.com/api/hai/a2a" })).toContain("local");
    expect(validateHaiConnectorConfig({ enabled: true, token, userId: 1, endpointUrl: "http://app:3000/api/hai/a2a" })).toBeNull();
    expect(validateHaiConnectorConfig({ enabled: true, token, userId: 1, endpointUrl: "http://untrusted-service:3000/api/hai/a2a" })).toContain("local");
  });

  it("rejects unusable tokens, ambiguous user IDs, and endpoints the server does not expose", () => {
    expect(parseHaiConnectorUserId("41")).toBe(41);
    expect(parseHaiConnectorUserId("41junk")).toBeNull();
    expect(parseHaiConnectorUserId("01")).toBeNull();
    expect(parseHaiConnectorUserId("9007199254740992")).toBeNull();

    const config = { enabled: true, token, userId: 41, endpointUrl: "http://127.0.0.1:3000/api/hai/a2a" };
    expect(validateHaiConnectorConfig({ ...config, token: "replace-with-at-least-32-random-characters" })).toContain("placeholder");
    expect(validateHaiConnectorConfig({ ...config, token: `${token} with-space` })).toContain("whitespace");
    expect(validateHaiConnectorConfig({ ...config, token: "x".repeat(4_097) })).toContain("4096");
    expect(validateHaiConnectorConfig({ ...config, endpointUrl: "http://127.0.0.1:3000/api/hai/status" })).toContain("/api/hai/a2a");
    expect(validateHaiConnectorConfig({ ...config, endpointUrl: " http://127.0.0.1:3000/api/hai/a2a" })).toContain("surrounding whitespace");
  });

  it("accepts the configured bearer and exposes no token in status", async () => {
    const { service } = configuredService();
    expect(await service.authorize(token)).toBe(true);
    expect(await service.authorize(`${token}-wrong`)).toBe(false);
    expect(JSON.stringify(service.status())).not.toContain(token);
  });
});

describe("HAI remote job search", () => {
  it.each([
    ["Find remote jobs for a product designer", "a product designer"],
    ["search for remote jobs matching: senior accountant", "senior accountant"],
    ["SEARCH ME REMOTE JOBS about support", "support"],
    ["Find remote jobs", ""],
  ])("parses explicit read-only search requests", (message, expected) => {
    expect(parseHaiRemoteJobSearchQuery(message)).toBe(expected);
  });

  it.each([
    "Summarize current Hire.AI status.",
    "Find hybrid jobs for a product designer",
    "Submit an application for a remote role",
  ])("does not interpret unrelated or action requests as searches", (message) => {
    expect(parseHaiRemoteJobSearchQuery(message)).toBeNull();
  });

  it("queries the canonical active listing path with remote-only and clear-safety filters", async () => {
    const query = "senior designer";
    const databasePage = {
      items: [{
        id: 42,
        title: "Senior Designer",
        company: "Example Co",
        location: "Remote - Europe",
        jobType: "full-time",
        salaryMin: 90_000,
        salaryMax: 120_000,
        salaryCurrency: "EUR",
        applicationUrl: "https://jobs.example/apply",
        sourceUrl: "https://jobs.example/listing",
        postedDate: new Date("2026-10-01T00:00:00.000Z"),
        description: "PRIVATE DESCRIPTION MUST NOT BE RETURNED",
      }],
      nextCursor: null,
    } as any;
    const getPage = vi.spyOn(database, "getActiveJobPage").mockResolvedValue(databasePage);

    const results = await buildHaiRemoteJobResults(query);

    expect(getPage).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      filters: expect.objectContaining({ query, remoteOnly: true, listingSafety: "clear" }),
    }));
    expect(results).toEqual([{
      id: 42,
      title: "Senior Designer",
      company: "Example Co",
      location: "Remote - Europe",
      jobType: "full-time",
      salaryMin: 90_000,
      salaryMax: 120_000,
      salaryCurrency: "EUR",
      applicationUrl: "https://jobs.example/apply",
      sourceUrl: "https://jobs.example/listing",
      postedAt: "2026-10-01T00:00:00.000Z",
    }]);
    expect(JSON.stringify(results)).not.toContain("PRIVATE DESCRIPTION");
  });

  it("excludes unsafe or credential-bearing links from public results", async () => {
    const databasePage = {
      items: [{
        id: 43,
        title: "Designer",
        company: "Example Co",
        location: null,
        jobType: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        applicationUrl: "javascript:alert(1)",
        sourceUrl: "https://user:password@example.test/job",
        postedDate: null,
      }],
      nextCursor: null,
    } as any;
    vi.spyOn(database, "getActiveJobPage").mockResolvedValue(databasePage);

    const [job] = await buildHaiRemoteJobResults("designer");

    expect(job.applicationUrl).toBeNull();
    expect(job.sourceUrl).toBeNull();
    expect(job.postedAt).toBeNull();
  });
});

describe("HAI A2A route", () => {
  it("rate-limits HAI authorization attempts before evaluating the bearer", async () => {
    const { service, provider } = configuredService();
    const authorize = vi.spyOn(service, "authorize").mockResolvedValue(false);
    const base = await start(service);

    for (let attempt = 0; attempt < 120; attempt += 1) {
      expect((await fetch(`${base}/api/hai/status`)).status).toBe(404);
    }
    const blocked = await fetch(`${base}/api/hai/status`);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(authorize).toHaveBeenCalledTimes(120);
    expect(provider).not.toHaveBeenCalled();
  });

  it("hides disabled and unauthorized connector endpoints", async () => {
    const disabledBase = await start(new HaiConnectorService({ enabled: false, token: "", userId: null, endpointUrl: "" }));
    expect((await fetch(`${disabledBase}/.well-known/agent-card.json`)).status).toBe(404);

    const { service, provider } = configuredService();
    const base = await start(service);
    expect((await fetch(`${base}/api/hai/status`)).status).toBe(404);
    expect((await fetch(`${base}/api/hai/a2a`, {
      method: "POST",
      headers: { "content-type": "text/plain", "A2A-Version": "1.0" },
      body: "x".repeat(20_000),
    })).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });

  it("publishes a bounded Agent Card and returns a read-only aggregate snapshot", async () => {
    const { service, provider } = configuredService();
    const base = await start(service);
    const cardResponse = await fetch(`${base}/.well-known/agent-card.json`);
    const card = await cardResponse.json() as any;
    expect(cardResponse.status).toBe(200);
    expect(card.skills[0].id).toBe("hire_ai_read_only_status");
    expect(card.skills[1].id).toBe("hire_ai_remote_job_search");
    expect(card.capabilities).toEqual({ streaming: false, pushNotifications: false, extendedAgentCard: false });
    expect(card.securitySchemes.haiLocalBearer.httpAuthSecurityScheme.scheme).toBe("Bearer");
    expect(card.securityRequirements).toEqual([{ schemes: { haiLocalBearer: [] } }]);
    expect(cardResponse.headers.get("etag")).toContain(HAI_CONNECTOR_AGENT_VERSION);

    const response = await fetch(`${base}/api/hai/a2a`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "A2A-Version": "1.0",
      },
      body: JSON.stringify(sendMessage()),
    });
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(body.result.task.artifacts[0].parts[0].data).toEqual(snapshot);
    expect(JSON.stringify(body)).not.toContain("Signature verification");
    expect(provider).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledWith(ownerId);
  });

  it("returns bounded, deduplicated remote job results without exposing candidate or listing text", async () => {
    const job: HaiRemoteJob = {
      id: 91,
      title: "Remote Engineer",
      company: "Example Co",
      location: "Remote - EU",
      jobType: "full-time",
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      applicationUrl: "https://jobs.example/apply",
      sourceUrl: "https://jobs.example/listing",
      postedAt: null,
    };
    const { service, provider, jobSearchProvider } = configuredService(undefined, vi.fn(async () => [job]));
    const base = await start(service);
    const response = await fetch(`${base}/api/hai/a2a`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "A2A-Version": "1.0",
      },
      body: JSON.stringify(sendMessage({
        parts: [{ text: "Find remote jobs matching backend engineer" }],
      })),
    });
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.result.task.artifacts[0].name).toBe("hire-ai-remote-job-results");
    expect(body.result.task.artifacts[0].parts[0].data).toEqual({
      query: "backend engineer",
      remoteOnly: true,
      results: [job],
    });
    expect(jobSearchProvider).toHaveBeenCalledWith("backend engineer");
    expect(provider).not.toHaveBeenCalled();
    expect(body.result.task.artifacts[0].parts[0].data.results[0]).not.toHaveProperty("description");
    expect(body.result.task.artifacts[0].parts[0].data.results[0]).not.toHaveProperty("email");
  });

  it("rejects remote queries over 200 characters before accessing either provider", async () => {
    const { service, provider, jobSearchProvider } = configuredService();
    const base = await start(service);
    const response = await fetch(`${base}/api/hai/a2a`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "A2A-Version": "1.0",
      },
      body: JSON.stringify(sendMessage({
        parts: [{ text: `Find remote jobs for ${"x".repeat(201)}` }],
      })),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as any).error.message).toContain("200 characters");
    expect(jobSearchProvider).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("caps results returned by an injected provider", async () => {
    const jobs = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      title: "Remote role",
      company: "Example Co",
      location: null,
      jobType: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      applicationUrl: null,
      sourceUrl: null,
      postedAt: null,
    } satisfies HaiRemoteJob));
    const service = new HaiConnectorService({
      enabled: true,
      token,
      userId: ownerId,
      endpointUrl: "http://127.0.0.1:3000/api/hai/a2a",
    }, vi.fn(async () => snapshot), vi.fn(async () => jobs));

    expect(await service.searchRemoteJobs("engineer")).toHaveLength(10);
  });

  it("rejects mutation-shaped metadata and oversized input before building a job-search snapshot", async () => {
    const { service, provider } = configuredService();
    const base = await start(service);
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "A2A-Version": "1.0",
    };
    const metadataResponse = await fetch(`${base}/api/hai/a2a`, {
      method: "POST",
      headers,
      body: JSON.stringify(sendMessage({ metadata: { action: "submit_application" } })),
    });
    expect(metadataResponse.status).toBe(400);
    expect((await metadataResponse.json() as any).error.code).toBe(-32602);

    const unsupportedMethod = sendMessage();
    unsupportedMethod.method = "ExecuteApplication";
    const methodResponse = await fetch(`${base}/api/hai/a2a`, {
      method: "POST",
      headers,
      body: JSON.stringify(unsupportedMethod),
    });
    expect(methodResponse.status).toBe(400);
    expect((await methodResponse.json() as any).error.code).toBe(-32601);

    const oversizedResponse = await fetch(`${base}/api/hai/a2a`, {
      method: "POST",
      headers,
      body: JSON.stringify(sendMessage({ parts: [{ text: "x".repeat(5000) }] })),
    });
    expect(oversizedResponse.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  const endpoints = ["status", "a2a"] as const;
  function request(base: string, endpoint: typeof endpoints[number], bearer = token) {
    return fetch(`${base}/api/hai/${endpoint}`, endpoint === "status" ? {
      headers: { authorization: `Bearer ${bearer}` },
    } : {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", "A2A-Version": "1.0" },
      body: JSON.stringify(sendMessage()),
    });
  }

  describe.each(endpoints)("%s account authorization", endpoint => {
    it.each(["pending", "suspended"] as const)("blocks %s accounts even with the correct bearer", async accountStatus => {
      await database.upsertUser({ openId: "hai-authorization-fixture", accountStatus });
      const { service, provider } = configuredService();
      const response = await request(await start(service), endpoint);
      expect(response.status).toBe(404);
      expect(provider).not.toHaveBeenCalled();
    });

    it("blocks a missing or erased account", async () => {
      const { provider } = configuredService();
      const service = new HaiConnectorService({
        enabled: true, token, userId: 2_147_483_647, endpointUrl: "http://127.0.0.1:3000/api/hai/a2a",
      }, provider);
      const response = await request(await start(service), endpoint);
      expect(response.status).toBe(404);
      expect(provider).not.toHaveBeenCalled();
    });

    it("does not retain authorization after the account is suspended", async () => {
      const { service, provider } = configuredService();
      const base = await start(service);
      const first = await request(base, endpoint);
      expect(first.status).toBe(200);
      await first.text();
      provider.mockClear();
      await database.upsertUser({ openId: "hai-authorization-fixture", accountStatus: "suspended" });
      const second = await request(base, endpoint);
      expect(second.status).toBe(404);
      expect(provider).not.toHaveBeenCalled();
    });

    it("returns a bounded temporary failure without data when account lookup fails", async () => {
      const { service, provider } = configuredService();
      vi.spyOn(database, "getUserById").mockRejectedValueOnce(new Error("private-database-detail-do-not-return"));
      const response = await request(await start(service), endpoint);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).not.toContain("private-database-detail");
      expect(body.length).toBeLessThan(200);
      expect(provider).not.toHaveBeenCalled();
    });

    it("rejects a wrong bearer without querying the account database", async () => {
      const { service, provider } = configuredService();
      const lookup = vi.spyOn(database, "getUserById");
      const response = await request(await start(service), endpoint, "incorrect-token");
      expect(response.status).toBe(404);
      expect(lookup).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    });
  });

  describe.each(["1.0", "unsupported"])("JSON-RPC errors with protocol %s", protocol => {
    it.each([
      { label: "object", id: { privateInput: "must-not-be-echoed" } },
      { label: "array", id: ["must-not-be-echoed"] },
      { label: "oversized string", id: "x".repeat(4096) },
      { label: "boolean", id: true },
      { label: "null", id: null },
    ])("does not reflect an invalid $label request identifier", async ({ id }) => {
      const { service, provider } = configuredService();
      const base = await start(service);
      const response = await fetch(`${base}/api/hai/a2a`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "A2A-Version": protocol },
        body: JSON.stringify({ ...sendMessage(), id }),
      });
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body).toMatchObject({ jsonrpc: "2.0", id: null, error: {
        code: protocol === "1.0" ? -32602 : -32009,
      } });
      expect(JSON.stringify(body)).not.toContain("must-not-be-echoed");
      expect(JSON.stringify(body).length).toBeLessThan(500);
      expect(provider).not.toHaveBeenCalled();
    });

    it.each([0, "request-1"])("retains a valid request identifier %j on errors", async id => {
      const { service, provider } = configuredService();
      const response = await fetch(`${await start(service)}/api/hai/a2a`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "A2A-Version": protocol },
        body: JSON.stringify({ ...sendMessage({ parts: [] }), id }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id });
      expect(provider).not.toHaveBeenCalled();
    });
  });
});
