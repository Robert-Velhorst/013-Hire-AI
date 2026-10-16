import { describe, expect, it } from "vitest";
import { consumeConnectorOAuthIntent, createConnectorOAuthIntent } from "./db";

describe("connector OAuth intent persistence", () => {
  it("consumes a matching browser intent exactly once", async () => {
    const intent = await createConnectorOAuthIntent({
      stateNonceHash: "a".repeat(64),
      userId: 928301,
      provider: "gmail",
      consentScopes: JSON.stringify([
        "email.metadata.read",
        "email.messages.read_recruiting",
      ]),
      sessionBinding: "b".repeat(64),
      applicationOrigin: "https://hire.example.test",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const input = {
      stateNonceHash: intent.stateNonceHash,
      userId: intent.userId,
      provider: intent.provider,
      consentScopes: intent.consentScopes,
      sessionBinding: intent.sessionBinding,
      applicationOrigin: intent.applicationOrigin,
    };

    const results = await Promise.all([
      consumeConnectorOAuthIntent(input),
      consumeConnectorOAuthIntent(input),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("rejects intents with changed owner, provider, scopes, session, origin, or expiry", async () => {
    const intent = await createConnectorOAuthIntent({
      stateNonceHash: "c".repeat(64),
      userId: 928302,
      provider: "gmail",
      consentScopes: JSON.stringify([
        "email.metadata.read",
        "email.messages.read_recruiting",
      ]),
      sessionBinding: "d".repeat(64),
      applicationOrigin: "https://hire.example.test",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const input = {
      stateNonceHash: intent.stateNonceHash,
      userId: intent.userId,
      provider: intent.provider,
      consentScopes: intent.consentScopes,
      sessionBinding: intent.sessionBinding,
      applicationOrigin: intent.applicationOrigin,
    };

    await expect(
      consumeConnectorOAuthIntent({ ...input, userId: input.userId + 1 })
    ).resolves.toBe(false);
    await expect(
      consumeConnectorOAuthIntent({ ...input, provider: "google_drive" })
    ).resolves.toBe(false);
    await expect(
      consumeConnectorOAuthIntent({ ...input, consentScopes: "[]" })
    ).resolves.toBe(false);
    await expect(
      consumeConnectorOAuthIntent({ ...input, sessionBinding: "e".repeat(64) })
    ).resolves.toBe(false);
    await expect(
      consumeConnectorOAuthIntent({
        ...input,
        applicationOrigin: "https://other.example.test",
      })
    ).resolves.toBe(false);
    await expect(
      consumeConnectorOAuthIntent({
        ...input,
        now: new Date(Date.now() + 120_000),
      })
    ).resolves.toBe(false);
  });
});
