import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeInstanceId } from "./runtimeInstance";

describe("launcher-provided runtime identity", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("publishes the exact per-launch identity without case normalization", () => {
    const id = "AbCdEf0123456789_abcdEF0123456789-";
    vi.stubEnv("HIRE_AI_RUNTIME_INSTANCE_ID", id);
    expect(createRuntimeInstanceId()).toBe(id);
  });

  it.each(["", "short", "a".repeat(129), "a".repeat(31) + "/", "a".repeat(32) + "\n"])(
    "rejects malformed launch identity %j without echoing it", id => {
      vi.stubEnv("HIRE_AI_RUNTIME_INSTANCE_ID", id);
      expect(() => createRuntimeInstanceId()).toThrow(
        "Invalid runtime launch identity."
      );
    }
  );

  it("keeps direct Node starts independent when no launcher identity is supplied", () => {
    vi.stubEnv("HIRE_AI_RUNTIME_INSTANCE_ID", undefined);
    expect(createRuntimeInstanceId()).not.toBe(createRuntimeInstanceId());
  });
});
