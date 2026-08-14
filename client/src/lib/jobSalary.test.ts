import { describe, expect, it } from "vitest";
import { formatJobSalary } from "./jobSalary";

describe("job salary formatting", () => {
  it("keeps the source currency visible for an international range", () => {
    const formatted = formatJobSalary(60000, 75000, "eur");
    expect(formatted).toContain("EUR");
    expect(formatted).toContain("60K");
    expect(formatted).toContain("75K");
  });

  it("uses USD only when the source did not provide a valid currency", () => {
    expect(formatJobSalary(120000, null, null)).toContain("USD");
    expect(formatJobSalary(null, 90000, "not-a-currency")).toContain("USD");
  });

  it("does not render compensation when neither bound exists", () => {
    expect(formatJobSalary()).toBe("Not specified");
  });

  it("uses the selected locale for salary language and number formatting", () => {
    expect(formatJobSalary(null, 90000, "eur", "nl-NL")).toContain("Tot");
    expect(formatJobSalary(undefined, undefined, undefined, "nl-NL")).toBe("Niet opgegeven");
  });
});
