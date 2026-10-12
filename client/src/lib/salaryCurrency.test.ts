import { describe, expect, it } from "vitest";
import { areSalaryCurrenciesComparable, normalizeSalaryCurrency } from "@shared/salaryCurrency";

describe("salary currency normalization", () => {
  it("preserves unknown values instead of defaulting them to USD", () => {
    expect(normalizeSalaryCurrency()).toBeNull();
    expect(normalizeSalaryCurrency("not-a-currency")).toBeNull();
    expect(normalizeSalaryCurrency("ZZZ")).toBeNull();
    expect(normalizeSalaryCurrency("eur")).toBe("EUR");
  });

  it("requires two known matching currencies before comparing salary amounts", () => {
    expect(areSalaryCurrenciesComparable("USD", "USD")).toBe(true);
    expect(areSalaryCurrenciesComparable("EUR", "USD")).toBe(false);
    expect(areSalaryCurrenciesComparable(null, "USD")).toBe(false);
    expect(areSalaryCurrenciesComparable("ZZZ", "ZZZ")).toBe(false);
  });
});
