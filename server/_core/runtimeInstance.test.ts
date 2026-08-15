import { describe, expect, it } from "vitest";
import { createRuntimeInstanceId } from "./runtimeInstance";

describe("runtime instance identity", () => {
  it("creates opaque per-process identifiers suitable for tunnel binding", () => {
    const first = createRuntimeInstanceId();
    const second = createRuntimeInstanceId();

    expect(first).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(first).not.toBe(second);
  });
});
