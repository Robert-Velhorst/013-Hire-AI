export interface StripeBillingEnvironment {
  STRIPE_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export function inspectStripeBillingPolicy(env?: StripeBillingEnvironment): {
  enabled: boolean;
  issue: string | null;
};

export function isStripeBillingEnabled(env?: StripeBillingEnvironment): boolean;
export function isStripeBillingConfigured(env?: StripeBillingEnvironment): boolean;
