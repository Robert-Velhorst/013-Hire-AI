import { describe, expect, it } from "vitest";
import {
  buildPrivacyCleanupConfirmation,
  canExecutePrivacyCleanup,
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
});
