import { describe, expect, it } from "vitest";
import { resolveAnalyticsScriptUrl } from "./analyticsConfig";

describe("resolveAnalyticsScriptUrl", () => {
  it("loads the script only from the explicitly approved HTTPS origin", () => {
    expect(
      resolveAnalyticsScriptUrl(
        "https://metrics.example.test/ignored/path",
        "https://metrics.example.test"
      )
    ).toBe("https://metrics.example.test/umami");
  });

  it.each([
    ["https://attacker.example/umami", "https://metrics.example.test"],
    ["http://metrics.example.test/umami", "https://metrics.example.test"],
    [
      "https://user:pass@metrics.example.test/umami",
      "https://metrics.example.test",
    ],
    ["https://metrics.example.test/umami", "http://metrics.example.test"],
    ["https://metrics.example.test/umami", "https://metrics.example.test/path"],
  ])("rejects unapproved or unsafe endpoint %s", (endpoint, allowedOrigin) => {
    expect(resolveAnalyticsScriptUrl(endpoint, allowedOrigin)).toBeUndefined();
  });

  it("keeps analytics disabled when either optional setting is absent", () => {
    expect(
      resolveAnalyticsScriptUrl(undefined, "https://metrics.example.test")
    ).toBeUndefined();
    expect(
      resolveAnalyticsScriptUrl("https://metrics.example.test", undefined)
    ).toBeUndefined();
  });
});
