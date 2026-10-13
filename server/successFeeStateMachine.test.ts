import { describe, expect, it } from "vitest";
import {
  assertSuccessFeeTransition,
  canTransitionSuccessFeeStatus,
  deriveEffectiveSuccessFeeStatus,
} from "./successFeeStateMachine";

describe("success-fee state machine", () => {
  it("allows payment recovery while preventing ended fees from resuming", () => {
    expect(canTransitionSuccessFeeStatus("suspended", "active")).toBe(true);
    expect(canTransitionSuccessFeeStatus("ended", "active")).toBe(false);
    expect(() => assertSuccessFeeTransition("ended", "active")).toThrow("Invalid success-fee transition");
  });

  it("derives effective status from independent holds without losing lifecycle state", () => {
    expect(deriveEffectiveSuccessFeeStatus("active", [])).toBe("active");
    expect(deriveEffectiveSuccessFeeStatus("active", ["payment"])).toBe("suspended");
    expect(deriveEffectiveSuccessFeeStatus("active", ["payment", "account"])).toBe("suspended");
    expect(deriveEffectiveSuccessFeeStatus("active", ["payment", "legal"])).toBe("disputed");
    expect(deriveEffectiveSuccessFeeStatus("paused", ["payment"])).toBe("suspended");
    expect(deriveEffectiveSuccessFeeStatus("pending_verification", [])).toBe("pending_verification");
    expect(deriveEffectiveSuccessFeeStatus("ended", ["payment", "legal"])).toBe("ended");
  });
});
