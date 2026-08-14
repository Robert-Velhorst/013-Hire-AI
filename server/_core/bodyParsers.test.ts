import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { registerApplicationBodyParsers } from "./bodyParsers";

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
});
