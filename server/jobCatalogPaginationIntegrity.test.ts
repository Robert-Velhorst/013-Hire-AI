import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public job catalog pagination integrity", () => {
  it("uses a bounded stable cursor in storage and the public router", () => {
    const db = source("server/db.ts");
    const router = source("server/routers.ts");

    expect(db).toContain("export async function getActiveJobPage");
    expect(db).toContain("desc(jobs.postedDate), desc(jobs.createdAt), desc(jobs.id)");
    expect(db).toContain(".limit(limit + 1)");
    expect(router).toContain("listPage: publicProcedure");
    expect(router).toContain("const jobCatalogPageSize = z.number().int().min(1).max(100)");
  });

  it("loads bounded pages in Job Search and bounds dependent decision reads", () => {
    const page = source("client/src/pages/JobSearch.tsx");

    expect(page).toContain("trpc.jobs.listPage.useInfiniteQuery");
    expect(page).toContain("{ limit: 50, filters: serverJobSearchFilters }");
    expect(page).toContain("window.setTimeout(() => setServerJobSearchFilters(jobSearchFilters), 250)");
    expect(page).toContain("window.clearTimeout(timer)");
    expect(page).toContain("const renderJobCard = (job: any, showMatchScore = true)");
    expect(page).not.toContain("const JobCard =");
    expect(page).toContain("job.matchScore != null");
    expect(page).toContain('aria-label={t("openJobDetails"');
    expect(page).toContain('aria-label={t("saveJobForReview"');
    expect(page).toContain("page.items");
    expect(page).toContain("Load more jobs");
    expect(page).not.toContain("limit: 250");
    expect(page).toContain("visibleJobIds.slice(index, index + 250)");
    expect(page).toContain("index += 250");
    expect(page).toContain("trpc.useQueries");
  });
});
