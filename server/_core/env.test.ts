import { describe, expect, it } from "vitest";
import {
  isOptionalBoundedIntegerValue,
  isValidJwtSecret,
  readBooleanFeatureFlag,
  readBoundedIntegerValue,
  resolveProductionRuntime,
} from "./env";

describe("runtime mode resolution", () => {
  it("uses explicit runtime modes when they are present", () => {
    expect(resolveProductionRuntime("production", "file:///workspace/server/_core/env.ts")).toBe(true);
    expect(resolveProductionRuntime("development", "file:///workspace/dist/index.js")).toBe(false);
    expect(resolveProductionRuntime("test", "file:///workspace/dist/index.js")).toBe(false);
  });

  it("treats the bundled server entry point as production when NODE_ENV is absent", () => {
    expect(resolveProductionRuntime(undefined, "file:///workspace/dist/index.js")).toBe(true);
    expect(resolveProductionRuntime(undefined, "file:///workspace/server/_core/env.ts")).toBe(false);
  });
});

describe("readBooleanFeatureFlag", () => {
  it("uses the supplied default when a feature flag is not configured", () => {
    expect(readBooleanFeatureFlag(undefined, true)).toBe(true);
    expect(readBooleanFeatureFlag("", false)).toBe(false);
  });

  it("accepts explicit case-insensitive true and false overrides", () => {
    expect(readBooleanFeatureFlag(" TrUe ", false)).toBe(true);
    expect(readBooleanFeatureFlag(" FALSE ", true)).toBe(false);
  });

  it("does not turn malformed configuration into an accidental enablement", () => {
    expect(readBooleanFeatureFlag("enabled", false)).toBe(false);
  });
});

describe("readBoundedIntegerValue", () => {
  it("uses a safe fallback for absent or malformed values", () => {
    expect(readBoundedIntegerValue(undefined, 10, 1, 50)).toBe(10);
    expect(readBoundedIntegerValue("many", 10, 1, 50)).toBe(10);
    expect(readBoundedIntegerValue("12connections", 10, 1, 50)).toBe(10);
  });

  it("clamps deployment resource settings to their supported range", () => {
    expect(readBoundedIntegerValue("0", 10, 1, 50)).toBe(1);
    expect(readBoundedIntegerValue("500", 10, 1, 50)).toBe(50);
    expect(readBoundedIntegerValue("12", 10, 1, 50)).toBe(12);
  });
});

describe("isOptionalBoundedIntegerValue", () => {
  it("accepts an omitted override or an integer inside the supported range", () => {
    expect(isOptionalBoundedIntegerValue(undefined, 900_000, 2_592_000_000)).toBe(true);
    expect(isOptionalBoundedIntegerValue("", 900_000, 2_592_000_000)).toBe(true);
    expect(isOptionalBoundedIntegerValue("604800000", 900_000, 2_592_000_000)).toBe(true);
  });

  it("rejects malformed, fractional, and out-of-range security overrides", () => {
    expect(isOptionalBoundedIntegerValue("one week", 900_000, 2_592_000_000)).toBe(false);
    expect(isOptionalBoundedIntegerValue("900000.5", 900_000, 2_592_000_000)).toBe(false);
    expect(isOptionalBoundedIntegerValue("899999", 900_000, 2_592_000_000)).toBe(false);
    expect(isOptionalBoundedIntegerValue("2592000001", 900_000, 2_592_000_000)).toBe(false);
  });
});

describe("isValidJwtSecret", () => {
  it("accepts a bounded non-placeholder signing secret", () => {
    expect(isValidJwtSecret("f4wR9x2Qm7Kp3Vn8Yt6Hs1Lc5Jd0ZaEu")).toBe(true);
  });

  it.each([
    "short-secret",
    "replace-with-a-long-random-secret",
    "hire-ai-local-dev-cookie-secret",
    ` ${"a".repeat(32)}`,
    `${"a".repeat(32)}\n`,
    "a".repeat(4_097),
  ])("rejects unsafe signing secret configuration", (value) => {
    expect(isValidJwtSecret(value)).toBe(false);
  });
});
