import { randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHireTrpcClient } from "@/lib/trpcClient";
import { applications, jobDuplicates, jobs, userProfiles, userResumes, users } from "../drizzle/schema";
import { appRouter } from "./routers";
import {
  closeDatabaseConnection,
  ensureScraperPlatformCatalog,
  getAllJobPlatforms,
  getActiveJobPage,
  getDb,
  getUserApplicationById,
  getUserProfile,
  upsertUserProfile,
} from "./db";
import { assertProductionDatabaseSchema } from "./databaseSchemaValidation";
import { deleteResumeVersion, getActiveResume, setActiveVersion, uploadResume } from "./resumeStorage";
import { storageDelete, storagePut } from "./storage";
import { ScraperManager } from "./scrapers/scraperManager";
import {
  getSourceComparisonPage,
  getSourceDirectory,
} from "./sourceIntelligenceRepository";

const enabled = process.env.HIRE_AI_DATABASE_ACCEPTANCE === "true";

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({}),
  storageDelete: vi.fn().mockResolvedValue({}),
  storageGet: vi.fn(),
}));

describe
  .skipIf(!enabled)
  .sequential("production data path on isolated MySQL", () => {
    const marker = `acceptance-${randomUUID()}`;
    let database: NonNullable<Awaited<ReturnType<typeof getDb>>>;
    let records: Parameters<ScraperManager["saveJobs"]>[0] = [];
    let jobIds: number[] = [];
    const userIds: number[] = [];
    let applicationId = 0;
    let firstSave: Awaited<ReturnType<ScraperManager["saveJobs"]>>;

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL || "");
      if (url.pathname !== "/hire_ai_acceptance") {
        throw new Error(
          "Acceptance writes require the dedicated hire_ai_acceptance database"
        );
      }
      await assertProductionDatabaseSchema(url.href);
      const db = await getDb();
      if (!db)
        throw new Error("MySQL is required; sample fallback is not acceptance");
      database = db;
      await ensureScraperPlatformCatalog();
      const platforms = await getAllJobPlatforms();
      const primary = platforms.find(
        platform => platform.name === "Himalayas"
      )!;
      const secondary = platforms.find(
        platform => platform.name === "Arbeitnow UK"
      )!;
      const listing = {
        title: "Acceptance Software Engineer",
        company: marker,
        location: "Remote - Netherlands",
        description: "Synthetic isolated acceptance vacancy. Not a real job.",
        jobType: "full-time",
        applicationUrl: `https://employer.example.test/${marker}`,
        salaryCurrency: "EUR",
        salaryMin: 50000,
      };
      records = [
        {
          ...listing,
          platformId: primary.id,
          externalId: `${marker}-a`,
          sourceUrl: `https://himalayas.app/${marker}`,
          salaryMax: 70000,
        },
        {
          ...listing,
          platformId: secondary.id,
          externalId: `${marker}-b`,
          sourceUrl: `https://www.arbeitnow.co.uk/${marker}`,
          salaryMax: 75000,
        },
      ];
      firstSave = await new ScraperManager().saveJobs(records);
      jobIds = (
        await database
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.company, marker))
      ).map(job => job.id);
      for (const suffix of ["owner", "other"]) {
        const inserted = await database
          .insert(users)
          .values({
            openId: `${marker}-${suffix}`,
            name: "Acceptance Test User",
          });
        userIds.push(Number(inserted[0].insertId));
      }
      const inserted = await database
        .insert(applications)
        .values({
          userId: userIds[0],
          jobId: jobIds[0],
          notes: "Private owner-only acceptance note",
        });
      applicationId = Number(inserted[0].insertId);
    }, 60000);

    afterAll(async () => {
      try {
        if (!database) return;
        if (applicationId)
          await database
            .delete(applications)
            .where(eq(applications.id, applicationId));
        if (userIds.length) {
          await database.delete(userProfiles).where(inArray(userProfiles.userId, userIds));
          await database.delete(users).where(inArray(users.id, userIds));
        }
        // Scope cleanup to this run's unpredictable marker, including a partially failed setup.
        const ownedIds = (
          await database
            .select({ id: jobs.id })
            .from(jobs)
            .where(eq(jobs.company, marker))
        ).map(job => job.id);
        if (ownedIds.length) {
          await database
            .delete(jobDuplicates)
            .where(inArray(jobDuplicates.duplicateJobId, ownedIds));
          await database.delete(jobs).where(inArray(jobs.id, ownedIds));
        }
      } finally {
        await closeDatabaseConnection();
      }
    }, 30000);

    it("persists both source records and a single duplicate link", async () => {
      expect(firstSave).toEqual({
        saved: 1,
        refreshed: 0,
        duplicates: 1,
        errors: 0,
      });
      expect(jobIds).toHaveLength(2);
      const links = await database
        .select()
        .from(jobDuplicates)
        .where(inArray(jobDuplicates.duplicateJobId, jobIds));
      expect(links).toHaveLength(1);
      const page = await getSourceComparisonPage({
        limit: 1,
        cursor: links[0].duplicateJobId - 1,
      });
      expect(page.dataMode).toBe("database");
      expect(page.items[0].differences).toEqual([
        { field: "salaryMax", primary: 70000, duplicate: 75000 },
      ]);
      const next = await getSourceComparisonPage({
        limit: 1,
        cursor: links[0].duplicateJobId,
      });
      expect(
        next.items.some(pair => pair.duplicate.id === links[0].duplicateJobId)
      ).toBe(false);
    });

    it("paginates MySQL job results across tied and null posting dates without gaps", async () => {
      const createdAt = new Date();
      const postedDate = new Date(createdAt.getTime() - 86_400_000);
      await database.insert(jobs).values([
        {
          externalId: `${marker}-cursor-dated-a`,
          title: "Cursor Boundary Dated Alpha",
          company: marker,
          platformId: records[0].platformId,
          sourceUrl: `https://jobs.example.test/${marker}/cursor-dated-a`,
          postedDate,
          createdAt,
          updatedAt: createdAt,
        },
        {
          externalId: `${marker}-cursor-dated-b`,
          title: "Cursor Boundary Dated Beta",
          company: marker,
          platformId: records[0].platformId,
          sourceUrl: `https://jobs.example.test/${marker}/cursor-dated-b`,
          postedDate,
          createdAt,
          updatedAt: createdAt,
        },
        {
          externalId: `${marker}-cursor-undated-a`,
          title: "Cursor Boundary Undated Alpha",
          company: marker,
          platformId: records[0].platformId,
          sourceUrl: `https://jobs.example.test/${marker}/cursor-undated-a`,
          postedDate: null,
          createdAt,
          updatedAt: createdAt,
        },
        {
          externalId: `${marker}-cursor-undated-b`,
          title: "Cursor Boundary Undated Beta",
          company: marker,
          platformId: records[0].platformId,
          sourceUrl: `https://jobs.example.test/${marker}/cursor-undated-b`,
          postedDate: null,
          createdAt,
          updatedAt: createdAt,
        },
      ]);

      const storedRows = await database
        .select({ id: jobs.id, title: jobs.title })
        .from(jobs)
        .where(eq(jobs.company, marker));
      const datedIds = storedRows
        .filter((job) => job.title.startsWith("Cursor Boundary Dated"))
        .map((job) => job.id)
        .sort((left, right) => right - left);
      const undatedIds = storedRows
        .filter((job) => job.title.startsWith("Cursor Boundary Undated"))
        .map((job) => job.id)
        .sort((left, right) => right - left);
      const expectedIds = [...datedIds, ...undatedIds];
      expect(expectedIds).toHaveLength(4);

      const seenIds: number[] = [];
      let cursor: {
        postedDate: Date | null;
        createdAt: Date;
        id: number;
      } | undefined;
      for (let pageNumber = 0; pageNumber <= expectedIds.length; pageNumber += 1) {
        const page = await getActiveJobPage({
          limit: 1,
          cursor,
          filters: { query: "Cursor Boundary", remoteOnly: false },
        });
        seenIds.push(...page.items.map((job) => job.id));
        cursor = page.nextCursor ?? undefined;
        if (!cursor) break;
      }

      expect(seenIds).toEqual(expectedIds);
      expect(cursor).toBeUndefined();
    });

    it("excludes roles requiring recurring in-person attendance from MySQL remote-only results", async () => {
      const createdAt = new Date();
      await database.insert(jobs).values([
        {
          externalId: `${marker}-remote-only`,
          title: "Remote Eligibility Acceptance Remote Specialist",
          company: marker,
          location: "Remote - Worldwide",
          description: "Fully remote work; no office attendance required.",
          platformId: records[0].platformId,
          sourceUrl: `https://jobs.example.test/${marker}/remote-only`,
          createdAt,
          updatedAt: createdAt,
        },
        {
          externalId: `${marker}-mostly-remote`,
          title: "Remote Eligibility Acceptance Mostly Remote Specialist",
          company: marker,
          location: "Neuruppin, Germany",
          description: "Mostly remote within Germany, with monthly in-person collaboration at our Berlin office.",
          platformId: records[0].platformId,
          sourceUrl: `https://jobs.example.test/${marker}/mostly-remote`,
          createdAt,
          updatedAt: createdAt,
        },
      ]);

      const page = await getActiveJobPage({
        limit: 10,
        filters: { query: "Remote Eligibility Acceptance", remoteOnly: true },
      });

      expect(page.items.map((job) => job.externalId)).toContain(`${marker}-remote-only`);
      expect(page.items.map((job) => job.externalId)).not.toContain(`${marker}-mostly-remote`);
    });

    it("refreshes repeated provider identities without multiplying stored jobs", async () => {
      expect(await new ScraperManager().saveJobs(records)).toEqual({
        saved: 0,
        refreshed: 2,
        duplicates: 0,
        errors: 0,
      });
      const stored = await database
        .select()
        .from(jobs)
        .where(eq(jobs.company, marker));
      expect(
        stored.filter((job) =>
          records.some((record) => record.externalId === job.externalId)
        )
      ).toHaveLength(2);
      const directory = await getSourceDirectory({
        query: "Arbeitnow UK",
        limit: 25,
        offset: 0,
      });
      expect(directory.dataMode).toBe("database");
      expect(directory.items[0].duplicateCount).toBeGreaterThanOrEqual(1);
    });

    it("keeps application details isolated between actual database users", async () => {
      expect(
        await getUserApplicationById(userIds[0], applicationId)
      ).toMatchObject({ notes: "Private owner-only acceptance note" });
      expect(
        await getUserApplicationById(userIds[1], applicationId)
      ).toBeNull();
    });

    it("serves a protected profile through the frontend client, Express, tRPC, and MySQL", async () => {
      const userId = userIds[0];
      const skills = `${marker} profile delivered over HTTP`;
      await upsertUserProfile({ userId, skills });
      const [account] = await database
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!account) throw new Error("Acceptance account is missing from MySQL.");

      const app = express();
      app.use("/api/trpc", createExpressMiddleware({
        router: appRouter,
        createContext: ({ req, res }) => ({ req, res, user: account }),
      }));
      const server = createServer(app);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        server.closeAllConnections();
        throw new Error("Acceptance HTTP server did not bind to TCP.");
      }

      try {
        const client = createHireTrpcClient(
          `http://127.0.0.1:${address.port}/api/trpc`
        );
        await expect(client.profile.get.query()).resolves.toMatchObject({
          userId,
          skills,
        });
      } finally {
        const closed = new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
        server.closeAllConnections();
        await closed;
      }
    });

    it("does not delete a replacement resume when a delayed deletion resumes", async () => {
      const userId = userIds[0];
      const bytes = Buffer.from("Synthetic resume");
      const original = await uploadResume(userId, bytes, "original.txt", "text/plain");
      let replacement: Awaited<ReturnType<typeof uploadResume>> | undefined;
      vi.mocked(storageDelete).mockClear();
      vi.mocked(storageDelete).mockImplementationOnce(async () => {
        // Another request finishes deletion and uploads while the first storage call waits.
        expect(await deleteResumeVersion(userId, original.version, original.id)).toBe(true);
        replacement = await uploadResume(userId, bytes, "replacement.txt", "text/plain");
        return { key: original.fileKey };
      });

      expect(await deleteResumeVersion(userId, original.version, original.id)).toBe(false);
      expect(replacement).toBeDefined();
      expect(replacement!.version).toBe(original.version);
      expect(replacement!.id).not.toBe(original.id);
      expect(await getActiveResume(userId)).toMatchObject({
        id: replacement!.id, fileKey: replacement!.fileKey, isActive: true,
      });
      expect(storageDelete).toHaveBeenCalledTimes(2);
      for (const [key] of vi.mocked(storageDelete).mock.calls) expect(key).toBe(original.fileKey);
    });

    it.each(["activate", "delete"] as const)("rejects stale resume identity for %s before changing a replacement", async (action) => {
      const inserted = await database.insert(users).values({ openId: `${marker}-${action}` });
      const userId = Number(inserted[0].insertId);
      userIds.push(userId);
      const bytes = Buffer.from("Synthetic resume");
      const old = await uploadResume(userId, bytes, "old.txt", "text/plain");
      expect(await deleteResumeVersion(userId, old.version, old.id)).toBe(true);
      const replacement = await uploadResume(userId, bytes, "replacement.txt", "text/plain");
      expect(replacement.version).toBe(old.version);
      const active = action === "activate"
        ? await uploadResume(userId, bytes, "newest.txt", "text/plain") : replacement;
      vi.mocked(storageDelete).mockClear();

      const result = action === "activate"
        ? await setActiveVersion(userId, old.version, old.id)
        : await deleteResumeVersion(userId, old.version, old.id);

      expect(result).toBe(false);
      expect(await getActiveResume(userId)).toMatchObject({ id: active.id, fileKey: active.fileKey });
      expect(storageDelete).not.toHaveBeenCalled();
    });

    it("retains data after closing and reopening the database pool", async () => {
      await closeDatabaseConnection();
      const reopened = await getDb();
      if (!reopened) throw new Error("Persistent database disappeared");
      database = reopened;
      expect(
        await getUserApplicationById(userIds[0], applicationId)
      ).not.toBeNull();
      expect(
        await getUserApplicationById(userIds[1], applicationId)
      ).toBeNull();
    });

    async function resumeUser(suffix: string) {
      const inserted = await database.insert(users).values({ openId: `${randomUUID()}-${suffix}` });
      const userId = Number(inserted[0].insertId);
      userIds.push(userId);
      return userId;
    }

    it("commits parsed evidence and the active resume reference while preserving unrelated profile fields", async () => {
      const userId = await resumeUser("profile-upload");
      await upsertUserProfile({ userId, experience: "Retained experience", desiredLocations: "Netherlands" });
      const resume = await uploadResume(userId, Buffer.from("Synthetic resume"), "parsed.txt", "text/plain", {
        skills: "TypeScript", githubUrl: "https://github.com/example",
      });
      expect(await getUserProfile(userId)).toMatchObject({
        resumeUrl: resume.fileUrl, resumeFileKey: resume.fileKey,
        skills: "TypeScript", githubUrl: "https://github.com/example",
        experience: "Retained experience", desiredLocations: "Netherlands",
      });
      expect(await getActiveResume(userId)).toMatchObject({ id: resume.id });
    });

    it("keeps profile references aligned through activation, inactive deletion, fallback and final deletion", async () => {
      const userId = await resumeUser("profile-lifecycle");
      const bytes = Buffer.from("Synthetic resume");
      const first = await uploadResume(userId, bytes, "first.txt", "text/plain");
      const second = await uploadResume(userId, bytes, "second.txt", "text/plain");
      const third = await uploadResume(userId, bytes, "third.txt", "text/plain");
      expect(await setActiveVersion(userId, first.version, first.id)).toBe(true);
      expect(await getUserProfile(userId)).toMatchObject({ resumeFileKey: first.fileKey });
      expect(await deleteResumeVersion(userId, second.version, second.id)).toBe(true);
      expect(await getUserProfile(userId)).toMatchObject({ resumeFileKey: first.fileKey });
      expect(await deleteResumeVersion(userId, first.version, first.id)).toBe(true);
      expect(await getActiveResume(userId)).toMatchObject({ id: third.id });
      expect(await getUserProfile(userId)).toMatchObject({ resumeFileKey: third.fileKey });
      expect(await deleteResumeVersion(userId, third.version, third.id)).toBe(true);
      expect(await getActiveResume(userId)).toBeNull();
      expect(await getUserProfile(userId)).toMatchObject({ resumeFileKey: null, resumeUrl: null });
    });

    it("serializes concurrent imports so the final active file and imported evidence agree", async () => {
      const userId = await resumeUser("profile-concurrent");
      const bytes = Buffer.from("Synthetic resume");
      const uploaded = await Promise.all([
        uploadResume(userId, bytes, "first.txt", "text/plain", { skills: "First evidence" }),
        uploadResume(userId, bytes, "second.txt", "text/plain", { skills: "Second evidence" }),
      ]);
      const active = await getActiveResume(userId);
      const winner = uploaded.findIndex(item => item.id === active?.id);
      expect(winner).toBeGreaterThanOrEqual(0);
      expect(uploaded.map(item => item.version).sort()).toEqual([1, 2]);
      expect(await getUserProfile(userId)).toMatchObject({
        resumeFileKey: uploaded[winner].fileKey, resumeUrl: uploaded[winner].fileUrl,
        skills: winner === 0 ? "First evidence" : "Second evidence",
      });
      const rows = await database.select().from(userResumes).where(eq(userResumes.userId, userId));
      expect(rows.filter(row => row.isActive === 1)).toHaveLength(1);
    });

    it("rolls back the new version and active flag if imported profile data cannot be stored", async () => {
      const userId = await resumeUser("profile-rollback");
      const original = await uploadResume(userId, Buffer.from("Original resume"), "original.txt", "text/plain");
      await upsertUserProfile({ userId, resumeUrl: original.fileUrl, resumeFileKey: original.fileKey, skills: "Original" });
      vi.mocked(storageDelete).mockClear();
      vi.mocked(storagePut).mockClear();
      // Exceeds the real profile column's 500-character bound; MySQL must reject the write.
      await expect(uploadResume(userId, Buffer.from("New resume"), "new.txt", "text/plain", {
        portfolioUrl: "https://example.test/" + "x".repeat(600), skills: "Must not persist",
      })).rejects.toThrow();
      expect(await getActiveResume(userId)).toMatchObject({ id: original.id });
      expect(await getUserProfile(userId)).toMatchObject({ resumeFileKey: original.fileKey, skills: "Original" });
      const versions = await database.select().from(userResumes).where(eq(userResumes.userId, userId));
      expect(versions.map(row => row.id)).toEqual([original.id]);
      expect(storagePut).toHaveBeenCalledOnce();
      expect(storageDelete).toHaveBeenCalledExactlyOnceWith(vi.mocked(storagePut).mock.calls[0][0]);
    });

    it("preserves a newer selection when an older deletion finishes its storage call", async () => {
      const userId = await resumeUser("profile-delayed-delete");
      const first = await uploadResume(userId, Buffer.from("First resume"), "first.txt", "text/plain");
      const second = await uploadResume(userId, Buffer.from("Second resume"), "second.txt", "text/plain");
      await setActiveVersion(userId, first.version, first.id);
      vi.mocked(storageDelete).mockImplementationOnce(async () => {
        expect(await setActiveVersion(userId, second.version, second.id)).toBe(true);
        return { key: first.fileKey };
      });
      expect(await deleteResumeVersion(userId, first.version, first.id)).toBe(true);
      expect(await getActiveResume(userId)).toMatchObject({ id: second.id });
      expect(await getUserProfile(userId)).toMatchObject({ resumeFileKey: second.fileKey });
    });

    it("rejects another user's resume identity without changing either profile or deleting storage", async () => {
      const owner = await resumeUser("resume-owner");
      const other = await resumeUser("resume-other");
      const mine = await uploadResume(owner, Buffer.from("Owner resume"), "mine.txt", "text/plain");
      const theirs = await uploadResume(other, Buffer.from("Other resume"), "theirs.txt", "text/plain");
      const beforeOwner = await getUserProfile(owner);
      const beforeOther = await getUserProfile(other);
      vi.mocked(storageDelete).mockClear();
      expect(await setActiveVersion(owner, theirs.version, theirs.id)).toBe(false);
      expect(await deleteResumeVersion(owner, theirs.version, theirs.id)).toBe(false);
      expect(await getUserProfile(owner)).toEqual(beforeOwner);
      expect(await getUserProfile(other)).toEqual(beforeOther);
      expect(await getActiveResume(owner)).toMatchObject({ id: mine.id });
      expect(await getActiveResume(other)).toMatchObject({ id: theirs.id });
      expect(storageDelete).not.toHaveBeenCalled();
    });
  });
