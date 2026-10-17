import { describe, expect, it } from "vitest";
import { isEmploymentSearchOnHold } from "@shared/employmentSearchControl.mjs";

describe("employment search hold policy", () => {
  it("fails closed for a persisted employment hold", () => {
    expect(isEmploymentSearchOnHold('{"autonomousEnabled":false,"employmentSearchHold":true}')).toBe(true);
    expect(isEmploymentSearchOnHold({ autonomousEnabled: true, employmentSearchHold: true })).toBe(true);
  });

  it("does not pause ordinary or malformed preferences", () => {
    expect(isEmploymentSearchOnHold('{"autonomousEnabled":true}')).toBe(false);
    expect(isEmploymentSearchOnHold("not-json")).toBe(false);
    expect(isEmploymentSearchOnHold(null)).toBe(false);
  });
});
