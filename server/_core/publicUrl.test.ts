import { describe, expect, it, vi } from "vitest";
import { requirePublicHttpsUrl } from "./publicUrl";

describe("public outbound URL policy", () => {
  it("accepts a credential-free HTTPS URL resolving only to public addresses", async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    await expect(requirePublicHttpsUrl("https://media.example/audio.mp3", lookup))
      .resolves.toBe("https://media.example/audio.mp3");
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.20",
    "::1",
    "fc00::1",
    "::ffff:7f00:1",
  ])("rejects a URL resolving to blocked address %s", async (address) => {
    const lookup = vi.fn().mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    await expect(requirePublicHttpsUrl("https://media.example/audio.mp3", lookup))
      .rejects.toThrow(/public address/i);
  });

  it("rejects mixed public and private DNS answers", async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(requirePublicHttpsUrl("https://media.example/audio.mp3", lookup))
      .rejects.toThrow(/public address/i);
  });

  it("does not expose DNS resolver failures", async () => {
    const lookup = vi.fn().mockRejectedValue(new Error("internal resolver 10.0.0.53 failed"));
    await expect(requirePublicHttpsUrl("https://media.example/audio.mp3", lookup))
      .rejects.toThrow("Remote URL could not be resolved safely.");
  });
});
