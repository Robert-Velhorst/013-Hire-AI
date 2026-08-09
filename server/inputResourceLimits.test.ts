import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `resource-limit-user-${userId}`,
      name: "Resource Limit User",
      email: `resource-limit-${userId}@example.local`,
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("transport resource limits", () => {
  const caller = appRouter.createCaller(createContext(97501));

  it("rejects oversized resume text before parsing or profile writes", async () => {
    await expect(caller.resume.parse({ resumeText: "x".repeat(500_001) })).rejects.toThrow();
  });

  it("rejects oversized AI lists and narratives before model work", async () => {
    await expect(caller.diversity.getDIPlatforms({
      categories: Array.from({ length: 51 }, (_, index) => `category-${index}`),
    })).rejects.toThrow();
    await expect(caller.career.analyzeCompanyCulture({
      company: "Example",
      jobTitle: "Engineer",
      jobDescription: "x".repeat(20_001),
    })).rejects.toThrow();
  });

  it("rejects invalid deduplication and alert bounds before state changes", async () => {
    await expect(caller.normalization.checkDuplicate({ text: "role", threshold: 1.01 })).rejects.toThrow();
    await expect(caller.alerts.create({
      name: "x".repeat(256),
      frequency: "daily",
    })).rejects.toThrow();
  });

  it("rejects invalid profile dates and oversized saved-job metadata", async () => {
    await expect(caller.profile.addWorkExperience({
      jobTitle: "Engineer",
      company: "Example",
      startDate: "not-a-date",
    })).rejects.toThrow();
    await expect(caller.jobs.saveJob({
      jobId: 1,
      notes: "x".repeat(10_001),
    })).rejects.toThrow();
  });

  it("rejects zero identifiers before ownership or database work", async () => {
    await expect(caller.jobs.getById({ id: 0 })).rejects.toThrow();
    await expect(caller.applications.getLedgerArtifacts({ applicationId: 0 })).rejects.toThrow();
    await expect(caller.successFees.getFeeVerifications({ successFeeId: 0 })).rejects.toThrow();
  });

  it("keeps upload limits at the transport boundary for every document route", () => {
    const routers = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const fees = readFileSync(resolve(process.cwd(), "server", "routers", "successFees.ts"), "utf8");

    expect(routers).toContain("const boundedUploadBase64 = z.string().min(1).max(14_000_000)");
    expect(routers).toContain("fileData: boundedUploadBase64");
    expect(fees).toContain("const boundedDocumentBase64 = z.string().min(1).max(14_000_000)");
    expect(fees).toContain("offerLetterBase64: boundedDocumentBase64");
    expect(fees).toContain("documentBase64: boundedDocumentBase64");
  });
});
