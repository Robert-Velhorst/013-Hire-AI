import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  getMissingProviderScopes,
  registerConnectorOAuthRoutes,
} from "./connectorOAuthRoutes";

async function withConnectorCallbackServer(
  run: (baseUrl: string) => Promise<void>
) {
  const app = express();
  registerConnectorOAuthRoutes(app);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Connector callback test server did not bind to TCP.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
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
  it("rejects callback attempts above the per-client minute budget", async () => {
    await withConnectorCallbackServer(async baseUrl => {
      const callback = () => fetch(`${baseUrl}/api/connectors/oauth/callback`);
      const responses = await Promise.all(
        Array.from({ length: 31 }, () => callback())
      );
      const blocked = responses.find(response => response.status === 429);

      expect(
        responses.filter(response => response.status === 400)
      ).toHaveLength(30);
      expect(blocked?.headers.get("ratelimit-limit")).toBe("30");
      expect(blocked?.headers.get("retry-after")).toBeTruthy();
    });
  });
});
