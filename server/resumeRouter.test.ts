import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  deleteResumeVersion: vi.fn(),
  getActiveResume: vi.fn(),
  getResumeVersionPage: vi.fn(),
  parseResumeFromFile: vi.fn(),
  resumeToProfileData: vi.fn(),
  setActiveVersion: vi.fn(),
  uploadResume: vi.fn(),
}));

vi.mock("./resumeStorage", () => ({
  uploadResume: mocks.uploadResume,
  getActiveResume: mocks.getActiveResume,
  getResumeVersionPage: mocks.getResumeVersionPage,
  setActiveVersion: mocks.setActiveVersion,
  deleteResumeVersion: mocks.deleteResumeVersion,
}));

vi.mock("./resumeParser", () => ({
  parseResumeFromFile: mocks.parseResumeFromFile,
  resumeToProfileData: mocks.resumeToProfileData,
}));

import { getUserProfile, upsertUserProfile } from "./db";
import { appRouter } from "./routers";

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `resume-router-${userId}`,
      email: `resume-router-${userId}@example.local`,
      name: "Resume Router User",
      loginMethod: "test",
      role: "user",
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

describe("resume router synchronization", () => {
  const userId = 190071;
  const versionOne = {
    id: 11,
    userId,
    fileName: "candidate-resume.txt",
    fileUrl: "https://cdn.example.com/resumes/candidate-resume-v1.txt",
    fileKey: "resumes/190071/candidate-resume-v1.txt",
    fileSize: 120,
    mimeType: "text/plain",
    version: 1,
    isActive: true,
    uploadedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseResumeFromFile.mockResolvedValue({ skills: [], experience: [], education: [], certifications: [], languages: [] });
    mocks.resumeToProfileData.mockReturnValue({
      skills: "TypeScript, React",
      experience: "Built job-search tooling",
      education: "BSc Computer Science",
    });
    mocks.uploadResume.mockResolvedValue(versionOne);
    mocks.setActiveVersion.mockResolvedValue(true);
    mocks.deleteResumeVersion.mockResolvedValue(true);
    mocks.getActiveResume.mockResolvedValue(versionOne);
    mocks.getResumeVersionPage.mockResolvedValue({ items: [versionOne], nextCursor: null });
  });

  it("parses and stores imported files through versioned resume storage before updating the profile", async () => {
    const caller = appRouter.createCaller(createContext(userId));
    const result = await caller.resume.parseFile({
      filename: "candidate resume.txt",
      mimeType: "text/plain",
      fileData: Buffer.from("Candidate resume", "utf8").toString("base64"),
    });

    expect(mocks.parseResumeFromFile).toHaveBeenCalledOnce();
    expect(mocks.uploadResume).toHaveBeenCalledWith(userId, expect.any(Buffer), "candidate_resume.txt", "text/plain");
    expect(result.resume).toEqual(versionOne);

    const profile = await getUserProfile(userId);
    expect(profile).toMatchObject({
      resumeUrl: versionOne.fileUrl,
      resumeFileKey: versionOne.fileKey,
      skills: "TypeScript, React",
    });
  }, 30_000);

  it("preserves existing profile evidence when a parser result has no supporting field data", async () => {
    const partialUserId = 190073;
    mocks.resumeToProfileData.mockReturnValue({});
    await upsertUserProfile({
      userId: partialUserId,
      skills: "TypeScript, React, Node.js",
      experience: "Six years building remote applications.",
      education: "BSc Computer Science",
      linkedinUrl: "https://linkedin.com/in/existing-candidate",
    });
    const caller = appRouter.createCaller(createContext(partialUserId));

    await caller.resume.parseFile({
      filename: "partial resume.txt",
      mimeType: "text/plain",
      fileData: Buffer.from("Candidate resume", "utf8").toString("base64"),
    });

    expect(await getUserProfile(partialUserId)).toMatchObject({
      skills: "TypeScript, React, Node.js",
      experience: "Six years building remote applications.",
      education: "BSc Computer Science",
      linkedinUrl: "https://linkedin.com/in/existing-candidate",
      resumeFileKey: versionOne.fileKey,
    });
  });

  it("keeps profile resume metadata aligned when an operator changes or removes the active version", async () => {
    const caller = appRouter.createCaller(createContext(userId));

    await caller.resume.setActiveVersion({ version: 1 });
    expect(mocks.setActiveVersion).toHaveBeenCalledWith(userId, 1);
    expect(await getUserProfile(userId)).toMatchObject({ resumeFileKey: versionOne.fileKey });

    mocks.getActiveResume.mockResolvedValueOnce(null);
    await caller.resume.deleteVersion({ version: 1 });
    expect(mocks.deleteResumeVersion).toHaveBeenCalledWith(userId, 1);
    expect(await getUserProfile(userId)).toMatchObject({ resumeUrl: null, resumeFileKey: null });
  });

  it("returns a bounded owner-scoped resume history page", async () => {
    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.resume.getVersionPage({ limit: 25 })).resolves.toEqual({
      items: [versionOne],
      nextCursor: null,
    });
    expect(mocks.getResumeVersionPage).toHaveBeenCalledWith(userId, { limit: 25 });
  });

  it("rejects legacy metadata-only uploads without creating misleading profile evidence", async () => {
    const metadataOnlyUserId = 190072;
    const caller = appRouter.createCaller(createContext(metadataOnlyUserId));

    await expect(caller.resume.upload({
      fileKey: "resumes/190072/unverified.pdf",
      fileUrl: "https://cdn.example.com/resumes/unverified.pdf",
      fileName: "unverified.pdf",
      fileType: "application/pdf",
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("resume.uploadWithHistory"),
    });

    expect(await getUserProfile(metadataOnlyUserId)).toBeUndefined();
    expect(mocks.uploadResume).not.toHaveBeenCalled();
  });
});
