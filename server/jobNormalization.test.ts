import { describe, expect, it } from "vitest";
import { normalizeExperienceLevel, normalizeJob, normalizeLocation, normalizeSalary } from "./jobNormalization";

describe("job normalization", () => {
  it("keeps explicit CAD and AUD compensation distinct from generic dollar salaries", () => {
    expect(normalizeSalary("CAD $100k - $120k per year")).toMatchObject({
      currency: "CAD",
      min: 100000,
      max: 120000,
      period: "yearly",
    });
    expect(normalizeSalary("A$85k - A$95k")).toMatchObject({
      currency: "AUD",
      min: 85000,
      max: 95000,
    });
  });

  it("keeps missing and unsupported salary currencies unknown", () => {
    expect(normalizeSalary("60,000 - 75,000 annually")).toMatchObject({
      currency: null,
      min: 60000,
      max: 75000,
    });
    expect(normalizeSalary("ZZZ 60,000 - 75,000 annually").currency).toBeNull();
    expect(normalizeSalary("JPY 6,000,000 annually").currency).toBe("JPY");
  });

  it("parses international thousands separators before downstream fit scoring", () => {
    expect(normalizeSalary("EUR 60.000 - 75.000 annually")).toMatchObject({
      currency: "EUR",
      min: 60000,
      max: 75000,
      period: "yearly",
      normalizedYearly: { min: 60000, max: 75000 },
    });
    expect(normalizeSalary("EUR 1.234,50 - 1.500,75 monthly")).toMatchObject({
      currency: "EUR",
      min: 1234.5,
      max: 1500.75,
      period: "monthly",
      normalizedYearly: { min: 14814, max: 18009 },
    });
    expect(normalizeJob({
      title: "Platform Engineer",
      company: "Example Co",
      salary: "EUR 60 000 - 75 000",
    }).salary).toMatchObject({ min: 60000, max: 75000, currency: "EUR" });
  });

  it("keeps unknown geography distinct from remote and worldwide evidence", () => {
    expect(normalizeLocation(undefined)).toMatchObject({
      country: "Unknown",
      region: "Unknown",
      isRemote: false,
      remoteType: "unknown",
    });
    expect(normalizeLocation("Berlin")).toMatchObject({
      country: "Unknown",
      region: "Unknown",
      isRemote: false,
    });
    expect(normalizeLocation("Remote - Berlin")).toMatchObject({
      country: "Unknown",
      region: "Unknown",
      isRemote: true,
    });
  });

  it("recognizes complete country names without treating city text as a country code", () => {
    expect(normalizeLocation("Remote - Berlin, Germany")).toMatchObject({
      country: "Germany",
      region: "Europe",
      isRemote: true,
    });
    expect(normalizeLocation("Remote - Canada")).toMatchObject({
      country: "Canada",
      region: "North America",
      isRemote: true,
    });
    expect(normalizeLocation("Remote - Berlin")).toMatchObject({
      country: "Unknown",
      region: "Unknown",
      isRemote: true,
    });
  });

  it("classifies internships and new-graduate roles as entry-level", () => {
    expect(normalizeExperienceLevel("Software Engineering Internship")).toBe("entry");
    expect(normalizeExperienceLevel("New Grad Product Designer")).toBe("entry");
  });
});
