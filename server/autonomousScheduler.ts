import { getProfilesWithAutonomousPreferences } from "./db";
import { getAutonomousScanIntervalMs, parseAutonomousPreferences } from "./autonomousOrchestrator";
import { AUTONOMOUS_RUN_FAILURE, runScheduledAutonomousForUser } from "./autonomousService";

const AUTONOMOUS_SCHEDULER_FAILURE = "Autonomous scheduler cycle could not complete.";
const AUTONOMOUS_PROFILE_PAGE_SIZE = 100;
const AUTONOMOUS_MAX_CONCURRENT_USERS = 3;

async function processWithConcurrency<T>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal
) {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    async () => {
      while (nextIndex < items.length && !signal?.aborted) {
        const item = items[nextIndex];
        nextIndex += 1;
        await worker(item);
      }
    }
  );
  const results = await Promise.allSettled(workers);
  const failedWorker = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failedWorker) throw failedWorker.reason;
}

interface AutonomousSchedulerStatus {
  isStarted: boolean;
  isRunning: boolean;
  lastCycleAt: Date | null;
  nextCycleAt: Date | null;
  enrolledUsers: number;
  usersRun: number;
  jobsQueued: number;
  followUpDraftsQueued: number;
  duplicateFollowUpsSkipped: number;
  resumeEvidenceBlockedActions: number;
  profileReadinessBlockedActions: number;
  evidenceGatedActions: number;
  emptySourceActionsSkipped: number;
  userDecisionLockedJobs: number;
  inboxProvidersScanned: number;
  inboxReauthorizationRequired: number;
  inboxCandidatesDiscovered: number;
  inboxMonitoringFailures: number;
  failedActions: number;
  errors: string[];
}

interface AutonomousUserRunStatus {
  lastRunAt: Date;
  jobsQueued: number;
  followUpDraftsQueued: number;
  duplicateFollowUpsSkipped: number;
  resumeEvidenceBlockedActions: number;
  profileReadinessBlockedActions: number;
  evidenceGatedActions: number;
  emptySourceActionsSkipped: number;
  userDecisionLockedJobs: number;
  inboxProvidersScanned: number;
  inboxReauthorizationRequired: number;
  inboxCandidatesDiscovered: number;
  inboxMonitoringFailures: number;
  failedActions: number;
  errorCount: number;
}

export class AutonomousScheduler {
  private readonly tickMs = 5 * 60 * 1000;
  private intervalId: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;
  private activeCycleController: AbortController | null = null;
  private readonly userRunStatuses = new Map<number, AutonomousUserRunStatus>();
  private status: AutonomousSchedulerStatus = {
    isStarted: false,
    isRunning: false,
    lastCycleAt: null,
    nextCycleAt: null,
    enrolledUsers: 0,
    usersRun: 0,
    jobsQueued: 0,
    followUpDraftsQueued: 0,
    duplicateFollowUpsSkipped: 0,
    resumeEvidenceBlockedActions: 0,
    profileReadinessBlockedActions: 0,
    evidenceGatedActions: 0,
    emptySourceActionsSkipped: 0,
    userDecisionLockedJobs: 0,
    inboxProvidersScanned: 0,
    inboxReauthorizationRequired: 0,
    inboxCandidatesDiscovered: 0,
    inboxMonitoringFailures: 0,
    failedActions: 0,
    errors: [],
  };

  start() {
    if (this.intervalId) return;
    if (this.activeCycleController?.signal.aborted) return;

    this.status.isStarted = true;
    this.scheduleCycle();
    this.intervalId = setInterval(() => this.scheduleCycle(), this.tickMs);
    this.status.nextCycleAt = new Date(Date.now() + this.tickMs);
    console.log("[AutonomousScheduler] Started");
  }

