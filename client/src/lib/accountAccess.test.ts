import { describe, expect, it } from "vitest";
import { accountRestriction } from "./accountAccess";

describe("account access", () => {
  it("allows active accounts", () => {
    expect(accountRestriction("active")).toBeNull();
  });

  it("distinguishes pending and suspended account restrictions", () => {
    expect(accountRestriction("pending")).toBe("pending");
    expect(accountRestriction("suspended")).toBe("suspended");
  });

  it("fails closed for an unknown authenticated account state", () => {
    expect(accountRestriction("legacy-disabled")).toBe("suspended");
    expect(accountRestriction(null)).toBe("suspended");
    expect(accountRestriction(undefined)).toBe("suspended");
  });
});
