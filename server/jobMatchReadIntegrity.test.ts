import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("bounded job-match reads", () => {
  it("enforces owner and requested job IDs at the database boundary", () => {
    const database = source("server/db.ts");
    const operation = database.slice(
      database.indexOf("export async function getUserJobMatchesForJobs"),
      database.indexOf("// Decision Makers")
    );

    expect(operation).toContain("eq(jobMatches.userId, userId)");
    expect(operation).toContain("inArray(jobMatches.jobId");
    expect(operation).toContain("requestedJobIds.filter");
  });

  it("exposes only the bounded route to interactive clients", () => {
    const router = source("server/routers.ts");
    const matchingRouter = router.slice(
      router.indexOf("matching: router({"),
      router.indexOf("// AI-Powered Features")
    );

    expect(matchingRouter).toContain("getMatchesForJobs: protectedProcedure");
    expect(matchingRouter).toContain("jobIds: z.array(z.number().int().positive()).max(250)");
    expect(matchingRouter).not.toContain("getMatches: protectedProcedure");
  });

  it("aligns match reads with loaded catalog chunks", () => {
    const page = source("client/src/pages/JobSearch.tsx");

    expect(page).toContain("queries.matching.getMatchesForJobs");
    expect(page).toContain("visibleJobIdChunks.map");
    expect(page).not.toContain("matching.getMatches.useQuery");
  });
});
