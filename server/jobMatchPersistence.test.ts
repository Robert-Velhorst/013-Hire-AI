import { describe, expect, it } from "vitest";
import { createJobMatch, getUserJobMatches, getUserJobMatchesForJobs } from "./db";

describe("job match persistence", () => {
  it("updates one current match record for each user and job", async () => {
    const userId = 991001;
    const jobId = 1;

    const firstWrite = await createJobMatch({
      userId,
      jobId,
      matchScore: 62,
      matchReasons: "Initial profile match",
      skillsMatch: 50,
      experienceMatch: 60,
      locationMatch: 80,
      salaryMatch: 70,
    });
    const recalculation = await createJobMatch({
      userId,
      jobId,
      matchScore: 88,
      matchReasons: "Updated profile evidence improves the match",
      skillsMatch: 90,
      experienceMatch: 85,
      locationMatch: 80,
      salaryMatch: 95,
    });

    const matches = await getUserJobMatches(userId, 0);

    expect(recalculation).toMatchObject({ insertId: firstWrite.insertId, existing: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      userId,
      jobId,
      matchScore: 88,
      matchReasons: "Updated profile evidence improves the match",
      skillsMatch: 90,
      experienceMatch: 85,
      locationMatch: 80,
      salaryMatch: 95,
    });
    expect(matches[0].updatedAt).toBeInstanceOf(Date);
  });

  it("filters the current records by the requested threshold", async () => {
    const userId = 991002;
    await createJobMatch({ userId, jobId: 2, matchScore: 44 });
    await createJobMatch({ userId, jobId: 3, matchScore: 78 });

    const matches = await getUserJobMatches(userId, 70);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ jobId: 3, matchScore: 78 });
  });

  it("persists a match for a duplicate listing under its canonical job", async () => {
    const userId = 991003;
    await createJobMatch({ userId, jobId: 5, matchScore: 81 });

    const matches = await getUserJobMatches(userId, 0);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ jobId: 1, matchScore: 81 });
  });

  it("returns only requested matches owned by the current user", async () => {
    const userId = 991004;
    const otherUserId = 991005;
    await createJobMatch({ userId, jobId: 1, matchScore: 83 });
    await createJobMatch({ userId, jobId: 2, matchScore: 76 });
    await createJobMatch({ otherUserId, jobId: 1, matchScore: 99 });

    const matches = await getUserJobMatchesForJobs(userId, [1, 1, -1, 999_999]);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ userId, jobId: 1, matchScore: 83 });
  });
});
