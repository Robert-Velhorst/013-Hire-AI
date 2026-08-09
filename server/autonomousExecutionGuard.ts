export class AutonomousExecutionGuard {
  private failureMessage: string | null = null;

  constructor(private readonly signal?: AbortSignal) {}

  markLeaseLost(message = "The autonomous run lost its execution lease."): void {
    this.failureMessage = message;
  }

  assertLeaseActive(): void {
    if (this.signal?.aborted) {
      throw new Error("The autonomous run was cancelled.");
    }
    if (this.failureMessage) {
      throw new Error(this.failureMessage);
    }
  }
}
