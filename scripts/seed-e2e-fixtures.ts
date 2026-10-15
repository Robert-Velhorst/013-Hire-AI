import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { jobPlatforms, jobs } from "../drizzle/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the isolated browser fixtures.");

const pool = mysql.createPool(databaseUrl);
const db = drizzle(pool);
const fixtureJobs = [
  {
    id: 1,
    externalId: "hire-ai-e2e-1",
    title: "Hire.AI E2E Remote Product Engineer",
    location: "Remote - Worldwide",
    applicationUrl: "https://example.com/e2e-application/1",
  },
  {
    id: 2,
    externalId: "hire-ai-e2e-2",
    title: "Hire.AI E2E Remote Data Analyst",
    location: "Remote - Europe",
    applicationUrl: "https://example.com/e2e-application/2",
  },
  {
    id: 3,
    externalId: "hire-ai-e2e-3",
    title: "Hire.AI E2E Remote Support Specialist",
    location: "Remote - Worldwide",
    applicationUrl: "https://example.com/e2e-application/3",
  },
  {
    id: 4,
    externalId: "hire-ai-e2e-4",
    title: "Hire.AI E2E Remote Operations Coordinator",
    location: "Remote - Europe",
    applicationUrl: "https://example.com/e2e-application/4",
  },
] as const;

try {
  const [platform] = await db
    .select({ id: jobPlatforms.id })
    .from(jobPlatforms)
    .where(eq(jobPlatforms.name, "RemoteOK"))
    .limit(1);
  if (!platform) throw new Error("The local server did not initialize the RemoteOK test platform.");

  const existingRows = await db
    .select({ id: jobs.id, externalId: jobs.externalId })
    .from(jobs)
    .orderBy(asc(jobs.id));

  if (existingRows.length === 0) {
    for (const fixture of fixtureJobs) {
      await db.insert(jobs).values({
        id: fixture.id,
        externalId: fixture.externalId,
        title: fixture.title,
        company: "Hire.AI E2E Fixture Employer",
        description: "Synthetic browser-test vacancy. This is not a real job or employer.",
        requirements: "Synthetic test data only.",
        location: fixture.location,
        jobType: "full-time",
        salaryMin: 80_000,
        salaryMax: 100_000,
        salaryCurrency: "USD",
        skills: "communication, analysis, planning",
        applicationUrl: fixture.applicationUrl,
        applicationProcess: "other",
        platformId: platform.id,
        sourceUrl: "https://example.com/e2e-source",
        postedDate: new Date(Date.now() - fixture.id * 60_000),
        isActive: 1,
      });
    }
  } else {
    const matchesFixture =
      existingRows.length === fixtureJobs.length &&
      fixtureJobs.every((fixture, index) =>
        existingRows[index]?.id === fixture.id && existingRows[index]?.externalId === fixture.externalId
      );
    if (!matchesFixture) {
      throw new Error("The hire_ai_e2e database contains non-fixture jobs; use a fresh dedicated test database.");
    }
  }
} finally {
  await pool.end();
}