  async stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.status.isStarted = false;
    this.status.nextCycleAt = null;
    this.activeCycleController?.abort();
    await this.activeCycle;
  }

  private scheduleCycle() {
    if (this.activeCycle) return;

    const controller = new AbortController();
    this.activeCycleController = controller;
    let cycle: Promise<void>;
    cycle = this.runDueUsers(controller.signal).finally(() => {
      if (this.activeCycle === cycle) {
        this.activeCycle = null;
        this.activeCycleController = null;
      }
    });
    this.activeCycle = cycle;
  }

  async runDueUsers(signal?: AbortSignal) {
    if (this.status.isRunning) return;

    this.status.isRunning = true;
    this.status.errors = [];
    this.status.usersRun = 0;
    this.status.jobsQueued = 0;
    this.status.followUpDraftsQueued = 0;
    this.status.duplicateFollowUpsSkipped = 0;
    this.status.resumeEvidenceBlockedActions = 0;
    this.status.profileReadinessBlockedActions = 0;
    this.status.evidenceGatedActions = 0;
    this.status.emptySourceActionsSkipped = 0;
    this.status.userDecisionLockedJobs = 0;
    this.status.inboxProvidersScanned = 0;
    this.status.inboxReauthorizationRequired = 0;
    this.status.inboxCandidatesDiscovered = 0;
    this.status.inboxMonitoringFailures = 0;
    this.status.failedActions = 0;
    try {
      this.status.enrolledUsers = 0;
      let afterUserId = 0;
      while (!signal?.aborted) {
        const profiles = await getProfilesWithAutonomousPreferences(afterUserId, AUTONOMOUS_PROFILE_PAGE_SIZE);
        if (signal?.aborted) break;
        this.status.enrolledUsers += profiles.length;
        await processWithConcurrency(profiles, AUTONOMOUS_MAX_CONCURRENT_USERS, async (profile) => {
          if (signal?.aborted) return;
          const preferences = parseAutonomousPreferences(profile.preferences);
          if (!preferences.autonomousEnabled) return;
          const frequency = preferences.scanFrequency || "daily";
          const interval = getAutonomousScanIntervalMs(frequency);

          try {
            const result = await runScheduledAutonomousForUser(profile.userId, interval, signal);
            if (signal?.aborted) return;
            if (result) {
              const jobsQueued =
                result.queuedApplicationRecords +
                result.queuedReviewRecords +
                result.queuedManualRecords;
              this.status.usersRun += 1;
              this.status.jobsQueued += jobsQueued;
              this.status.followUpDraftsQueued += result.queuedFollowUps;
              this.status.duplicateFollowUpsSkipped += result.skippedDuplicateFollowUps;
              this.status.resumeEvidenceBlockedActions += result.skippedResumeEvidenceActions || 0;
              this.status.profileReadinessBlockedActions += result.skippedProfileReadinessActions || 0;
              this.status.evidenceGatedActions += result.skippedEvidenceGatedActions;
              this.status.emptySourceActionsSkipped += result.skippedEmptySourceActions || 0;
              this.status.userDecisionLockedJobs += result.userDecisionLockedJobs || 0;
              this.status.inboxProvidersScanned += result.inboxProvidersScanned || 0;
              this.status.inboxReauthorizationRequired += result.inboxReauthorizationRequired || 0;
              this.status.inboxCandidatesDiscovered += result.inboxCandidatesDiscovered || 0;
              this.status.inboxMonitoringFailures += result.inboxMonitoringFailures || 0;
              this.status.failedActions += result.failedActions;
              this.userRunStatuses.set(profile.userId, {
                lastRunAt: new Date(),
                jobsQueued,
                followUpDraftsQueued: result.queuedFollowUps,
                duplicateFollowUpsSkipped: result.skippedDuplicateFollowUps,
                resumeEvidenceBlockedActions: result.skippedResumeEvidenceActions || 0,
                profileReadinessBlockedActions: result.skippedProfileReadinessActions || 0,
                evidenceGatedActions: result.skippedEvidenceGatedActions,
                emptySourceActionsSkipped: result.skippedEmptySourceActions || 0,
                userDecisionLockedJobs: result.userDecisionLockedJobs || 0,
                inboxProvidersScanned: result.inboxProvidersScanned || 0,
                inboxReauthorizationRequired: result.inboxReauthorizationRequired || 0,
                inboxCandidatesDiscovered: result.inboxCandidatesDiscovered || 0,
                inboxMonitoringFailures: result.inboxMonitoringFailures || 0,
                failedActions: result.failedActions,
                errorCount: result.failedActions,
              });
              if (result.failedActions > 0) {
                this.status.errors.push(
                  `User ${profile.userId}: ${result.failedActions} autonomous action${result.failedActions === 1 ? "" : "s"} failed`
                );
              }
            }
          } catch {
            if (signal?.aborted) return;
            this.userRunStatuses.set(profile.userId, {
              lastRunAt: new Date(),
              jobsQueued: 0,
              followUpDraftsQueued: 0,
              duplicateFollowUpsSkipped: 0,
              resumeEvidenceBlockedActions: 0,
              profileReadinessBlockedActions: 0,
              evidenceGatedActions: 0,
              emptySourceActionsSkipped: 0,
              userDecisionLockedJobs: 0,
              inboxProvidersScanned: 0,
              inboxReauthorizationRequired: 0,
              inboxCandidatesDiscovered: 0,
              inboxMonitoringFailures: 0,
              failedActions: 0,
              errorCount: 1,
            });
            this.status.errors.push(`User ${profile.userId}: ${AUTONOMOUS_RUN_FAILURE}`);
          }
        }, signal);
        if (signal?.aborted) break;
        if (profiles.length < AUTONOMOUS_PROFILE_PAGE_SIZE) break;
        const nextUserId = profiles[profiles.length - 1]?.userId ?? afterUserId;
        if (nextUserId <= afterUserId) throw new Error("Autonomous profile pagination did not advance.");
        afterUserId = nextUserId;
      }
    } catch {
      this.status.errors.push(AUTONOMOUS_SCHEDULER_FAILURE);
    } finally {
      this.status.isRunning = false;
      this.status.lastCycleAt = new Date();
      this.status.nextCycleAt = this.intervalId ? new Date(Date.now() + this.tickMs) : null;
    }
  }

  getStatus(): AutonomousSchedulerStatus {
    return { ...this.status, errors: [...this.status.errors] };
  }

  getUserStatus(userId: number): AutonomousUserRunStatus | null {
    const status = this.userRunStatuses.get(userId);
    return status ? { ...status } : null;
  }
}

const autonomousScheduler = new AutonomousScheduler();

export function getAutonomousScheduler() {
  return autonomousScheduler;
}
