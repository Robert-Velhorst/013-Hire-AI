import { afterEach, describe, expect, it } from "vitest";
import { getActiveJobPage, getActiveJobs } from "./db";
import { sampleJobs } from "./sampleData";

const injectedJobIds: number[] = [];

afterEach(() => {
  for (const id of injectedJobIds.splice(0)) {
    const index = sampleJobs.findIndex((job) => job.id === id);
    if (index >= 0) sampleJobs.splice(index, 1);
  }
});

describe("canonical job list filters", () => {
  it("pages the public catalog without repeating cursor rows", async () => {
    const first = await getActiveJobPage({ limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await getActiveJobPage({ limit: 1, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
  });

  it("filters canonical jobs before pagination in the memory runtime", async () => {
    const jobs = await getActiveJobs(250, 0, {
      visaSponsorshipOnly: true,
      applicationProcess: "greenhouse",
    });

    expect(jobs.map((job) => job.id)).toEqual([1]);
  });

  it("keeps disclosed salary ranges that overlap the requested range", async () => {
    const matchingRanges = await getActiveJobs(250, 0, {
      remoteOnly: false,
      salaryRange: [100000, 140000],
    });
    const outsideRange = await getActiveJobs(250, 0, {
      remoteOnly: false,
      salaryRange: [175000, 200000],
    });

    expect(matchingRanges.map((job) => job.id)).toContain(3);
    expect(outsideRange.map((job) => job.id)).toContain(4);
    expect(outsideRange.map((job) => job.id)).not.toContain(3);
  });

  it("does not treat default salary bounds as an implicit maximum", async () => {
    const highSalaryJob = {
      ...sampleJobs[0],
      id: 989906,
      externalId: "high-salary-default-filter-regression",
      title: "High Salary Default Filter Regression Engineer",
      company: "Compensation Co",
      salaryMin: 325000,
      salaryMax: 390000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sampleJobs.push(highSalaryJob);
    injectedJobIds.push(highSalaryJob.id);

    const jobs = await getActiveJobs(250, 0, { query: "High Salary Default Filter" });

    expect(jobs.some((job) => job.id === highSalaryJob.id)).toBe(true);
  });

  it("filters canonical listings by a comma-separated location selection", async () => {
    const jobs = await getActiveJobs(250, 0, {
      remoteOnly: false,
      location: "Europe, US Only",
    });

    expect(jobs.map((job) => job.id)).toEqual(expect.arrayContaining([2, 3]));
    expect(jobs.map((job) => job.id)).not.toContain(1);
  });

  it("excludes no-expiry listings that are no longer observed by their source", async () => {
    const staleJob = {
      ...sampleJobs[0],
      id: 989903,
      externalId: "stale-list-regression",
      title: "Stale List Regression Engineer",
      company: "Stale List Co",
      expiryDate: null,
      createdAt: new Date(Date.now() - 16 * 86400000),
      updatedAt: new Date(Date.now() - 15 * 86400000),
    };
    sampleJobs.push(staleJob);
    injectedJobIds.push(staleJob.id);

    const jobs = await getActiveJobs(250, 0, { query: "Stale List Regression" });

    expect(jobs.some((job) => job.id === staleJob.id)).toBe(false);
  });

  it("excludes hybrid roles from the default remote-only discovery result", async () => {
    const hybridJob = {
      ...sampleJobs[0],
      id: 989905,
      externalId: "hybrid-list-regression",
      title: "Hybrid List Regression Engineer",
      company: "Hybrid List Co",
      description: "A remote-friendly hybrid role with two office days each week.",
      location: "Hybrid - Amsterdam, Netherlands",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sampleJobs.push(hybridJob);
    injectedJobIds.push(hybridJob.id);

    const jobs = await getActiveJobs(250, 0, { query: "Hybrid List Regression" });

    expect(jobs.some((job) => job.id === hybridJob.id)).toBe(false);
  });

  it("keeps a recently discovered listing without a provider posting date in a posted window", async () => {
    const recentlyDiscoveredJob = {
      ...sampleJobs[0],
      id: 989904,
      externalId: "undated-list-regression",
      title: "Undated List Regression Engineer",
      company: "Undated List Co",
      postedDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sampleJobs.push(recentlyDiscoveredJob);
    injectedJobIds.push(recentlyDiscoveredJob.id);

    const jobs = await getActiveJobs(250, 0, {
      query: "Undated List Regression",
      postedWithin: "1",
    });

    expect(jobs.some((job) => job.id === recentlyDiscoveredJob.id)).toBe(true);
  });
});
