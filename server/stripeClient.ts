import Stripe from "stripe";
import { inspectStripeBillingPolicy } from "@shared/stripeBillingPolicy.mjs";

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  const policy = inspectStripeBillingPolicy(process.env);
  if (!policy.enabled) {
    throw new Error("Stripe billing is disabled. Set STRIPE_ENABLED=true only after billing is approved.");
  }
  if (policy.issue) throw new Error(policy.issue);

  const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!apiKey) throw new Error("STRIPE_SECRET_KEY is required when Stripe billing is enabled.");

  if (!stripeClient) {
    stripeClient = new Stripe(apiKey);
  }
  return stripeClient;
}
