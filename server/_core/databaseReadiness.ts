export type DatabaseReadinessProbe = {
  check(): Promise<boolean>;
};

type DatabaseReadinessProbeOptions = {
  probe: () => Promise<void>;
  timeoutMs?: number;
  successTtlMs?: number;
  failureTtlMs?: number;
  now?: () => number;
};

function deadline(timeoutMs: number): Promise<false> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });
}

/**
 * Keep readiness cheap under polling load: callers share one bounded probe and
 * consume a short-lived result instead of opening a query per request.
 */
export function createDatabaseReadinessProbe(
  options: DatabaseReadinessProbeOptions,
): DatabaseReadinessProbe {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const successTtlMs = options.successTtlMs ?? 5_000;
  const failureTtlMs = options.failureTtlMs ?? 1_000;
  const now = options.now ?? Date.now;
  let cached: { available: boolean; expiresAt: number } | null = null;
  let inFlight: Promise<boolean> | null = null;
  let activeProbe: Promise<boolean> | null = null;

  return {
    async check() {
      if (cached && cached.expiresAt > now()) return cached.available;
      if (inFlight) return inFlight;
      // A caller deadline must not release ownership of a database operation
      // that may still be consuming a pool connection.
      if (activeProbe) return false;

      const attemptedProbe = Promise.resolve()
        .then(options.probe)
        .then(() => true, () => false);
      activeProbe = attemptedProbe;
      void attemptedProbe.then((available) => {
        if (activeProbe !== attemptedProbe) return;
        cached = {
          available,
          expiresAt: now() + (available ? successTtlMs : failureTtlMs),
        };
        activeProbe = null;
      });
      const boundedProbe = Promise.race([attemptedProbe, deadline(timeoutMs)]);
      inFlight = boundedProbe
        .then((available) => {
          cached = {
            available,
            expiresAt: now() + (available ? successTtlMs : failureTtlMs),
          };
          return available;
        })
        .finally(() => {
          inFlight = null;
        });

      return inFlight;
    },
  };
}
