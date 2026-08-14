export interface ApplicationPerformanceInput {
  confirmedSubmissions?: number | null;
  recordedResponseSignals?: number | null;
  recordedInterviews?: number | null;
}

export interface ApplicationPerformanceSummary {
  confirmedSubmissions: number;
  recordedResponseSignals: number;
  recordedInterviews: number;
  responseRate: number;
  interviewRate: number;
  responseDetail: string;
  interviewDetail: string;
}

function nonNegativeCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function percentage(numerator: number, denominator: number) {
  if (denominator === 0) return 0;
  return Math.min(100, Math.round((numerator / denominator) * 100));
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Keeps dashboard performance language tied to recorded operating-ledger
 * signals instead of unsupported benchmark comparisons.
 */
export function getApplicationPerformanceSummary(
  input: ApplicationPerformanceInput,
  locale = "en",
): ApplicationPerformanceSummary {
  const confirmedSubmissions = nonNegativeCount(input.confirmedSubmissions);
  const recordedResponseSignals = nonNegativeCount(input.recordedResponseSignals);
  const recordedInterviews = nonNegativeCount(input.recordedInterviews);

  const isDutch = locale.toLowerCase().startsWith("nl");
  const noSubmissions = isDutch ? "Nog geen bevestigde sollicitaties" : "No confirmed submissions yet";
  const responseDetail = isDutch
    ? `${recordedResponseSignals} ${recordedResponseSignals === 1 ? "sollicitatie" : "sollicitaties"} met een vastgelegde reactie of statussignaal uit ${confirmedSubmissions} bevestigde ${confirmedSubmissions === 1 ? "sollicitatie" : "sollicitaties"}`
    : `${pluralize(recordedResponseSignals, "application")} with a recorded response or status signal from ${pluralize(confirmedSubmissions, "confirmed submission")}`;
  const interviewDetail = isDutch
    ? `${recordedInterviews} ${recordedInterviews === 1 ? "gepland gesprek" : "geplande gesprekken"} uit ${confirmedSubmissions} bevestigde ${confirmedSubmissions === 1 ? "sollicitatie" : "sollicitaties"}`
    : `${pluralize(recordedInterviews, "scheduled interview")} from ${pluralize(confirmedSubmissions, "confirmed submission")}`;

  return {
    confirmedSubmissions,
    recordedResponseSignals,
    recordedInterviews,
    responseRate: percentage(recordedResponseSignals, confirmedSubmissions),
    interviewRate: percentage(recordedInterviews, confirmedSubmissions),
    responseDetail: confirmedSubmissions === 0 ? noSubmissions : responseDetail,
    interviewDetail: confirmedSubmissions === 0 ? noSubmissions : interviewDetail,
  };
}
