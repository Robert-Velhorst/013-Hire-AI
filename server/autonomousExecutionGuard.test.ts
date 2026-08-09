import { describe, expect, it } from "vitest";
import { AutonomousExecutionGuard } from "./autonomousExecutionGuard";

describe("AutonomousExecutionGuard", () => {
  it("allows actions while the lease is active", () => {
    const guard = new AutonomousExecutionGuard();
    expect(() => guard.assertLeaseActive()).not.toThrow();
  });

  it("blocks subsequent actions after lease ownership is lost", () => {
    const guard = new AutonomousExecutionGuard();
    guard.markLeaseLost("Lease renewal failed.");
    expect(() => guard.assertLeaseActive()).toThrow("Lease renewal failed.");
  });

  it("blocks subsequent actions when the owning scheduler is cancelled", () => {
    const controller = new AbortController();
    const guard = new AutonomousExecutionGuard(controller.signal);
    controller.abort();

    expect(() => guard.assertLeaseActive()).toThrow("autonomous run was cancelled");
  });
});
