import { afterEach, describe, expect, it } from "vitest";
import { searchJobs, searchTerm } from "./db";
import { sampleJobs } from "./sampleData";

const injectedJobIds: number[] = [];

afterEach(() => {
  for (const id of injectedJobIds.splice(0)) {
    const index = sampleJobs.findIndex((job) => job.id === id);
    if (index >= 0) sampleJobs.splice(index, 1);
  }
});

describe("job search availability", () => {
  it("escapes SQL LIKE metacharacters including the escape character", () => {
    expect(searchTerm(String.raw`50%_off\role`)).toBe(
      String.raw`%50\%\_off\\role%`
    );
  });

  it("does not return an expired listing that otherwise matches the query", async () => {
    const expiredJob = {
      ...sampleJobs[0],
      id: 989901,
      externalId: "expired-search-regression",
      title: "Expired Search Regression Engineer",
      company: "Expired Search Co",
      expiryDate: new Date(Date.now() - 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sampleJobs.push(expiredJob);
    injectedJobIds.push(expiredJob.id);

    const results = await searchJobs({ title: "Expired Search Regression" });

    expect(results.some((job) => job.id === expiredJob.id)).toBe(false);
  });

  it("does not return a no-expiry listing that its source has not re-observed", async () => {
    const staleJob = {
      ...sampleJobs[0],
      id: 989902,
      externalId: "stale-search-regression",
      title: "Stale Search Regression Engineer",
      company: "Stale Search Co",
      expiryDate: null,
      createdAt: new Date(Date.now() - 16 * 86400000),
      updatedAt: new Date(Date.now() - 15 * 86400000),
    };
    sampleJobs.push(staleJob);
    injectedJobIds.push(staleJob.id);

    const results = await searchJobs({ title: "Stale Search Regression" });

    expect(results.some((job) => job.id === staleJob.id)).toBe(false);
  });
});
