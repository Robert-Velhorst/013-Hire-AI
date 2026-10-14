import type { Express, Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "@shared/documentUploads";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { createDocumentBodyAdmission } from "./_core/bodyParsers";
import { reserveSensitiveUploadScanPermit } from "./uploadValidation";
import { HttpError } from "../shared/_core/errors";
import { createSensitiveRouteRateLimiter } from "./_core/apiRateLimit";

const DOCUMENT_UPLOAD_PATH = "/api/document-uploads/:kind";
const MAX_METADATA_HEADER_BYTES = 6 * 1024;
const admission = createDocumentBodyAdmission(2, 1);

type UploadKind =
  "resume-parse" | "resume-history" | "hire-proof" | "verification";

function reject(res: Response, status: number, error: string) {
  res.setHeader("Connection", "close");
  res.status(status).json({ error });
}

function parseDeclaredLength(req: Request, res: Response) {
  const header = req.headers["content-length"];
  if (header === undefined) return null;
  if (!/^\d+$/.test(header)) {
    reject(res, 400, "Invalid Content-Length header.");
    return undefined;
  }
  const length = Number(header);
  if (!Number.isSafeInteger(length) || length > MAX_DOCUMENT_UPLOAD_BYTES) {
    reject(res, 413, "Document exceeds the 10 MiB upload limit.");
    return undefined;
  }
  return length;
}

async function readBoundedBody(req: Request, declaredLength: number | null) {
  const chunks: Buffer[] = [];
  const output =
    declaredLength === null ? null : Buffer.allocUnsafe(declaredLength);
  let total = 0;
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const nextTotal = total + chunk.length;
    if (nextTotal > MAX_DOCUMENT_UPLOAD_BYTES) {
      req.pause();
      const error = new Error("Document exceeds the 10 MiB upload limit.");
      Object.assign(error, { statusCode: 413 });
      throw error;
    }
    if (output) {
      if (nextTotal > output.length) {
        const error = new Error(
          "Document length did not match Content-Length."
        );
        Object.assign(error, { statusCode: 400 });
        throw error;
      }
      chunk.copy(output, total);
    } else {
      chunks.push(chunk);
    }
    total = nextTotal;
  }
  if (declaredLength !== null && total !== declaredLength) {
    const error = new Error("Document length did not match Content-Length.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }
  if (total === 0) {
    const error = new Error("Document upload is empty.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }
  return output ?? Buffer.concat(chunks, total);
}

function isUploadKind(value: string): value is UploadKind {
  return [
    "resume-parse",
    "resume-history",
    "hire-proof",
    "verification",
  ].includes(value);
}

async function handleDocumentUpload(req: Request, res: Response) {
  if (req.method !== "POST" || !isUploadKind(req.params.kind)) {
    res.setHeader("Connection", "close");
    res.status(404).json({ error: "Document upload route not found." });
    return;
  }
  if (!req.is("application/octet-stream")) {
    reject(res, 415, "Document uploads must use application/octet-stream.");
    return;
  }
  const declaredLength = parseDeclaredLength(req, res);
  if (declaredLength === undefined || res.headersSent) return;

  const rawMetadata = req.get("x-hire-upload-metadata") ?? "";
  if (Buffer.byteLength(rawMetadata) > MAX_METADATA_HEADER_BYTES) {
    reject(res, 400, "Document upload metadata is invalid.");
    return;
  }
  let metadata: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawMetadata);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid metadata");
    }
    metadata = parsed as Record<string, unknown>;
  } catch {
    reject(res, 400, "Document upload metadata is invalid.");
    return;
  }

  let context: TrpcContext;
  try {
    const user = await sdk.authenticateRequest(req);
    context = { req, res, user };
  } catch (error) {
    const status = error instanceof HttpError ? error.statusCode : 500;
    reject(
      res,
      status,
      status === 503
        ? "Authentication is temporarily unavailable."
        : "Authentication is required."
    );
    return;
  }
  if (!context.user) {
    reject(res, 401, "Authentication is required.");
    return;
  }
  const release = admission.tryAcquire(context.user.id);
  if (!release) {
    res.setHeader("Retry-After", "5");
    reject(res, 503, "Document upload capacity is temporarily exhausted.");
    return;
  }

  let releaseScanPermit: (() => void) | null = null;
  let bodyConsumed = false;
  try {
    releaseScanPermit = await reserveSensitiveUploadScanPermit();
    context.uploadScanPermit = releaseScanPermit ?? undefined;
    const file = await readBoundedBody(req, declaredLength);
    bodyConsumed = true;
    context.documentUploadBytes = file;
    const caller = appRouter.createCaller(context);
    let result: unknown;
    switch (req.params.kind as UploadKind) {
      case "resume-parse":
        result = await caller.resume.parseFile({
          filename: String(metadata.filename ?? ""),
          mimeType: String(metadata.mimeType ?? ""),
        });
        break;
      case "resume-history":
        result = await caller.resume.uploadWithHistory({
          fileName: String(metadata.fileName ?? ""),
          mimeType:
            typeof metadata.mimeType === "string"
              ? metadata.mimeType
              : undefined,
        });
        break;
      case "hire-proof":
        result = await caller.successFees.reportHire({
          ...metadata,
        } as Parameters<typeof caller.successFees.reportHire>[0]);
        break;
      case "verification":
        result = await caller.successFees.submitVerification({
          ...metadata,
        } as Parameters<typeof caller.successFees.submitVerification>[0]);
        break;
    }
    res.status(200).json(result);
  } catch (error) {
    if (res.destroyed || res.headersSent) return;
    const attachedStatus =
      error && typeof error === "object" && "statusCode" in error
        ? Number(error.statusCode)
        : null;
    const status =
      attachedStatus && attachedStatus >= 400 && attachedStatus < 600
        ? attachedStatus
        : error instanceof Error &&
            /scanner|malware scanner/i.test(error.message) &&
            !/rejected by the malware scanner/i.test(error.message)
          ? 503
          : error instanceof Error &&
              error.message.includes("rejected by the malware scanner")
            ? 422
            : error instanceof Error && error.message.includes("10 MiB")
              ? 413
              : error instanceof Error &&
                  error.message.includes("length did not match")
                ? 400
                : error instanceof Error && error.message.includes("empty")
                  ? 400
                  : error instanceof TRPCError
                    ? getHTTPStatusCodeFromError(error)
                    : 500;
    if (status === 503) res.setHeader("Retry-After", "5");
    if (!bodyConsumed) res.setHeader("Connection", "close");
    res
      .status(status)
      .json({
        error:
          error instanceof Error ? error.message : "Document upload failed.",
      });
  } finally {
    releaseScanPermit?.();
    release();
  }
}

export function registerDocumentUploadRoutes(app: Express) {
  // The limiter's custom store caps the number of client keys held in memory.
  app.post(DOCUMENT_UPLOAD_PATH, createSensitiveRouteRateLimiter("documentUpload"), (req, res) => {
    void handleDocumentUpload(req, res).catch(() => {
      if (!res.destroyed && !res.headersSent) {
        res.status(500).json({ error: "Document upload failed." });
      }
    });
  });
}
