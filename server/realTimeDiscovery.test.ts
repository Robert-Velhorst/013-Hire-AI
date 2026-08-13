import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRecentJobs } from "./realTimeDiscovery";

describe("canonical job discovery", () => {
  it("keeps catalog reads free of process-local polling and callback subscriptions", () => {
    const discovery = readFileSync(resolve(process.cwd(), "server", "realTimeDiscovery.ts"), "utf8");
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");

    expect(discovery).not.toContain("setInterval(");
    expect(discovery).not.toContain("SubscriptionManager");
    expect(discovery).not.toContain("callback:");
    expect(router).not.toContain("getSubscriptionManager");
    expect(router).toContain("Durable matching is handled by Job Alerts");
  });
});

describe("job discovery filtering", () => {
  it("applies job type to the local discovery query", async () => {
    const result = await getRecentJobs({ jobTypes: ["contract"] });

    expect(result.total).toBeGreaterThan(0);
    expect(result.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobType: "contract" }),
    ]));
    expect(result.jobs.every((job) => job.jobType === "contract")).toBe(true);
  });

  it("applies experience levels to recent-job discovery queries", async () => {
    const result = await getRecentJobs({ experienceLevels: ["senior"] });

    expect(result.total).toBeGreaterThan(0);
    expect(result.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: expect.stringContaining("Senior") }),
    ]));
    expect(result.jobs.every((job) => /senior|sr\.?|5\+|5-7|experienced/i.test(
      `${job.title} ${job.requirements || ""}`
    ))).toBe(true);
  });
});
