import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { getMissingProviderScopes, registerConnectorOAuthRoutes } from "./connectorOAuthRoutes";

describe("connector OAuth callback scope boundary", () => {
  it("rate limits repeated connector callbacks per client before processing state", async () => {
    const app = express();
    registerConnectorOAuthRoutes(app);
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind.");

    try {
      const statuses: number[] = [];
      for (let index = 0; index < 31; index += 1) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/connectors/oauth/callback?state=invalid`
        );
        statuses.push(response.status);
      }
      expect(statuses.slice(0, 30).every(status => status === 400)).toBe(true);
      expect(statuses[30]).toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())
      );
    }
  });

  it("requires mailbox read authority by default and send authority only for an explicit delivery consent", () => {
    expect(getMissingProviderScopes("gmail", [
      "https://www.googleapis.com/auth/gmail.metadata",
    ])).toEqual([]);

    expect(getMissingProviderScopes("gmail", [
      "https://www.googleapis.com/auth/gmail.metadata",
    ], ["email.metadata.read", "email.messages.read_recruiting", "email.messages.send"])).toEqual([
      "https://www.googleapis.com/auth/gmail.send",
    ]);
  });

  it("does not treat internal consent labels as proof that Outlook or Drive granted read authority", () => {
    expect(getMissingProviderScopes("outlook", ["Mail.Send"])).toEqual(["Mail.Read"]);
    expect(getMissingProviderScopes("google_drive", [])).toEqual([
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
  });

  it("accepts an exact provider grant even when the token response includes whitespace", () => {
    expect(getMissingProviderScopes("dropbox", [
      " files.metadata.read ",
      "files.content.read",
    ])).toEqual([]);
  });
});
