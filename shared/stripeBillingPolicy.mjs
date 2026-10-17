export function inspectStripeBillingPolicy(env = {}) {
  const configuredFlag = String(env.STRIPE_ENABLED ?? "").trim().toLowerCase();
  if (configuredFlag && configuredFlag !== "true" && configuredFlag !== "false") {
    return { enabled: false, issue: "STRIPE_ENABLED must be true or false." };
  }

  const enabled = configuredFlag === "true";
  if (!enabled) return { enabled: false, issue: null };
  if (!String(env.STRIPE_SECRET_KEY ?? "").trim()) {
    return { enabled: true, issue: "STRIPE_SECRET_KEY is required when Stripe billing is enabled." };
  }
  if (!String(env.STRIPE_WEBHOOK_SECRET ?? "").trim()) {
    return { enabled: true, issue: "STRIPE_WEBHOOK_SECRET is required when Stripe billing is enabled." };
  }

  return { enabled: true, issue: null };
}

export function isStripeBillingEnabled(env = {}) {
  const configuredFlag = String(env.STRIPE_ENABLED ?? "").trim().toLowerCase();
  return configuredFlag === "true";
}

export function isStripeBillingConfigured(env = {}) {
  const policy = inspectStripeBillingPolicy(env);
  return policy.enabled && policy.issue === null;
}
