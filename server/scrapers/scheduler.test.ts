import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getScraperManager: vi.fn(),
  runScrapingCycle: vi.fn(),
  processJobAlerts: vi.fn(),
}));

vi.mock("./scraperManager", () => ({
  getScraperManager: mocks.getScraperManager,
}));

vi.mock("../applicationFeatures", () => ({
  processJobAlerts: mocks.processJobAlerts,
}));

import { getScheduler, JobScrapingScheduler } from "./scheduler";

describe("job scraping scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getScraperManager.mockResolvedValue({ runScrapingCycle: mocks.runScrapingCycle });
    mocks.runScrapingCycle.mockResolvedValue({
      totalSaved: 3,
      platformResults: {
        RemoteOK: { errors: [] },
        "We Work Remotely": { errors: ["Rate limited"] },
      },
    });
    mocks.processJobAlerts.mockResolvedValue({ processed: 0, externalNotifications: 0 });
  });

  it("records a partial cycle when one source reports an error", async () => {
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });

    await scheduler.runScraping();

    expect(mocks.runScrapingCycle).toHaveBeenCalledWith({
      limit: 25,
      signal: expect.any(AbortSignal),
    });
    expect(scheduler.getStatus()).toMatchObject({
      isStarted: false,
      isRunning: false,
      intervalMinutes: 60,
      maxJobsPerRun: 25,
      totalJobsScraped: 3,
      totalRunsCompleted: 1,
      totalSuccessfulRuns: 0,
      totalPartialRuns: 1,
      totalFailedRuns: 0,
      lastRunOutcome: "partial",
      lastJobAlertsProcessed: 0,
      jobAlertRefreshFailed: false,
      errors: ["We Work Remotely: Source scan could not complete."],
    });
    expect(mocks.processJobAlerts).toHaveBeenCalledTimes(1);
  });

  it("refreshes internal job-alert matches after a completed scrape without sending job-match notifications", async () => {
    mocks.processJobAlerts.mockResolvedValueOnce({ processed: 2, externalNotifications: 0 });
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });

    await scheduler.runScraping();

    expect(mocks.processJobAlerts).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus()).toMatchObject({
      lastJobAlertsProcessed: 2,
      jobAlertRefreshFailed: false,
    });
  });

  it("keeps a completed scrape available when internal alert refresh fails", async () => {
    mocks.processJobAlerts.mockRejectedValueOnce(new Error("Bearer provider-secret"));
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });

    await scheduler.runScraping();

    expect(scheduler.getStatus()).toMatchObject({
      totalRunsCompleted: 1,
      lastRunOutcome: "partial",
      lastJobAlertsProcessed: 0,
      jobAlertRefreshFailed: true,
    });
    expect(scheduler.getStatus().errors).toContain("Job alerts: refresh could not complete.");
    expect(JSON.stringify(scheduler.getStatus().errors)).not.toContain("provider-secret");
  });

  it("records a clean cycle only when every source succeeds", async () => {
    mocks.runScrapingCycle.mockResolvedValueOnce({
      totalSaved: 4,
      platformResults: {
        RemoteOK: { errors: [] },
        Remotive: { errors: [] },
      },
    });
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });

    await scheduler.runScraping();

    expect(scheduler.getStatus()).toMatchObject({
      totalRunsCompleted: 1,
      totalSuccessfulRuns: 1,
      totalPartialRuns: 0,
      totalFailedRuns: 0,
      lastRunOutcome: "success",
      errors: [],
    });
  });

  it("records a failed cycle when every requested source fails", async () => {
    mocks.runScrapingCycle.mockResolvedValueOnce({
      totalSaved: 0,
      platformResults: {
        RemoteOK: { errors: ["HTTP 429"] },
        Remotive: { errors: ["HTTP 503"] },
      },
    });
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });

    await scheduler.runScraping();

    expect(scheduler.getStatus()).toMatchObject({
      totalRunsCompleted: 1,
      totalSuccessfulRuns: 0,
      totalPartialRuns: 0,
      totalFailedRuns: 1,
      lastRunOutcome: "failed",
    });
  });

  it("does not expose source or worker failure text in scheduler status", async () => {
    mocks.runScrapingCycle.mockResolvedValueOnce({
      totalSaved: 0,
      platformResults: {
        RemoteOK: { errors: ["Bearer provider-secret"] },
      },
    });
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });

    await scheduler.runScraping();

    expect(scheduler.getStatus().errors).toEqual([
      "RemoteOK: Source scan could not complete.",
    ]);
    expect(JSON.stringify(scheduler.getStatus())).not.toContain("provider-secret");

    mocks.runScrapingCycle.mockRejectedValueOnce(new Error("Bearer worker-secret"));
    await scheduler.runScraping();

    expect(scheduler.getStatus().errors).toEqual(["Scraping run could not complete."]);
    expect(JSON.stringify(scheduler.getStatus())).not.toContain("worker-secret");
    expect(scheduler.getStatus()).toMatchObject({
      totalRunsCompleted: 2,
      totalFailedRuns: 2,
    });
  });

  it("passes an explicit platform allowlist to a discovery run", async () => {
    const scheduler = new JobScrapingScheduler({
      intervalMinutes: 60,
      maxJobsPerRun: 25,
      enabledPlatforms: ["RemoteOK", "Remotive"],
    });

    await scheduler.runScraping();

    expect(mocks.runScrapingCycle).toHaveBeenCalledWith({
      limit: 25,
      platformNames: ["RemoteOK", "Remotive"],
      signal: expect.any(AbortSignal),
    });
    expect(scheduler.getStatus().enabledPlatforms).toEqual(["RemoteOK", "Remotive"]);
  });

  it("reports start and stop state for deployment health checks", async () => {
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });

    scheduler.start();
    expect(scheduler.getStatus().isStarted).toBe(true);

    await scheduler.stop();
    expect(scheduler.getStatus()).toMatchObject({ isStarted: false, nextRunAt: null });
  });

  it("applies a revised runtime configuration before the next discovery run", () => {
    const scheduler = new JobScrapingScheduler({
      intervalMinutes: 60,
      maxJobsPerRun: 25,
      enabledPlatforms: ["RemoteOK"],
    });

    scheduler.updateConfig({
      intervalMinutes: 120,
      maxJobsPerRun: 80,
      enabledPlatforms: null,
    });

    expect(scheduler.getStatus()).toMatchObject({
      intervalMinutes: 120,
      maxJobsPerRun: 80,
      isStarted: false,
      enabledPlatforms: null,
    });
  });

  it("updates an existing scheduler singleton with operator configuration", () => {
    const initial = getScheduler({
      intervalMinutes: 30,
      maxJobsPerRun: 40,
      enabledPlatforms: ["RemoteOK"],
    });
    const updated = getScheduler({ maxJobsPerRun: 75 });

    expect(updated).toBe(initial);
    expect(updated.getStatus()).toMatchObject({
      intervalMinutes: 30,
      maxJobsPerRun: 75,
      enabledPlatforms: ["RemoteOK"],
    });
  });

  it("waits for an active cycle before completing shutdown", async () => {
    let releaseCycle!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseCycle = resolve;
    });
    mocks.runScrapingCycle.mockImplementationOnce(async () => {
      await gate;
      return { totalSaved: 0, platformResults: { RemoteOK: { errors: [] } } };
    });
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });
    scheduler.start();
    await vi.waitFor(() => expect(mocks.runScrapingCycle).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(scheduler.getStatus().isStarted).toBe(false);

    releaseCycle();
    await stopping;
    expect(stopped).toBe(true);
    expect(scheduler.getStatus()).toMatchObject({ isRunning: false, nextRunAt: null });
  });

  it("aborts the active discovery cycle during shutdown", async () => {
    mocks.runScrapingCycle.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new Error("cancelled");
    });
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });
    scheduler.start();
    await vi.waitFor(() => expect(mocks.runScrapingCycle).toHaveBeenCalledTimes(1));

    await scheduler.stop();

    const options = mocks.runScrapingCycle.mock.calls[0]?.[0] as { signal: AbortSignal };
    expect(options.signal.aborted).toBe(true);
    expect(mocks.processJobAlerts).not.toHaveBeenCalled();
    expect(scheduler.getStatus()).toMatchObject({
      isStarted: false,
      isRunning: false,
      totalRunsCompleted: 1,
      totalFailedRuns: 1,
      lastRunOutcome: "failed",
    });
  });

  it("joins an active cycle instead of reporting a second manual run", async () => {
    let releaseCycle!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseCycle = resolve;
    });
    mocks.runScrapingCycle.mockImplementationOnce(async () => {
      await gate;
      return { totalSaved: 0, platformResults: { RemoteOK: { errors: [] } } };
    });
    const scheduler = new JobScrapingScheduler({ intervalMinutes: 60, maxJobsPerRun: 25 });
    const first = scheduler.runScraping();
    await vi.waitFor(() => expect(mocks.runScrapingCycle).toHaveBeenCalledTimes(1));
    const joined = scheduler.runScraping();
    await Promise.resolve();

    expect(mocks.runScrapingCycle).toHaveBeenCalledTimes(1);
    releaseCycle();
    await Promise.all([first, joined]);
    expect(scheduler.getStatus().totalRunsCompleted).toBe(1);
  });
});
