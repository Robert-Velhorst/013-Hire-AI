import express from "express";
import { createServer, request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "@shared/documentUploads";
import { HttpError } from "../shared/_core/errors";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  parseFile: vi.fn(),
  uploadWithHistory: vi.fn(),
  reportHire: vi.fn(),
  submitVerification: vi.fn(),
  reserveScan: vi.fn(),
  lastUploadBytes: null as Buffer | null,
  uploadBufferBackingBytes: [] as number[],
}));

vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: mocks.authenticate },
}));
vi.mock("./uploadValidation", () => ({
  reserveSensitiveUploadScanPermit: mocks.reserveScan,
}));
vi.mock("./routers", () => ({
  appRouter: {
    createCaller: (context: { documentUploadBytes?: Buffer }) => {
      const dispatch =
        (procedure: ReturnType<typeof vi.fn>) => (input: unknown) => {
          mocks.lastUploadBytes = context.documentUploadBytes ?? null;
          if (context.documentUploadBytes) {
            mocks.uploadBufferBackingBytes.push(
              context.documentUploadBytes.buffer.byteLength
            );
          }
          return procedure(input);
        };
      return {
        resume: {
          parseFile: dispatch(mocks.parseFile),
          uploadWithHistory: dispatch(mocks.uploadWithHistory),
        },
        successFees: {
          reportHire: dispatch(mocks.reportHire),
          submitVerification: dispatch(mocks.submitVerification),
        },
      };
    },
  },
}));

import { registerDocumentUploadRoutes } from "./documentUploadRoutes";

const servers: ReturnType<typeof createServer>[] = [];

async function startServer() {
  const app = express();
  registerDocumentUploadRoutes(app);
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind.");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve());
          server.closeAllConnections();
        })
    )
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockImplementation(
    async (req: {
      headers: Record<string, string | string[] | undefined>;
    }) => ({
      id: Number(req.headers["x-test-user"] ?? 77),
    })
  );
  mocks.parseFile.mockResolvedValue({ success: true, resume: { version: 4 } });
  mocks.uploadWithHistory.mockResolvedValue({ id: 12 });
  mocks.reportHire.mockResolvedValue({ feeId: 8 });
  mocks.submitVerification.mockResolvedValue({ success: true });
  mocks.reserveScan.mockResolvedValue(null);
  mocks.lastUploadBytes = null;
  mocks.uploadBufferBackingBytes = [];
});

function uploadHeaders(
  metadata: unknown = { filename: "resume.txt", mimeType: "text/plain" }
) {
  return {
    "content-type": "application/octet-stream",
    "x-hire-upload-metadata": JSON.stringify(metadata),
  };
}

