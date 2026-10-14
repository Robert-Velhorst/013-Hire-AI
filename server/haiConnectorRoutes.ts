import { randomUUID } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  HAI_CONNECTOR_AGENT_VERSION,
  HAI_CONNECTOR_PROTOCOL_VERSION,
  HaiConnectorService,
  type HaiRemoteJobSearchFilters,
} from "./haiConnector";
import { isKnownSalaryCurrency } from "@shared/salaryCurrency";
import { createRateLimitMiddleware } from "./_core/apiRateLimit";

const maxBodyBytes = 16 * 1024;
export const HAI_CONNECTOR_RATE_LIMIT_POLICY = Object.freeze({
  windowMs: 60_000,
  maxRequests: 120,
  maxClients: 2_000,
});
export const HAI_JOB_SEARCH_RATE_LIMIT_POLICY = Object.freeze({
  windowMs: 60_000,
  maxRequests: 30,
  maxClients: 2_000,
});
const requestIdSchema = z.union([z.string().min(1).max(255), z.number().finite()]);
const textPartSchema = z.object({
  text: z.string().trim().min(1),
  mediaType: z.literal("text/plain").optional(),
}).strict();
const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: requestIdSchema,
  method: z.string().min(1).max(80),
  params: z.object({
    message: z.object({
      messageId: z.string().trim().min(1).max(255),
      role: z.literal("ROLE_USER"),
      parts: z.array(textPartSchema).min(1).max(4),
    }).strict(),
  }).strict(),
}).strict();
const jobSearchFiltersSchema = z.object({
  query: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  jobType: z.enum(["all", "full-time", "part-time", "contract", "temporary"]).optional(),
  platformId: z.number().int().positive().optional(),
  salaryRange: z.tuple([z.number().min(0).max(10_000_000), z.number().min(0).max(10_000_000)]).optional(),
  salaryCurrency: z.union([
    z.literal("all"),
    z.string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase())
      .refine(isKnownSalaryCurrency, "Use a supported ISO 4217 currency code."),
  ]).optional(),
  experienceLevel: z.enum(["all", "entry", "junior", "mid", "senior", "lead", "executive"]).optional(),
  applicationProcess: z.enum(["all", "greenhouse", "lever", "workday", "email", "other"]).optional(),
  visaSponsorshipOnly: z.boolean().optional(),
  openHiringSupportOnly: z.boolean().optional(),
  diversityFriendlyOnly: z.boolean().optional(),
  salaryDisclosedOnly: z.boolean().optional(),
  postedWithin: z.enum(["all", "1", "3", "7", "30"]).optional(),
}).strict().superRefine((filters, context) => {
  if (filters.salaryRange && (!filters.salaryCurrency || filters.salaryCurrency === "all")) {
    context.addIssue({ code: "custom", path: ["salaryCurrency"], message: "Salary bounds require an explicit currency." });
  }
  if (filters.salaryRange && filters.salaryRange[0] > filters.salaryRange[1]) {
    context.addIssue({ code: "custom", path: ["salaryRange"], message: "Minimum salary must not exceed maximum salary." });
  }
});
const jobSearchRequestSchema = z.object({
  filters: jobSearchFiltersSchema.default({}),
  limit: z.number().int().min(1).max(25).default(10),
  cursor: z.object({
    postedDate: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    id: z.number().int().positive(),
  }).strict().optional(),
}).strict();

function bearerToken(header: string | undefined) {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? "";
}

function rpcError(res: Response, id: unknown, code: number, message: string) {
  const parsedId = requestIdSchema.safeParse(id);
  res.status(400).json({ jsonrpc: "2.0", id: parsedId.success ? parsedId.data : null, error: { code, message } });
}

function boundedJsonParser(req: Request, res: Response, next: NextFunction) {
  if (!req.is("application/json")) {
    rpcError(res, null, -32600, "JSON-RPC requests must use application/json.");
    return;
  }
  express.json({ limit: maxBodyBytes, strict: true })(req, res, (error?: unknown) => {
    if (error) {
      rpcError(res, null, -32600, "Invalid or oversized JSON-RPC request.");
      return;
    }
    next();
  });
}

