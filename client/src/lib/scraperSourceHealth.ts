export type ScraperSourceOutcome = "success" | "empty" | "partial" | "failed" | "awaiting";

export interface ScraperSourceHealthInput {
  lastScrapeStatus?: "success" | "partial" | "failed" | null;
  lastScrapeJobCount?: number | null;
  lastScrapeError?: string | null;
  lastScrapeAttemptedAt?: Date | string | null;
  lastScraped?: Date | string | null;
}

export interface ScraperSourceHealthSummary {
  outcome: ScraperSourceOutcome;
  tone: string;
  jobCount: number | null;
  error: string | null;
  isFresh: boolean;
}

export interface ScraperSourceOutcomeCounts {
  success: number;
  empty: number;
  partial: number;
  failed: number;
  awaiting: number;
  issues: number;
  freshSuccess: number;
  freshEmpty: number;
  freshPartial: number;
  freshFailed: number;
  freshIssues: number;
  staleOutcomes: number;
}

function nonNegativeInteger(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : null;
}

function parseDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasFreshOutcome(source: ScraperSourceHealthInput, now: Date) {
  const attemptedAt = parseDate(source.lastScrapeAttemptedAt ?? source.lastScraped);
  return Boolean(attemptedAt && attemptedAt >= new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/**
 * The scraper ledger stores source-run evidence separately from the last
 * successful timestamp. This keeps the admin view from treating legacy or
 * failed state as proof that a source is healthy.
 */
export function getScraperSourceHealthSummary(
  source: ScraperSourceHealthInput,
  now = new Date()
): ScraperSourceHealthSummary {
  const jobCount = nonNegativeInteger(source.lastScrapeJobCount);
  const error = source.lastScrapeError?.trim() || null;
  const isFresh = hasFreshOutcome(source, now);

  switch (source.lastScrapeStatus) {
    case "success":
      if (jobCount === 0) {
        return {
          outcome: "empty",
          tone: "border-amber-500/30 text-amber-300",
          jobCount,
          error: null,
          isFresh,
        };
      }
      return {
        outcome: "success",
        tone: "border-emerald-500/30 text-emerald-300",
        jobCount,
        error: null,
        isFresh,
      };
    case "partial":
      return {
        outcome: "partial",
        tone: "border-amber-500/30 text-amber-300",
        jobCount,
        error,
        isFresh,
      };
    case "failed":
      return {
        outcome: "failed",
        tone: "border-red-500/30 text-red-300",
        jobCount,
        error,
        isFresh,
      };
    default:
      return {
        outcome: "awaiting",
        tone: "border-slate-600 text-slate-400",
        jobCount: null,
        error: null,
        isFresh: false,
      };
  }
}

export function getScraperSourceOutcomeCounts(
  sources: ScraperSourceHealthInput[] | null | undefined,
  now = new Date()
): ScraperSourceOutcomeCounts {
  const counts: ScraperSourceOutcomeCounts = {
    success: 0,
    empty: 0,
    partial: 0,
    failed: 0,
    awaiting: 0,
    issues: 0,
    freshSuccess: 0,
    freshEmpty: 0,
    freshPartial: 0,
    freshFailed: 0,
    freshIssues: 0,
    staleOutcomes: 0,
  };

  for (const source of sources || []) {
    const summary = getScraperSourceHealthSummary(source, now);
    const { outcome } = summary;
    counts[outcome] += 1;
    if (outcome === "awaiting") continue;
    if (!summary.isFresh) {
      counts.staleOutcomes += 1;
      continue;
    }
    if (outcome === "success") counts.freshSuccess += 1;
    if (outcome === "empty") counts.freshEmpty += 1;
    if (outcome === "partial") counts.freshPartial += 1;
    if (outcome === "failed") counts.freshFailed += 1;
  }
  counts.issues = counts.empty + counts.partial + counts.failed;
  counts.freshIssues = counts.freshEmpty + counts.freshPartial + counts.freshFailed;
  return counts;
}
