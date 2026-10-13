import { describe, expect, it } from "vitest";
import {
  getCurrentOAuthIdentityDigest,
  getOAuthIdentityDigests,
  getOAuthIdentityLockName,
} from "./erasedOAuthIdentity";

describe("erased OAuth identity protection", () => {
  it("uses stable keyed, non-reversible hashes scoped to the Hire.AI identity", () => {
    const openId = "oauth-subject-fixture";
    const first = getOAuthIdentityDigests(openId);
    expect(first).toEqual(getOAuthIdentityDigests(openId));
    expect(first[0].identityHash).not.toContain(openId);
    expect(getOAuthIdentityDigests(`${openId}-other`)[0].identityHash).not.toBe(
      first[0].identityHash
    );
    expect(getCurrentOAuthIdentityDigest(openId)).toEqual(first.at(-1));
  });

  it("provides a stable bounded MySQL lock identity without exposing the subject", () => {
    const lockName = getOAuthIdentityLockName("private-oauth-subject");
    expect(lockName).toBe(getOAuthIdentityLockName("private-oauth-subject"));
    expect(lockName).toHaveLength(64);
    expect(lockName).not.toContain("private-oauth-subject");
  });
});
