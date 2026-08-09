export type OperationalFailureSignal = {
  scope: string;
  operation: string;
  count: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
};

const MAX_FAILURE_BUCKETS = 100;
const processStartedAt = new Date().toISOString();
const failureSignals = new Map<string, OperationalFailureSignal>();

const knownFailureSignals = new Set([
  "AIMatching\u0000Decision-maker analysis",
  "AIMatching\u0000Interview preparation",
  "CareerIntelligence\u0000Salary analysis",
  "CareerIntelligence\u0000Culture analysis",
  "CareerIntelligence\u0000Networking strategy",
  "CareerIntelligence\u0000Career plan",
  "CareerIntelligence\u0000Skill-gap analysis",
  "Database\u0000Connection initialization",
  "Database\u0000User upsert",
  "DiversitySupport\u0000Company D&I analysis",
  "DiversitySupport\u0000Visa sponsorship analysis",
  "DiversitySupport\u0000Accommodation recommendations",
  "DiversitySupport\u0000Relocation analysis",
  "Discovery\u0000Job polling",
  "Discovery\u0000Subscriber notification",
  "ResumeStorage\u0000Download URL retrieval",
  "ResumeParser\u0000PDF extraction",
  "ResumeParser\u0000DOCX extraction",
  "ResumeParser\u0000Resume parsing",
  "Stripe Webhook\u0000Signature verification",
  "Stripe Webhook\u0000Event processing",
  "SocialConnections\u0000LinkedIn analysis",
  "SocialConnections\u0000GitHub analysis",
  "SocialConnections\u0000Portfolio analysis",
  "DevAuth\u0000Development session creation",
  "DevAuth\u0000Review queue session creation",
  "DevAuth\u0000Admin session creation",
  "Server\u0000Shutdown",
  "Server\u0000Startup",
  "OAuth\u0000Callback",
  "Auth\u0000Session verification",
  "Auth\u0000OAuth user synchronization",
]);

function normalizeLabel(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9 ._:/-]/g, "?").trim().slice(0, 80);
  return normalized || "Unknown";
}

function recordOperationalFailure(scope: string, operation: string, occurredAt = new Date()): void {
  const normalizedScope = normalizeLabel(scope);
  const normalizedOperation = normalizeLabel(operation);
  const requestedKey = `${normalizedScope}\u0000${normalizedOperation}`;
  const isKnown = knownFailureSignals.has(requestedKey);
  const safeScope = isKnown ? normalizedScope : "Runtime";
  const safeOperation = isKnown ? normalizedOperation : "Unclassified failure";
  const key = `${safeScope}\u0000${safeOperation}`;
  const timestamp = occurredAt.toISOString();
  const existing = failureSignals.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastOccurredAt = timestamp;
    return;
  }
  if (failureSignals.size >= MAX_FAILURE_BUCKETS) {
    const overflowKey = "Runtime\u0000Other bounded failures";
    const overflow = failureSignals.get(overflowKey);
    if (overflow) {
      overflow.count += 1;
      overflow.lastOccurredAt = timestamp;
    }
    return;
  }
  failureSignals.set(key, {
    scope: safeScope,
    operation: safeOperation,
    count: 1,
    firstOccurredAt: timestamp,
    lastOccurredAt: timestamp,
  });
}

export function getOperationalFailureSnapshot(limit = 20) {
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const signals = Array.from(failureSignals.values())
    .sort((left, right) => right.lastOccurredAt.localeCompare(left.lastOccurredAt))
    .slice(0, boundedLimit)
    .map((signal) => ({ ...signal }));
  return {
    processStartedAt,
    totalFailures: Array.from(failureSignals.values())
      .reduce((total, signal) => total + signal.count, 0),
    uniqueSignals: failureSignals.size,
    signals,
  };
}

export function clearOperationalFailuresForTests(): void {
  failureSignals.clear();
}

/** Emits a fixed marker and bounded metric without accepting an error object. */
export function logOperationalFailure(scope: string, operation: string): void {
  const requestedKey = `${normalizeLabel(scope)}\u0000${normalizeLabel(operation)}`;
  const isKnown = knownFailureSignals.has(requestedKey);
  const safeScope = isKnown ? normalizeLabel(scope) : "Runtime";
  const safeOperation = isKnown ? normalizeLabel(operation) : "Unclassified failure";
  recordOperationalFailure(safeScope, safeOperation);
  console.error(`[${safeScope}] ${safeOperation} failed.`);
}
