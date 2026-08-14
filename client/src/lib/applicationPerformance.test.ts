import { describe, expect, it } from "vitest";
import { getApplicationPerformanceSummary } from "./applicationPerformance";

describe("application performance summary", () => {
  it("derives rates and explanatory copy from confirmed ledger counts", () => {
    const summary = getApplicationPerformanceSummary({
      confirmedSubmissions: 3,
      recordedResponseSignals: 2,
      recordedInterviews: 1,
    });

    expect(summary.responseRate).toBe(67);
    expect(summary.interviewRate).toBe(33);
    expect(summary.responseDetail).toBe("2 applications with a recorded response or status signal from 3 confirmed submissions");
    expect(summary.interviewDetail).toBe("1 scheduled interview from 3 confirmed submissions");
  });

  it("does not imply performance when no submission is confirmed", () => {
    const summary = getApplicationPerformanceSummary({
      recordedResponseSignals: 1,
      recordedInterviews: 1,
    });

    expect(summary.responseRate).toBe(0);
    expect(summary.interviewRate).toBe(0);
    expect(summary.responseDetail).toBe("No confirmed submissions yet");
    expect(summary.interviewDetail).toBe("No confirmed submissions yet");
  });

  it("keeps displayed percentages bounded when one application has multiple signals", () => {
    const summary = getApplicationPerformanceSummary({
      confirmedSubmissions: 1,
      recordedResponseSignals: 2,
      recordedInterviews: 3,
    });

    expect(summary.responseRate).toBe(100);
    expect(summary.interviewRate).toBe(100);
  });

  it("localizes evidence details for Dutch accounts", () => {
    const summary = getApplicationPerformanceSummary({
      confirmedSubmissions: 2,
      recordedResponseSignals: 1,
      recordedInterviews: 1,
    }, "nl-NL");

    expect(summary.responseDetail).toContain("vastgelegde reactie");
    expect(summary.interviewDetail).toContain("gepland gesprek");
  });
});
