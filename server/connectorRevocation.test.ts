import { describe, expect, it, vi } from "vitest";
import { revokeConnectorGrant } from "./connectorRevocation";

describe("connector provider revocation", () => {
  it("revokes Google access without putting the token in the URL", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));

    const result = await revokeConnectorGrant(
      "gmail",
      "google-secret-token",
      fetcher as typeof fetch
    );

    expect(result.status).toBe("revoked");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(url)).not.toContain("google-secret-token");
    expect(request.body?.toString()).toBe("token=google-secret-token");
    expect(request.headers).not.toHaveProperty("Authorization");
  });

  it("uses Dropbox's scoped bearer-token revocation endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));

    const result = await revokeConnectorGrant(
      "dropbox",
      "dropbox-secret-token",
      fetcher as typeof fetch
    );

    expect(result.status).toBe("revoked");
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.dropboxapi.com/2/auth/token/revoke");
    expect(request).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer dropbox-secret-token" },
    });
  });

  it.each(["outlook", "linkedin"] as const)(
    "requires manual account-side cleanup for %s instead of broad revocation",
    async provider => {
      const fetcher = vi.fn();

      const result = await revokeConnectorGrant(
        provider,
        "secret-token",
        fetcher as typeof fetch
      );

      expect(result.status).toBe("manual_required");
      expect(result.detail).toMatch(/Remove Hire\.AI/);
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it("fails without echoing provider response bodies or tokens", async () => {
    const fetcher = vi.fn(
      async () => new Response("token=do-not-leak", { status: 503 })
    );

    await expect(
      revokeConnectorGrant(
        "dropbox",
        "dropbox-secret-token",
        fetcher as typeof fetch
      )
    ).rejects.toThrow("Connector provider revocation failed with HTTP 503.");
  });
});
