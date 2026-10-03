import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  deleteResumeVersion: vi.fn(),
  getActiveResume: vi.fn(),
  getResumeVersionPage: vi.fn(),
  parseResumeFromFile: vi.fn(),
  resumeToProfileData: vi.fn(),
  setActiveVersion: vi.fn(),
  uploadResume: vi.fn(),
  scanSensitiveUpload: vi.fn(),
  downloadCloudResumeDocument: vi.fn(),
}));

vi.mock("./uploadValidation", async (importOriginal) => ({
  ...await importOriginal<typeof import("./uploadValidation")>(),
  scanSensitiveUpload: mocks.scanSensitiveUpload,
}));

vi.mock("./cloudDocumentDiscovery", () => ({
  downloadCloudResumeDocument: mocks.downloadCloudResumeDocument,
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
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.scanSensitiveUpload.mockResolvedValue({ scanned: true, provider: "synthetic-scanner" });
    mocks.downloadCloudResumeDocument.mockResolvedValue({
      data: Buffer.from("Candidate resume"), fileName: "candidate resume.txt", mimeType: "text/plain",
    });
    mocks.parseResumeFromFile.mockResolvedValue({ skills: [], experience: [], education: [], certifications: [], languages: [] });
    mocks.resumeToProfileData.mockReturnValue({
      skills: "TypeScript, React",
      experience: "Built job-search tooling",
      education: "BSc Computer Science",
    });
    // Model the version service's commit boundary; actual atomicity is tested on MySQL.
    mocks.uploadResume.mockImplementation(async (userId, _bytes, _name, _mime, profileData = {}) => {
      await upsertUserProfile({
        userId, resumeUrl: versionOne.fileUrl, resumeFileKey: versionOne.fileKey, ...profileData,
      });
      return versionOne;
    });
    mocks.setActiveVersion.mockImplementation(async userId => {
      await upsertUserProfile({ userId, resumeUrl: versionOne.fileUrl, resumeFileKey: versionOne.fileKey });
      return true;
    });
    mocks.deleteResumeVersion.mockImplementation(async userId => {
      await upsertUserProfile({ userId, resumeUrl: null, resumeFileKey: null });
      return true;
    });
    mocks.getActiveResume.mockResolvedValue(versionOne);
    mocks.getResumeVersionPage.mockResolvedValue({ items: [versionOne], nextCursor: null });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejects a real blank PDF without AI, stored versions or profile changes", async () => {
    const { parseResumeFromFile } = await vi.importActual<typeof import("./resumeParser")>("./resumeParser");
    mocks.parseResumeFromFile.mockImplementationOnce(parseResumeFromFile);
    const fetchMock = vi.fn(() => { throw new Error("Unexpected provider call"); });
    vi.stubGlobal("fetch", fetchMock);
    const userId = 190086;
    await upsertUserProfile({ userId, skills: "Existing skills", experience: "Recorded experience" });
    const before = await getUserProfile(userId);
    const caller = appRouter.createCaller(createContext(userId));
    const blank = readFileSync(new URL("./testFixtures/blank-resume.pdf", import.meta.url));

    await expect(caller.resume.parseFile({
      filename: "blank.pdf", mimeType: "application/pdf", fileData: blank.toString("base64"),
    })).rejects.toThrow(/no readable text/i);

    expect(mocks.scanSensitiveUpload).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.uploadResume).not.toHaveBeenCalled();
    expect(await getUserProfile(userId)).toEqual(before);
  }, 30_000);

  const importResume = (caller: ReturnType<typeof appRouter.createCaller>, source: "local" | "cloud") =>
    source === "local" ? caller.resume.parseFile({
      filename: "candidate resume.txt", mimeType: "text/plain",
      fileData: Buffer.from("Candidate resume").toString("base64"),
    }) : caller.profile.importCloudResume({
      provider: "google_drive", sourceId: "synthetic-document", name: "candidate resume.txt",
      mimeType: "text/plain", size: 16, modifiedAt: null,
    });

  it.each(["local", "cloud"] as const)("blocks %s resume parsing and changes when scanning fails", async (source) => {
    const blockedUser = source === "local" ? 190080 : 190081;
    await upsertUserProfile({ userId: blockedUser, skills: "Existing skills" });
    mocks.scanSensitiveUpload.mockRejectedValueOnce(new Error("Scanner unavailable"));
    const caller = appRouter.createCaller(createContext(blockedUser));

    await expect(importResume(caller, source)).rejects.toThrow();

    expect(mocks.scanSensitiveUpload).toHaveBeenCalledWith({
      data: Buffer.from("Candidate resume"), fileName: "candidate_resume.txt", mimeType: "text/plain",
    });
    expect(mocks.parseResumeFromFile).not.toHaveBeenCalled();
    expect(mocks.uploadResume).not.toHaveBeenCalled();
    expect(await getUserProfile(blockedUser)).toMatchObject({ skills: "Existing skills" });
  });

  it.each(["local", "cloud"] as const)("awaits the %s scan verdict before parsing", async (source) => {
    let finishScan!: () => void;
    mocks.scanSensitiveUpload.mockImplementationOnce(() => new Promise(resolve => {
      finishScan = () => resolve({ scanned: true, provider: "synthetic-scanner" });
    }));
    const caller = appRouter.createCaller(createContext(source === "local" ? 190082 : 190083));
    const pending = importResume(caller, source);
    try {
      await vi.waitFor(() => expect(mocks.scanSensitiveUpload).toHaveBeenCalledOnce());
      expect(mocks.parseResumeFromFile).not.toHaveBeenCalled();
      expect(mocks.uploadResume).not.toHaveBeenCalled();
    } finally {
      finishScan?.();
      await pending;
    }
    expect(mocks.parseResumeFromFile).toHaveBeenCalledOnce();
    expect(mocks.uploadResume).toHaveBeenCalledOnce();
  });

  it.each(["local", "cloud"] as const)("rejects mismatched %s file bytes before scanning or parsing", async (source) => {
    mocks.downloadCloudResumeDocument.mockResolvedValueOnce({
      data: Buffer.from("not a PDF"), fileName: "resume.pdf", mimeType: "application/pdf",
    });
    const caller = appRouter.createCaller(createContext(source === "local" ? 190084 : 190085));
    const pending = source === "local" ? caller.resume.parseFile({
      filename: "resume.pdf", mimeType: "application/pdf",
      fileData: Buffer.from("not a PDF").toString("base64"),
    }) : importResume(caller, source);
    await expect(pending).rejects.toThrow();
    expect(mocks.scanSensitiveUpload).not.toHaveBeenCalled();
    expect(mocks.parseResumeFromFile).not.toHaveBeenCalled();
    expect(mocks.uploadResume).not.toHaveBeenCalled();
  });

  it.each(["local", "cloud"] as const)("passes %s parsed evidence to the versioned storage transaction", async source => {
    const caller = appRouter.createCaller(createContext(userId));
    const result = await importResume(caller, source);

    expect(mocks.parseResumeFromFile).toHaveBeenCalledOnce();
    expect(mocks.uploadResume).toHaveBeenCalledWith(userId, expect.any(Buffer), "candidate_resume.txt", "text/plain", {
      skills: "TypeScript, React", experience: "Built job-search tooling", education: "BSc Computer Science",
    });
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

    await caller.resume.setActiveVersion({ version: 1, resumeId: versionOne.id });
    expect(mocks.setActiveVersion).toHaveBeenCalledWith(userId, 1, versionOne.id);
    expect(await getUserProfile(userId)).toMatchObject({ resumeFileKey: versionOne.fileKey });

    await caller.resume.deleteVersion({ version: 1, resumeId: versionOne.id });
    expect(mocks.deleteResumeVersion).toHaveBeenCalledWith(userId, 1, versionOne.id);
    expect(await getUserProfile(userId)).toMatchObject({ resumeUrl: null, resumeFileKey: null });
  });

  it.each(["setActiveVersion", "deleteVersion"] as const)("requires an immutable resume ID for %s", async (method) => {
    const caller = appRouter.createCaller(createContext(userId));
    await expect(caller.resume[method]({ version: 1 } as never)).rejects.toThrow();
    expect(mocks.setActiveVersion).not.toHaveBeenCalled();
    expect(mocks.deleteResumeVersion).not.toHaveBeenCalled();
  });

  it("returns a bounded owner-scoped resume history page", async () => {
    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.resume.getVersionPage({ limit: 25 })).resolves.toEqual({
      items: [versionOne],
      nextCursor: null,
    });
    expect(mocks.getResumeVersionPage).toHaveBeenCalledWith(userId, { limit: 25 });
  });

  it.each(["history", "local", "cloud", "activate", "delete"] as const)(
    "does not overwrite a newer profile after the %s version operation returns", async source => {
      const userId = 190090;
      const newer = {
        userId, resumeUrl: `private://resumes/${userId}/newer.txt`,
        resumeFileKey: `resumes/${userId}/newer.txt`, skills: "Newer verified evidence",
      };
      // A later request commits before the earlier service call returns to this router.
      const newerCommit = async () => { await upsertUserProfile(newer); };
      mocks.uploadResume.mockImplementation(async () => { await newerCommit(); return versionOne; });
      mocks.setActiveVersion.mockImplementation(async () => { await newerCommit(); return true; });
      mocks.deleteResumeVersion.mockImplementation(async () => { await newerCommit(); return true; });
      const caller = appRouter.createCaller(createContext(userId));
      if (source === "history") {
        await caller.resume.uploadWithHistory({
          fileData: Buffer.from("Candidate resume").toString("base64"), fileName: "resume.txt", mimeType: "text/plain",
        });
      } else if (source === "activate") {
        await caller.resume.setActiveVersion({ version: versionOne.version, resumeId: versionOne.id });
      } else if (source === "delete") {
        await caller.resume.deleteVersion({ version: versionOne.version, resumeId: versionOne.id });
      } else {
        await importResume(caller, source);
      }
      expect(await getUserProfile(userId)).toMatchObject(newer);
    }
  );

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

  it.each([
    { resumeUrl: "https://unverified.example.test/resume.pdf" },
    { resumeFileKey: "resumes/another-user/private.pdf" },
    { resumeUrl: "https://unverified.example.test/resume.pdf", resumeFileKey: "resumes/another-user/private.pdf" },
    { resumeFileKey: "" },
    { resumeUrl: null, resumeFileKey: null },
  ])("rejects direct profile resume metadata writes: %j", async (metadata) => {
    const userId = 190087;
    await upsertUserProfile({
      userId,
      skills: "Existing skills",
      resumeUrl: "private://resumes/190087/verified.txt",
      resumeFileKey: "resumes/190087/verified.txt",
    });
    const before = await getUserProfile(userId);
    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.profile.update({
      skills: "Should not be partially saved",
      ...metadata,
    } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(await getUserProfile(userId)).toEqual(before);
    expect(mocks.uploadResume).not.toHaveBeenCalled();
    expect(mocks.setActiveVersion).not.toHaveBeenCalled();
    expect(mocks.deleteResumeVersion).not.toHaveBeenCalled();
  });

  it("allows ordinary profile edits without changing the verified resume reference", async () => {
    const userId = 190088;
    await upsertUserProfile({
      userId,
      resumeUrl: "private://resumes/190088/verified.txt",
      resumeFileKey: "resumes/190088/verified.txt",
    });
    const caller = appRouter.createCaller(createContext(userId));

    await caller.profile.update({ skills: "TypeScript, React", desiredLocations: "Netherlands" });

    expect(await getUserProfile(userId)).toMatchObject({
      skills: "TypeScript, React",
      desiredLocations: "Netherlands",
      resumeUrl: "private://resumes/190088/verified.txt",
      resumeFileKey: "resumes/190088/verified.txt",
    });
  });
});
