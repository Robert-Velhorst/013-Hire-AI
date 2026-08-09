import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { NOTIFICATION_DELIVERY_FAILURE, notifyOwner } from "./notification";

const originalForgeApiUrl = ENV.forgeApiUrl;
const originalForgeApiKey = ENV.forgeApiKey;

afterEach(() => {
  ENV.forgeApiUrl = originalForgeApiUrl;
  ENV.forgeApiKey = originalForgeApiKey;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("owner notification delivery", () => {
  it("does not log an upstream response body when delivery is rejected", async () => {
    ENV.forgeApiUrl = "https://notifications.example.local";
    ENV.forgeApiKey = "notification-key";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response("Bearer provider-secret", { status: 502, statusText: "Bad Gateway" })
    ));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(notifyOwner({ title: "Ledger review", content: "Follow-up needs approval." })).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith("[Notification] Delivery failed with status 502.");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("provider-secret");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("notification-key");
  });

  it("does not log a thrown transport error", async () => {
    ENV.forgeApiUrl = "https://notifications.example.local";
    ENV.forgeApiKey = "notification-key";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(
      new Error("transport refused Bearer provider-secret")
    ));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(notifyOwner({ title: "Ledger review", content: "Follow-up needs approval." })).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(NOTIFICATION_DELIVERY_FAILURE);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("provider-secret");
  });

  it("bounds provider delivery with an abort signal", async () => {
    ENV.forgeApiUrl = "https://notifications.example.local";
    ENV.forgeApiKey = "notification-key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(notifyOwner({ title: "Ledger review", content: "Follow-up needs approval." })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });
});
