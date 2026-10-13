import express, { type Express, type Request, type Response } from "express";
import { HttpError } from "../../shared/_core/errors";
import {
  APPLICATION_FORM_LIMIT,
  APPLICATION_JSON_LIMIT,
  RESUME_TEXT_JSON_LIMIT,
} from "./httpRuntimePolicy";
import { sdk } from "./sdk";

const MAX_CONCURRENT_DOCUMENT_REQUESTS = 2;
const MAX_DOCUMENT_REQUESTS_PER_USER = 1;

const DOCUMENT_ROUTES = new Map<string, string>([
  ["/api/trpc/resume.parse", RESUME_TEXT_JSON_LIMIT],
]);

export interface ApplicationBodyParserLimits {
  json?: string | number;
  form?: string | number;
  documentJson?: string | number;
  authenticateDocumentUpload?: (req: Request) => Promise<{ id: number } | null>;
}

export function createDocumentBodyAdmission(
  maxConcurrent = MAX_CONCURRENT_DOCUMENT_REQUESTS,
  maxPerUser = MAX_DOCUMENT_REQUESTS_PER_USER
) {
  let active = 0;
  const byUser = new Map<number, number>();

  return {
    tryAcquire(userId: number): (() => void) | null {
      if (active >= maxConcurrent || (byUser.get(userId) ?? 0) >= maxPerUser) {
        return null;
      }

      active += 1;
      byUser.set(userId, (byUser.get(userId) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
        const remaining = (byUser.get(userId) ?? 1) - 1;
        if (remaining > 0) byUser.set(userId, remaining);
        else byUser.delete(userId);
      };
    },
    activeCount() {
      return active;
    },
  };
}

function parseByteLimit(limit: string | number) {
  if (typeof limit === "number") return limit;
  const match = limit.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
  if (!match) throw new Error("Invalid request body limit configuration.");
  const scale = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[
    (match[2] ?? "b").toLowerCase() as "b" | "kb" | "mb" | "gb"
  ];
  const bytes = Number(match[1]) * scale;
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error("Invalid request body limit configuration.");
  }
  return bytes;
}

function rejectOversizedDeclaredBody(
  req: Request,
  res: Response,
  maxBytes: number
) {
  const declaredLength = req.headers["content-length"];
  if (declaredLength === undefined) return false;
  if (!/^\d+$/.test(declaredLength)) {
    rejectRequest(res, 400, { error: "Invalid Content-Length header." });
    return true;
  }
  const bytes = Number(declaredLength);
  if (!Number.isSafeInteger(bytes) || bytes > maxBytes) {
    rejectRequest(res, 413, { error: "Request body is too large." });
    return true;
  }
  return false;
}

function rejectRequest(res: Response, status: number, body: { error: string }) {
  res.setHeader("Connection", "close");
  res.status(status).json(body);
}

export function registerApplicationBodyParsers(
  app: Express,
  limits: ApplicationBodyParserLimits = {}
) {
  const admission = createDocumentBodyAdmission();
  const defaultJsonLimit = limits.json ?? APPLICATION_JSON_LIMIT;
  const authenticate =
    limits.authenticateDocumentUpload ??
    (async (req: Request) => sdk.authenticateRequest(req));

  app.use((req, res, next) => {
    const configuredDocumentLimit = DOCUMENT_ROUTES.get(req.path);
    if (req.method !== "POST" || !configuredDocumentLimit) {
      express.json({ limit: defaultJsonLimit })(req, res, next);
      return;
    }

    const documentLimit = limits.documentJson ?? configuredDocumentLimit;
    const maxBytes = parseByteLimit(documentLimit);
    if (rejectOversizedDeclaredBody(req, res, maxBytes)) return;
    if (!req.is("application/json")) {
      rejectRequest(res, 415, { error: "Document requests must use JSON." });
      return;
    }

    void authenticate(req)
      .then(user => {
        if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
          rejectRequest(res, 401, { error: "Authentication is required." });
          return;
        }
        const release = admission.tryAcquire(user.id);
        if (!release) {
          res.setHeader("Retry-After", "5");
          rejectRequest(res, 503, {
            error: "Document upload capacity is temporarily exhausted.",
          });
          return;
        }

        let released = false;
        const releaseOnce = () => {
          if (released) return;
          released = true;
          release();
        };
        res.once("finish", releaseOnce);
        res.once("close", releaseOnce);

        express.json({ limit: documentLimit })(req, res, error => {
          if (error) releaseOnce();
          next(error);
        });
      })
      .catch(error => {
        if (error instanceof HttpError) {
          const status =
            error.statusCode >= 400 && error.statusCode < 600
              ? error.statusCode
              : 500;
          rejectRequest(res, status, {
            error:
              status === 503
                ? "Authentication is temporarily unavailable."
                : "Authentication is required.",
          });
          return;
        }
        next(error);
      });
  });

  app.use(
    express.urlencoded({
      limit: limits.form ?? APPLICATION_FORM_LIMIT,
      extended: true,
    })
  );
}
