import { describe, expect, it } from "vitest";
import {
  buildPrivacyCleanupConfirmation,
  buildPrivacyDatabaseConfirmation,
  canExecutePrivacyCleanup,
  canFinalizePrivacyErasure,
} from "./privacyErasureControl";

describe("privacy erasure execution control", () => {
  it("requires exact run-specific confirmation in a retryable cleanup state", () => {
    const confirmation = buildPrivacyCleanupConfirmation(42, "2026-08-09.v1");
    expect(confirmation).toBe("CLEAN UP USER 42 USING 2026-08-09.v1");
    expect(
      canExecutePrivacyCleanup({
        status: "planned",
        confirmation,
        userId: 42,
        policyVersion: "2026-08-09.v1",
      })
    ).toBe(true);
    expect(
      canExecutePrivacyCleanup({
        status: "ready_for_database",
        confirmation,
        userId: 42,
        policyVersion: "2026-08-09.v1",
      })
    ).toBe(false);
    expect(
      canExecutePrivacyCleanup({
        status: "planned",
        confirmation: "CLEAN UP USER 41 USING 2026-08-09.v1",
        userId: 42,
        policyVersion: "2026-08-09.v1",
      })
    ).toBe(false);
  });

  it("requires database-ready state and exact finalization confirmation", () => {
    const confirmation = buildPrivacyDatabaseConfirmation(42, "2026-08-09.v1");
    expect(confirmation).toBe("ERASE DATABASE USER 42 USING 2026-08-09.v1");
    expect(
      canFinalizePrivacyErasure({
        status: "ready_for_database",
        confirmation,
        userId: 42,
        policyVersion: "2026-08-09.v1",
      })
    ).toBe(true);
    expect(
      canFinalizePrivacyErasure({
        status: "cleanup_in_progress",
        confirmation,
        userId: 42,
        policyVersion: "2026-08-09.v1",
      })
    ).toBe(false);
    expect(
      canFinalizePrivacyErasure({
        status: "ready_for_database",
        confirmation: "wrong",
        userId: 42,
        policyVersion: "2026-08-09.v1",
      })
    ).toBe(false);
  });
});
