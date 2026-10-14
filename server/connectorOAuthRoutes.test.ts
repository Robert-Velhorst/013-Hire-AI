import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createRateLimitMiddleware } from "./_core/apiRateLimit";
import {
  getMissingProviderScopes,
  registerConnectorOAuthRoutes,
} from "./connectorOAuthRoutes";

async function withLimitedConnectorCallback(
  run: (
    baseUrl: string,
    advance: (milliseconds: number) => void
  ) => Promise<void>
) {
  let currentTime = 1_000_000;
  const limiter = createRateLimitMiddleware({
    windowMs: 10_000,
    maxRequests: 2,
    maxClients: 2,
    now: () => currentTime,
  });
  const app = express();
  registerConnectorOAuthRoutes(app, limiter);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Connector callback test server did not bind to TCP.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`, milliseconds => {
      currentTime += milliseconds;
    });
  } finally {
    currentTime += 20_000;
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

describe("connector OAuth callback scope boundary", () => {
  it("requires mailbox read authority by default and send authority only for an explicit delivery consent", () => {
    expect(
      getMissingProviderScopes("gmail", [
        "https://www.googleapis.com/auth/gmail.metadata",
      ])
    ).toEqual([]);

    expect(
      getMissingProviderScopes(
        "gmail",
        ["https://www.googleapis.com/auth/gmail.metadata"],
        [
          "email.metadata.read",
          "email.messages.read_recruiting",
          "email.messages.send",
        ]
      )
    ).toEqual(["https://www.googleapis.com/auth/gmail.send"]);
  });

  it("does not treat internal consent labels as proof that Outlook or Drive granted read authority", () => {
    expect(getMissingProviderScopes("outlook", ["Mail.Send"])).toEqual([
      "Mail.Read",
    ]);
    expect(getMissingProviderScopes("google_drive", [])).toEqual([
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
  });

  it("accepts an exact provider grant even when the token response includes whitespace", () => {
    expect(
      getMissingProviderScopes("dropbox", [
        " files.metadata.read ",
        "files.content.read",
      ])
    ).toEqual([]);
  });
});

describe("connector OAuth callback rate limit", () => {
  it("rejects excess callback attempts and resets the client budget", async () => {
    await withLimitedConnectorCallback(async (baseUrl, advance) => {
      const callback = () => fetch(`${baseUrl}/api/connectors/oauth/callback`);
      const first = await callback();
      const second = await callback();
      const blocked = await callback();

      expect(first.status).toBe(400);
      expect(second.status).toBe(400);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("ratelimit-limit")).toBe("2");
      expect(blocked.headers.get("retry-after")).toBe("10");

      advance(10_000);
      expect((await callback()).status).toBe(400);
    });
  });
});
