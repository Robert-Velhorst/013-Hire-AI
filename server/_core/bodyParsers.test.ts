import express from "express";
import { createServer, request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import {
  createDocumentBodyAdmission,
  registerApplicationBodyParsers,
} from "./bodyParsers";

describe("application body parsers", () => {
  it("accepts bounded JSON and rejects oversized JSON before the route runs", async () => {
    const app = express();
    registerApplicationBodyParsers(app, { json: 1_024, form: 1_024 });
    let routeCalls = 0;
    app.post("/input", (_req, res) => {
      routeCalls += 1;
      res.sendStatus(204);
    });
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind to TCP.");
    const url = `http://127.0.0.1:${address.port}/input`;

    try {
      const accepted = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "ready" }),
      });
      const rejected = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(2_000) }),
      });
      expect(accepted.status).toBe(204);
      expect(rejected.status).toBe(413);
      expect(routeCalls).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });

  it("keeps the larger JSON budget on authenticated document routes only", async () => {
    const app = express();
    registerApplicationBodyParsers(app, {
      json: 1_024,
      form: 1_024,
      documentJson: 2_048,
      authenticateDocumentUpload: async req =>
        req.get("x-test-user") === "21" ? { id: 21 } : null,
    });
    let documentCalls = 0;
    app.post("/api/trpc/resume.uploadWithHistory", (_req, res) => {
      documentCalls += 1;
      res.sendStatus(204);
    });
    app.post("/api/trpc/profile.update", (_req, res) => res.sendStatus(204));
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind to TCP.");
    const url = `http://127.0.0.1:${address.port}`;

    try {
      const document = await fetch(`${url}/api/trpc/resume.uploadWithHistory`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user": "21",
        },
        body: JSON.stringify({ value: "x".repeat(1_200) }),
      });
      const ordinary = await fetch(`${url}/api/trpc/profile.update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(1_200) }),
      });
      const declaredOversize = await fetch(
        `${url}/api/trpc/resume.uploadWithHistory`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "21",
          },
          body: JSON.stringify({ value: "x".repeat(3_000) }),
        }
      );
      const unauthenticatedChunked = await new Promise<{
        status: number;
        connection: string | undefined;
      }>((resolve, reject) => {
        const request = httpRequest(
          `${url}/api/trpc/resume.parseFile`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "transfer-encoding": "chunked",
            },
          },
          response => {
            response.resume();
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                connection: response.headers.connection,
              })
            );
          }
        );
        request.on("error", reject);
        request.end(JSON.stringify({ value: "x".repeat(1_200) }));
      });

      expect(document.status).toBe(204);
      expect(ordinary.status).toBe(413);
      expect(declaredOversize.status).toBe(413);
      expect(declaredOversize.headers.get("connection")).toBe("close");
      expect(unauthenticatedChunked).toEqual({
        status: 401,
        connection: "close",
      });
      expect(documentCalls).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });

  it("bounds concurrent document parsing globally and per user", () => {
    const admission = createDocumentBodyAdmission(2, 1);
    const releaseFirst = admission.tryAcquire(1);
    expect(releaseFirst).toEqual(expect.any(Function));
    expect(admission.tryAcquire(1)).toBeNull();
    const releaseSecond = admission.tryAcquire(2);
    expect(releaseSecond).toEqual(expect.any(Function));
    expect(admission.tryAcquire(3)).toBeNull();
    expect(admission.activeCount()).toBe(2);

    releaseFirst?.();
    releaseFirst?.();
    expect(admission.tryAcquire(1)).toEqual(expect.any(Function));
    releaseSecond?.();
    expect(admission.activeCount()).toBe(1);
  });

  it("holds admission for slow bodies, releases on cancellation, and accepts bounded chunked uploads", async () => {
    const app = express();
    registerApplicationBodyParsers(app, {
      authenticateDocumentUpload: async req =>
        req.get("x-test-user") === "34" ? { id: 34 } : null,
    });
    app.post("/api/trpc/resume.parseFile", (_req, res) => res.sendStatus(204));
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind to TCP.");
    const url = `http://127.0.0.1:${address.port}/api/trpc/resume.parseFile`;
    const slowRequest = httpRequest(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        "x-test-user": "34",
      },
    });
    slowRequest.on("error", () => undefined);

    try {
      slowRequest.write('{"value":"slow');
      await new Promise(resolve => setTimeout(resolve, 25));
      const blocked = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user": "34",
        },
        body: JSON.stringify({ value: "another upload" }),
      });
      expect(blocked.status).toBe(503);

      const closed = new Promise<void>(resolve =>
        slowRequest.once("close", resolve)
      );
      slowRequest.destroy();
      await closed;

      let recovered = 0;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        recovered = await new Promise<number>((resolve, reject) => {
          const request = httpRequest(
            url,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "transfer-encoding": "chunked",
                "x-test-user": "34",
              },
            },
            response => {
              response.resume();
              response.on("end", () => resolve(response.statusCode ?? 0));
            }
          );
          request.on("error", reject);
          request.end(JSON.stringify({ value: "bounded" }));
        });
        if (recovered !== 503) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(recovered).toBe(204);
    } finally {
      slowRequest.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });
});