function boundedJsonBodyParser(req: Request, res: Response, next: NextFunction) {
  if (!req.is("application/json")) {
    res.status(415).json({ error: "Requests must use application/json." });
    return;
  }
  express.json({ limit: maxBodyBytes, strict: true })(req, res, (error?: unknown) => {
    if (error) {
      res.status(400).json({ error: "Invalid or oversized JSON request." });
      return;
    }
    next();
  });
}

export function registerHaiConnectorRoutes(
  app: Express,
  service = new HaiConnectorService()
) {
  app.use("/api/hai", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  }, createRateLimitMiddleware(HAI_CONNECTOR_RATE_LIMIT_POLICY));
  const jobSearchRateLimit = rateLimit({
    windowMs: HAI_JOB_SEARCH_RATE_LIMIT_POLICY.windowMs,
    limit: HAI_JOB_SEARCH_RATE_LIMIT_POLICY.maxRequests,
    standardHeaders: "draft-6",
    legacyHeaders: false,
  });
  const jobSearchClientCapacityLimit = createRateLimitMiddleware(HAI_JOB_SEARCH_RATE_LIMIT_POLICY);

  app.get("/.well-known/agent-card.json", (_req, res) => {
    const card = service.agentCard();
    if (!card) {
      res.sendStatus(404);
      return;
    }
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("ETag", `"hire-ai-hai-${HAI_CONNECTOR_AGENT_VERSION}"`);
    res.json(card);
  });

  const requireHaiAuth = async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!(await service.authorize(bearerToken(req.header("authorization"))))) {
        res.sendStatus(404);
        return;
      }
    } catch {
      res.status(503).send("Hire.AI connector authorization is temporarily unavailable.");
      return;
    }
    next();
  };

  app.get("/api/hai/status", requireHaiAuth, (_req, res) => {
    res.json(service.status());
  });

  app.post("/api/hai/jobs/search", jobSearchRateLimit, jobSearchClientCapacityLimit, requireHaiAuth, boundedJsonBodyParser, async (req, res) => {
    const parsed = jobSearchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Remote job search filters are invalid or exceed supported limits." });
      return;
    }
    const filters = parsed.data.filters as HaiRemoteJobSearchFilters;
    try {
      const result = await service.searchRemoteJobs({
        filters,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor
          ? {
              postedDate: parsed.data.cursor.postedDate
                ? new Date(parsed.data.cursor.postedDate)
                : null,
              createdAt: new Date(parsed.data.cursor.createdAt),
              id: parsed.data.cursor.id,
            }
          : undefined,
      });
      res.json(result);
    } catch {
      res.status(503).json({ error: "Remote job search is temporarily unavailable." });
    }
  });

  app.post("/api/hai/a2a", requireHaiAuth, boundedJsonParser, async (req, res) => {
    if (req.header("A2A-Version")?.trim() !== HAI_CONNECTOR_PROTOCOL_VERSION) {
      rpcError(res, req.body?.id ?? null, -32009, "A2A-Version 1.0 is required by this connector.");
      return;
    }
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      rpcError(res, req.body?.id ?? null, -32602, "SendMessage requires bounded ROLE_USER text parts and a messageId.");
      return;
    }
    if (parsed.data.method !== "SendMessage") {
      rpcError(res, parsed.data.id, -32601, "Only SendMessage is supported by this connector.");
      return;
    }
    const text = parsed.data.params.message.parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
    if (Array.from(text).length > 4096) {
      rpcError(res, parsed.data.id, -32602, "Task text must be at most 4096 characters.");
      return;
    }

    try {
      const snapshot = await service.snapshot();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        jsonrpc: "2.0",
        id: parsed.data.id,
        result: {
          task: {
            id: randomUUID(),
            contextId: randomUUID(),
            status: { state: "TASK_STATE_COMPLETED", timestamp: new Date().toISOString() },
            artifacts: [{
              artifactId: randomUUID(),
              name: "hire-ai-read-only-status",
              description: "Aggregate status only. No Hire.AI action was executed or approved.",
              parts: [{ data: snapshot, mediaType: "application/json" }],
            }],
          },
        },
      });
    } catch {
      rpcError(res, parsed.data.id, -32603, "Hire.AI could not produce a read-only status snapshot.");
    }
  });
}
