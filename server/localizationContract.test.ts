import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, resolveSupportedLocale, SUPPORTED_LOCALES } from "@shared/localization";

describe("localization contract", () => {
  it("normalizes supported regional browser locales", () => {
    expect(resolveSupportedLocale("nl-NL")).toBe("nl");
    expect(resolveSupportedLocale("EN_us")).toBe("en");
    expect(SUPPORTED_LOCALES).toEqual(["en", "nl"]);
  });

  it("fails safely to English for missing or unsupported locales", () => {
    expect(resolveSupportedLocale("fr-FR")).toBe(DEFAULT_LOCALE);
    expect(resolveSupportedLocale(null)).toBe(DEFAULT_LOCALE);
  });
});
