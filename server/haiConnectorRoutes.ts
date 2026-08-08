import { randomUUID } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  HAI_CONNECTOR_AGENT_VERSION,
  HAI_CONNECTOR_PROTOCOL_VERSION,
  HaiConnectorService,
} from "./haiConnector";

const maxBodyBytes = 16 * 1024;
const textPartSchema = z.object({
  text: z.string().trim().min(1),
  mediaType: z.literal("text/plain").optional(),
}).strict();
const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().min(1).max(255), z.number().finite()]),
  method: z.string().min(1).max(80),
  params: z.object({
    message: z.object({
      messageId: z.string().trim().min(1).max(255),
      role: z.literal("ROLE_USER"),
      parts: z.array(textPartSchema).min(1).max(4),
    }).strict(),
  }).strict(),
}).strict();

function bearerToken(header: string | undefined) {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? "";
}

function rpcError(res: Response, id: string | number | null, code: number, message: string) {
  res.status(400).json({ jsonrpc: "2.0", id, error: { code, message } });
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

export function registerHaiConnectorRoutes(
  app: Express,
  service = new HaiConnectorService()
) {
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

  app.get("/api/hai/status", (req, res) => {
    if (!service.authorize(bearerToken(req.header("authorization")))) {
      res.sendStatus(404);
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(service.status());
  });

  const requireHaiAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!service.authorize(bearerToken(req.header("authorization")))) {
      res.sendStatus(404);
      return;
    }
    next();
  };

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
