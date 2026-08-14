import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const jobSearch = readFileSync(resolve(process.cwd(), "client/src/pages/JobSearch.tsx"), "utf8");

describe("job search listing-date rendering", () => {
  it("uses the canonical listing date helper instead of the obsolete postedAt field", () => {
    expect(jobSearch).toContain("getJobListingDate(job)");
    expect(jobSearch).not.toContain("job.postedAt");
    expect(jobSearch).toMatch(
      /listingDate\.source\s*===\s*"posted"\s*\?\s*t\("listingPosted"\)\s*:\s*t\("listingDiscovered"\)/
    );
    expect(jobSearch).toContain("listingDate.date.toLocaleDateString(locale)");
  });
});
