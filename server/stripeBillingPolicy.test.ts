import { describe, expect, it } from "vitest";
import {
  inspectStripeBillingPolicy,
  isStripeBillingConfigured,
  isStripeBillingEnabled,
} from "@shared/stripeBillingPolicy.mjs";

describe("Stripe billing activation policy", () => {
  it("keeps Stripe disabled when the activation flag is absent or false", () => {
    expect(inspectStripeBillingPolicy({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "whsec_1" }))
      .toEqual({ enabled: false, issue: null });
    expect(isStripeBillingEnabled({ STRIPE_ENABLED: "false" })).toBe(false);
  });

  it("rejects malformed activation flags", () => {
    expect(inspectStripeBillingPolicy({ STRIPE_ENABLED: "yes" })).toEqual({
      enabled: false,
      issue: "STRIPE_ENABLED must be true or false.",
    });
  });

  it.each([
    [{ STRIPE_ENABLED: "true" }, "STRIPE_SECRET_KEY is required when Stripe billing is enabled."],
    [{ STRIPE_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_1" }, "STRIPE_WEBHOOK_SECRET is required when Stripe billing is enabled."],
  ])("requires both credentials when explicitly enabled", (env, issue) => {
    expect(inspectStripeBillingPolicy(env)).toEqual({ enabled: true, issue });
    expect(isStripeBillingEnabled(env)).toBe(true);
    expect(isStripeBillingConfigured(env)).toBe(false);
  });

  it("enables only when the flag and both credentials are present", () => {
    const env = {
      STRIPE_ENABLED: " TRUE ",
      STRIPE_SECRET_KEY: "sk_test_1",
      STRIPE_WEBHOOK_SECRET: "whsec_1",
    };
    expect(isStripeBillingEnabled(env)).toBe(true);
    expect(isStripeBillingConfigured(env)).toBe(true);
  });
});
