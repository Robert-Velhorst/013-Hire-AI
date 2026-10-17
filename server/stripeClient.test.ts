import { afterEach, describe, expect, it, vi } from "vitest";
import { getStripeClient } from "./stripeClient";

describe("Stripe client activation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not construct a client when billing is disabled, even if keys exist", () => {
    vi.stubEnv("STRIPE_ENABLED", "false");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_disabled");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_disabled");

    expect(() => getStripeClient()).toThrow("Stripe billing is disabled");
  });

  it("requires complete provider credentials when billing is enabled", () => {
    vi.stubEnv("STRIPE_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_enabled");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

    expect(() => getStripeClient()).toThrow("STRIPE_WEBHOOK_SECRET is required");
  });

  it("constructs a client only after explicit enablement and complete credentials", () => {
    vi.stubEnv("STRIPE_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_enabled");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_enabled");

    expect(getStripeClient()).toBeDefined();
  });
});
