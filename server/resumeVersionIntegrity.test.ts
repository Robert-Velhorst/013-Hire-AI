import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("resume version integrity", () => {
  it("serializes version assignment and active-version changes on the owner row", () => {
    const storage = readFileSync(resolve(process.cwd(), "server/resumeStorage.ts"), "utf8");
    const upload = storage.slice(
      storage.indexOf("export async function uploadResume"),
      storage.indexOf("export async function getActiveResume")
    );
    const activation = storage.slice(
      storage.indexOf("export async function setActiveVersion"),
      storage.indexOf("export async function deleteResumeVersion")
    );
    const deletion = storage.slice(
      storage.indexOf("export async function deleteResumeVersion"),
      storage.indexOf("export async function getResumeDownloadUrl")
    );

    expect(upload).toContain("await db.transaction(async (tx) =>");
    expect(upload).toContain('.where(eq(users.id, userId)).for("update")');
    expect(upload).toContain("await storageDelete(fileKey).catch");
    expect(upload.indexOf("const version =")).toBeGreaterThan(upload.indexOf('.for("update")'));
    expect(activation).toContain("await db.transaction(async (tx) =>");
    expect(activation).toContain('.where(eq(users.id, userId)).for("update")');
    expect(activation.indexOf("if (!target[0]) return false")).toBeLessThan(
      activation.indexOf(".set({ isActive: 0 })")
    );
    expect(deletion).toContain("await db.transaction(async (tx) =>");
    expect(deletion).toContain('.where(eq(users.id, userId)).for("update")');
    expect(deletion.indexOf("await storageDelete(resume.fileKey)")).toBeLessThan(
      deletion.indexOf("await db.transaction(async (tx) =>")
    );
  });

  it("keeps the Profile history bounded while privacy export retains complete history", () => {
    const profile = readFileSync(resolve(process.cwd(), "client/src/pages/Profile.tsx"), "utf8");
    const router = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    const privacy = readFileSync(resolve(process.cwd(), "server/privacyData.ts"), "utf8");

    expect(profile).toContain("resume.getVersionPage.useInfiniteQuery");
    expect(profile).toContain("getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined");
    expect(router).toContain("getVersionPage: protectedProcedure");
    expect(router).not.toContain("getVersions: protectedProcedure");
    expect(privacy).toContain("getResumeVersions(userId)");
  });
});
