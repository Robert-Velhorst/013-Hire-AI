import { describe, expect, it } from "vitest";
import {
  acquireJobDiscoveryLease,
  releaseJobDiscoveryLease,
  renewJobDiscoveryLease,
} from "./db";

describe("job discovery lease", () => {
  it("enforces ownership for acquisition, renewal, and release", async () => {
    expect(await acquireJobDiscoveryLease("discovery-owner-a")).toBe(true);
    expect(await acquireJobDiscoveryLease("discovery-owner-b")).toBe(false);
    expect(await renewJobDiscoveryLease("discovery-owner-b")).toBe(false);
    expect(await releaseJobDiscoveryLease("discovery-owner-b", true)).toBe(false);
    expect(await renewJobDiscoveryLease("discovery-owner-a")).toBe(true);
    expect(await releaseJobDiscoveryLease("discovery-owner-a", true)).toBe(true);
    expect(await acquireJobDiscoveryLease("discovery-owner-b")).toBe(true);
    expect(await releaseJobDiscoveryLease("discovery-owner-b")).toBe(true);
  });
});
