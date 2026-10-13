import { describe, expect, it } from "vitest";
import {
  countActiveJobSearchFilters,
  defaultJobSearchFilters,
  filterJobListings,
} from "./jobSearchFilters";

const jobs = [
  {
    id: 1,
    title: "Senior Full Stack Engineer",
    company: "Northstar",
    description: "Build remote TypeScript products.",
    requirements: "5+ years React and TypeScript",
    location: "Remote - Worldwide",
    jobType: "full-time",
    platformId: 1,
    salaryMin: 120000,
    salaryMax: 160000,
    salaryCurrency: "USD",
    applicationProcess: "greenhouse",
    visaSponsorshipAvailable: 1,
    openHiringSupport: 1,
    diversityFriendly: 1,
    postedDate: new Date("2026-07-09T12:00:00.000Z"),
  },
  {
    id: 2,
    title: "Junior Frontend Engineer",
    company: "Studio",
    description: "React and accessibility work.",
    requirements: "2+ years CSS",
    location: "Remote - US Only",
    jobType: "full-time",
    platformId: 2,
    salaryMin: 70000,
    salaryMax: 95000,
    applicationProcess: "lever",
    visaSponsorshipAvailable: 0,
    openHiringSupport: 0,
    diversityFriendly: 1,
    postedDate: new Date("2026-06-01T12:00:00.000Z"),
  },
  {
    id: 3,
    title: "Staff Platform Engineer",
    company: "Office Only",
    description: "Kubernetes platform work.",
    requirements: "8+ years infrastructure experience",
    location: "Amsterdam, Netherlands",
    jobType: "contract",
    platformId: 3,
    salaryMin: null,
    salaryMax: null,
    applicationProcess: "workday",
    visaSponsorshipAvailable: 1,
    openHiringSupport: 0,
    diversityFriendly: 0,
    postedDate: new Date("2026-07-08T12:00:00.000Z"),
  },
];

