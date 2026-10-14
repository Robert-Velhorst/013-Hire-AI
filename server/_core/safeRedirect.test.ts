import { describe, expect, it } from "vitest";
import { getSafeRedirectPath } from "./safeRedirect";

describe("safe same-origin redirects", () => {
  it.each(["/dashboard", "/dashboard?tab=applications", "/profile#resume"])(
    "preserves safe local path %s",
    value => {
      expect(getSafeRedirectPath(value, "/dashboard")).toBe(value);
    }
  );

  it.each([
    "https://attacker.example/",
    "//attacker.example/",
    "/\\attacker.example/",
    "/dashboard\\@attacker.example/",
    "/dashboard\r\nLocation: https://attacker.example/",
  ])("uses the fallback for unsafe path %s", value => {
    expect(getSafeRedirectPath(value, "/dashboard")).toBe("/dashboard");
  });
});
