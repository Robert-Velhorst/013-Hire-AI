import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("interview history pagination wiring", () => {
  it("pages closed history without replacing the complete internal lifecycle reader", () => {
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "client", "src", "pages", "Applications.tsx"), "utf8");
    const service = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");

    expect(router).toContain("getInterviewPage: protectedProcedure");
    expect(router).not.toContain("getInterviews: protectedProcedure");
    expect(page).toContain("trpc.applications.getInterviewPage.useInfiniteQuery");
    expect(page).toContain("Load earlier interview history");
    expect(page).toContain("activeItems");
    expect(service).toContain("export async function getInterviewSchedules(applicationId: number, userId: number)");
    expect(service).toContain("export async function getInterviewSchedulePage(");
    expect(service).toContain('const activeStatuses = ["scheduled", "rescheduled"] as const');
    expect(service).toContain('const historyStatuses = ["completed", "cancelled"] as const');
  });

  it("keeps the cursor index aligned with schema and migration", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0065_interview_history_cursor_index.sql"),
      "utf8"
    );
    const indexName = "interview_schedules_application_status_scheduled_id_idx";

    expect(schema).toContain(indexName);
    expect(migration).toContain(indexName);
    expect(migration).toContain("`application_id`,`status`,`scheduled_at`,`id`");
  });
});