describe("job search filters", () => {
  it("keeps jobs whose salary range overlaps the target range", () => {
    const result = filterJobListings(jobs, {
      ...defaultJobSearchFilters,
      remoteOnly: false,
      salaryRange: [100000, 140000],
      salaryCurrency: "USD",
    }, new Date("2026-07-10T12:00:00.000Z"));

    expect(result.map((job) => job.id)).toEqual([1]);
  });

  it("combines evidence, ATS, recency, and experience filters", () => {
    const result = filterJobListings(jobs, {
      ...defaultJobSearchFilters,
      visaSponsorshipOnly: true,
      openHiringSupportOnly: true,
      diversityFriendlyOnly: true,
      applicationProcess: "greenhouse",
      experienceLevel: "senior",
      postedWithin: "3",
    }, new Date("2026-07-10T12:00:00.000Z"));

    expect(result.map((job) => job.id)).toEqual([1]);
  });

  it("keeps a role that declares remote eligibility outside its location field", () => {
    const result = filterJobListings([
      ...jobs,
      {
        id: 4,
        title: "Backend Engineer",
        company: "Distributed Systems",
        description: "This is a fully remote role for candidates worldwide.",
        requirements: "4+ years Node.js",
        location: "Amsterdam, Netherlands",
        jobType: "full-time",
        platformId: 4,
        salaryMin: 100000,
        salaryMax: 140000,
        applicationProcess: "other",
        postedDate: new Date("2026-07-09T12:00:00.000Z"),
      },
    ], defaultJobSearchFilters, new Date("2026-07-10T12:00:00.000Z"));

    expect(result.map((job) => job.id)).toContain(4);
  });

  it("keeps a listing with no remote evidence out of the remote-only results", () => {
    const result = filterJobListings([
      ...jobs,
      {
        id: 6,
        title: "Platform Engineer",
        company: "Unknown Work Mode",
        description: "Build reliable services.",
        requirements: "TypeScript experience",
        location: null,
        jobType: "full-time",
        platformId: 6,
      },
    ], defaultJobSearchFilters);

    expect(result.map((job) => job.id)).not.toContain(6);
  });

  it("excludes hybrid listings even when their text also mentions remote work", () => {
    const result = filterJobListings([
      ...jobs,
      {
        id: 5,
        title: "Senior Product Engineer",
        company: "Hybrid Works",
        description: "Work remotely three days a week in our hybrid operating model.",
        location: "Hybrid - Amsterdam, Netherlands",
        jobType: "full-time",
        platformId: 5,
        salaryMin: 110000,
        salaryMax: 140000,
        applicationProcess: "other",
        postedDate: new Date("2026-07-09T12:00:00.000Z"),
      },
    ], defaultJobSearchFilters, new Date("2026-07-10T12:00:00.000Z"));

    expect(result.map((job) => job.id)).not.toContain(5);
  });

  it("does not treat unknown salary as a failed range unless disclosure is required", () => {
    const included = filterJobListings(jobs, {
      ...defaultJobSearchFilters,
      remoteOnly: false,
      salaryRange: [100000, 140000],
      salaryCurrency: "USD",
    }, new Date("2026-07-10T12:00:00.000Z"));
    const disclosedOnly = filterJobListings(jobs, {
      ...defaultJobSearchFilters,
      remoteOnly: false,
      salaryRange: [100000, 140000],
      salaryCurrency: "USD",
      salaryDisclosedOnly: true,
    }, new Date("2026-07-10T12:00:00.000Z"));

    expect(included.map((job) => job.id)).not.toContain(3);
    expect(disclosedOnly.map((job) => job.id)).not.toContain(3);
  });

  it("counts only filters that differ from the safe defaults", () => {
    expect(countActiveJobSearchFilters(defaultJobSearchFilters)).toBe(0);
    expect(countActiveJobSearchFilters({
      ...defaultJobSearchFilters,
      remoteOnly: false,
      postedWithin: "7",
    })).toBe(2);
  });

  it("matches any requested location while keeping remote eligibility separate", () => {
    const result = filterJobListings(jobs, {
      ...defaultJobSearchFilters,
      remoteOnly: false,
      location: "Netherlands, US Only",
    });

    expect(result.map((job) => job.id)).toEqual([2, 3]);
  });

  it("does not apply the default salary bounds until a salary filter is active", () => {
    const result = filterJobListings([
      ...jobs,
      {
        ...jobs[0],
        id: 4,
        title: "Principal Platform Engineer",
        salaryMin: 320000,
        salaryMax: 400000,
      },
    ], defaultJobSearchFilters);

    expect(result.map((job) => job.id)).toContain(4);
  });

  it("only applies a numeric range to roles in the selected currency", () => {
    const result = filterJobListings([
      ...jobs,
      {
        ...jobs[0],
        id: 4,
        salaryMin: 70000,
        salaryMax: 90000,
        salaryCurrency: "EUR",
      },
    ], {
      ...defaultJobSearchFilters,
      remoteOnly: false,
      salaryCurrency: "EUR",
      salaryRange: [65000, 80000],
    });

    expect(result.map((job) => job.id)).toEqual([4]);
  });

  it("does not treat an unknown listing currency as the selected currency", () => {
    const result = filterJobListings([
      { ...jobs[0], id: 4, salaryCurrency: null },
      { ...jobs[0], id: 5, salaryCurrency: "ZZZ" },
      { ...jobs[0], id: 6, salaryCurrency: "USD" },
    ], {
      ...defaultJobSearchFilters,
      remoteOnly: false,
      salaryCurrency: "USD",
    });

    expect(result.map((job) => job.id)).toEqual([6]);
  });

  it("hides explicit payment and forwarding signals from discovery", () => {
    const result = filterJobListings([
      ...jobs,
      {
        ...jobs[0],
        id: 4,
        description: "Deposit a company check and transfer the remaining funds after keeping your fee.",
      },
    ], {
      ...defaultJobSearchFilters,
      remoteOnly: false,
      listingSafety: "all",
    });

    expect(result.map((job) => job.id)).not.toContain(4);
  });

  it("lets a user switch from clear listings to ambiguous listings that need review", () => {
    const reviewJob = {
      ...jobs[0],
      id: 4,
      applicationEmail: "talent.example@gmail.com",
    };
    const clear = filterJobListings([reviewJob], {
      ...defaultJobSearchFilters,
      remoteOnly: false,
    });
    const review = filterJobListings([reviewJob], {
      ...defaultJobSearchFilters,
      remoteOnly: false,
      listingSafety: "review",
    });

    expect(clear).toHaveLength(0);
    expect(review.map((job) => job.id)).toEqual([4]);
  });
});