describe("bounded raw document upload routes", () => {
  it("limits upload attempts per client in addition to streaming and concurrency bounds", async () => {
    const baseUrl = await startServer();
    const statuses: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      const response = await fetch(`${baseUrl}/api/document-uploads/resume-parse`, {
        method: "POST",
        headers: uploadHeaders(),
        body: new Blob(["short resume"]),
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 6)).toEqual(Array(6).fill(200));
    expect(statuses[6]).toBe(429);
    expect(mocks.parseFile).toHaveBeenCalledTimes(6);
  });

  it("streams chunked bytes and dispatches resume parsing without a JSON envelope", async () => {
    const baseUrl = await startServer();
    const response = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const request = httpRequest(
          `${baseUrl}/api/document-uploads/resume-parse`,
          {
            method: "POST",
            headers: { ...uploadHeaders(), "transfer-encoding": "chunked" },
          },
          incoming => {
            const chunks: Buffer[] = [];
            incoming.on("data", chunk => chunks.push(Buffer.from(chunk)));
            incoming.on("end", () =>
              resolve({
                status: incoming.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              })
            );
          }
        );
        request.on("error", reject);
        request.write("streamed ");
        request.end("resume");
      }
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      success: true,
      resume: { version: 4 },
    });
    expect(mocks.parseFile).toHaveBeenCalledWith({
      filename: "resume.txt",
      mimeType: "text/plain",
    });
    expect(mocks.lastUploadBytes).toEqual(Buffer.from("streamed resume"));
    expect(mocks.lastUploadBytes?.byteLength).toBe(15);
    expect(mocks.lastUploadBytes?.buffer.byteLength).toBe(
      MAX_DOCUMENT_UPLOAD_BYTES
    );
  });

  it("holds two maximum chunked buffers and rejects a third upload before reading it", async () => {
    const baseUrl = await startServer();
    let releaseParsers!: () => void;
    let bothParsersStarted!: () => void;
    const parserGate = new Promise<void>(resolve => {
      releaseParsers = resolve;
    });
    const bothStarted = new Promise<void>(resolve => {
      bothParsersStarted = resolve;
    });
    let parserCount = 0;
    mocks.parseFile.mockImplementation(async () => {
      parserCount += 1;
      if (parserCount === 2) bothParsersStarted();
      await parserGate;
      return { success: true, resume: { version: 4 } };
    });

    const sendChunked = (userId: number, body: Buffer) =>
      new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          `${baseUrl}/api/document-uploads/resume-parse`,
          {
            method: "POST",
            headers: {
              ...uploadHeaders(),
              "transfer-encoding": "chunked",
              "x-test-user": String(userId),
            },
          },
          response => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          }
        );
        request.on("error", reject);
        request.end(body);
      });

    const fullUpload = Buffer.alloc(MAX_DOCUMENT_UPLOAD_BYTES, 0x61);
    const first = sendChunked(81, fullUpload);
    const second = sendChunked(82, fullUpload);
    try {
      await bothStarted;
      expect(mocks.uploadBufferBackingBytes).toEqual([
        MAX_DOCUMENT_UPLOAD_BYTES,
        MAX_DOCUMENT_UPLOAD_BYTES,
      ]);

      const rejected = await sendChunked(83, Buffer.from("not consumed"));
      expect(rejected).toBe(503);
      releaseParsers();
      expect(await Promise.all([first, second])).toEqual([200, 200]);
    } finally {
      releaseParsers();
    }
  });

  it.each([
    [
      "resume-history",
      { fileName: "resume.txt", mimeType: "text/plain" },
      "uploadWithHistory",
    ],
    [
      "hire-proof",
      {
        employerName: "Example",
        jobTitle: "Engineer",
        monthlySalary: 5000,
        currency: "EUR",
        startDate: "2026-10-13",
        offerLetterFileName: "offer.pdf",
        offerLetterMimeType: "application/pdf",
        termsAccepted: true,
      },
      "reportHire",
    ],
    [
      "verification",
      {
        successFeeId: 19,
        documentType: "paystub",
        documentFileName: "proof.pdf",
        documentMimeType: "application/pdf",
      },
      "submitVerification",
    ],
  ] as const)(
    "dispatches %s uploads through the existing protected procedure",
    async (kind, metadata, procedure) => {
      const baseUrl = await startServer();
      const response = await fetch(`${baseUrl}/api/document-uploads/${kind}`, {
        method: "POST",
        headers: uploadHeaders(metadata),
        body: new Blob(["proof bytes"]),
      });
      expect(response.status).toBe(200);
      if (procedure === "uploadWithHistory") {
        expect(mocks.uploadWithHistory).toHaveBeenCalledWith(metadata);
      } else if (procedure === "reportHire") {
        expect(mocks.reportHire).toHaveBeenCalledWith(metadata);
      } else {
        expect(mocks.submitVerification).toHaveBeenCalledWith(metadata);
      }
      expect(mocks.lastUploadBytes).toEqual(Buffer.from("proof bytes"));
    }
  );

  it("rejects scanner overload before consuming document bytes", async () => {
    const baseUrl = await startServer();
    mocks.reserveScan.mockRejectedValueOnce(
      new Error("The malware scanner is busy; retry the upload.")
    );
    const response = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${baseUrl}/api/document-uploads/resume-parse`,
        {
          method: "POST",
          headers: { ...uploadHeaders(), "transfer-encoding": "chunked" },
        },
        incoming => {
          incoming.resume();
          incoming.on("end", () => resolve(incoming.statusCode ?? 0));
        }
      );
      request.on("error", reject);
      request.end("not-consumed");
    });
    expect(response).toBe(503);
    expect(mocks.parseFile).not.toHaveBeenCalled();
  });

  it("authenticates and reserves capacity before reading a chunked body", async () => {
    const baseUrl = await startServer();
    mocks.authenticate.mockRejectedValueOnce(
      new HttpError(403, "unauthorized")
    );
    const response = await new Promise<{
      status: number;
      connection: string | undefined;
    }>((resolve, reject) => {
      const request = httpRequest(
        `${baseUrl}/api/document-uploads/resume-parse`,
        {
          method: "POST",
          headers: { ...uploadHeaders(), "transfer-encoding": "chunked" },
        },
        incoming => {
          incoming.resume();
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              connection: incoming.headers.connection,
            })
          );
        }
      );
      request.on("error", reject);
      request.write("not-read");
      request.end();
    });

    expect(response).toEqual({ status: 403, connection: "close" });
    expect(mocks.parseFile).not.toHaveBeenCalled();
  });

  it("rejects declared and chunked oversize bodies at the exact file limit", async () => {
    const baseUrl = await startServer();
    const declared = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${baseUrl}/api/document-uploads/resume-history`,
        {
          method: "POST",
          headers: {
            ...uploadHeaders({
              fileName: "resume.txt",
              mimeType: "text/plain",
            }),
            "content-length": String(MAX_DOCUMENT_UPLOAD_BYTES + 1),
          },
        },
        response => {
          response.resume();
          response.on("end", () => resolve(response.statusCode ?? 0));
        }
      );
      request.on("error", reject);
      request.end();
    });
    const chunked = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${baseUrl}/api/document-uploads/resume-history`,
        {
          method: "POST",
          headers: {
            ...uploadHeaders({
              fileName: "resume.txt",
              mimeType: "text/plain",
            }),
            "transfer-encoding": "chunked",
          },
        },
        response => {
          response.resume();
          response.on("end", () => resolve(response.statusCode ?? 0));
        }
      );
      request.on("error", reject);
      request.end(Buffer.alloc(MAX_DOCUMENT_UPLOAD_BYTES + 1));
    });

    expect(declared).toBe(413);
    expect(chunked).toBe(413);
    expect(mocks.uploadWithHistory).not.toHaveBeenCalled();
  });

  it("releases a tenant slot on client cancellation and allows another tenant while limiting total requests", async () => {
    const baseUrl = await startServer();
    const slow = httpRequest(`${baseUrl}/api/document-uploads/resume-parse`, {
      method: "POST",
      headers: {
        ...uploadHeaders(),
        "transfer-encoding": "chunked",
        "x-test-user": "77",
      },
    });
    slow.on("error", () => undefined);
    slow.write("slow");
    await new Promise(resolve => setTimeout(resolve, 20));

    const otherTenant = await fetch(
      `${baseUrl}/api/document-uploads/resume-parse`,
      {
        method: "POST",
        headers: { ...uploadHeaders(), "x-test-user": "78" },
        body: new Blob(["other tenant"]),
      }
    );
    expect(otherTenant.status).toBe(200);

    const sameTenant = await fetch(
      `${baseUrl}/api/document-uploads/resume-parse`,
      {
        method: "POST",
        headers: { ...uploadHeaders(), "x-test-user": "77" },
        body: new Blob(["same tenant"]),
      }
    );
    expect(sameTenant.status).toBe(503);

    slow.destroy();
    await new Promise<void>(resolve => slow.once("close", () => resolve()));

    const retried = await fetch(
      `${baseUrl}/api/document-uploads/resume-parse`,
      {
        method: "POST",
        headers: { ...uploadHeaders(), "x-test-user": "77" },
        body: new Blob(["retry"]),
      }
    );
    expect(retried.status).toBe(200);
  });
});
