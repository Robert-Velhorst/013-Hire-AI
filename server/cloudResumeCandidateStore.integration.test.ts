import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloudResumeCandidates, users } from "../drizzle/schema";
import { claimCloudResumeCandidate, completeCloudResumeCandidate, releaseCloudResumeCandidate, storeCloudResumeCandidates } from "./cloudResumeCandidateStore";
import { closeDatabaseConnection, getDb } from "./db";

const enabled = process.env.HIRE_AI_DATABASE_ACCEPTANCE === "true";

describe.skipIf(!enabled).sequential("cloud resume candidate ownership on isolated MySQL", () => {
  const marker = `cloud-resume-${randomUUID().replaceAll("-", "")}`;
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  let ownerId = 0;
  let otherUserId = 0;

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL || "");
    if (target.pathname !== "/hire_ai_acceptance") {
      throw new Error("Cloud resume candidate acceptance requires the isolated hire_ai_acceptance database.");
    }
    const connection = await getDb();
    if (!connection) throw new Error("MySQL is required; memory fallback is not integration acceptance.");
    db = connection;
    const owner = await db.insert(users).values({ openId: `${marker}-owner`, name: "Synthetic cloud resume owner" });
    ownerId = Number(owner[0].insertId);
    const other = await db.insert(users).values({ openId: `${marker}-other`, name: "Synthetic other user" });
    otherUserId = Number(other[0].insertId);
  });

  afterAll(async () => {
    if (otherUserId) await db.delete(users).where(eq(users.id, otherUserId));
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId));
    await closeDatabaseConnection();
  });

  it("keeps provider IDs server-side and enforces owner, expiry, one active import, and single use", async () => {
    const now = new Date();
    const [candidate] = await storeCloudResumeCandidates(ownerId, "google_drive", [{
      provider: "google_drive",
      sourceId: `${marker}-provider-id`,
      name: "Resume.pdf",
      mimeType: "application/pdf",
      size: 123,
      modifiedAt: now.toISOString(),
    }], now);
    expect(candidate).toMatchObject({
      candidateId: expect.stringMatching(/^[A-Za-z0-9_-]{40,64}$/),
      provider: "google_drive",
      name: "Resume.pdf",
    });
    expect(candidate).not.toHaveProperty("sourceId");

    await expect(claimCloudResumeCandidate(otherUserId, candidate!.candidateId, now)).resolves.toBeNull();
    const contenders = await Promise.all([
      claimCloudResumeCandidate(ownerId, candidate!.candidateId, now),
      claimCloudResumeCandidate(ownerId, candidate!.candidateId, now),
    ]);
    expect(contenders.filter(Boolean)).toHaveLength(1);
    const claimed = contenders.find(Boolean);
    expect(claimed).toMatchObject({ sourceId: `${marker}-provider-id`, userId: ownerId });
    await expect(claimCloudResumeCandidate(ownerId, candidate!.candidateId, now)).resolves.toBeNull();

    await releaseCloudResumeCandidate(ownerId, candidate!.candidateId);
    await expect(claimCloudResumeCandidate(ownerId, candidate!.candidateId, now)).resolves.toMatchObject({
      sourceId: `${marker}-provider-id`,
    });
    await completeCloudResumeCandidate(ownerId, candidate!.candidateId);
    await expect(claimCloudResumeCandidate(ownerId, candidate!.candidateId, now)).resolves.toBeNull();
    await expect(claimCloudResumeCandidate(ownerId, candidate!.candidateId, new Date(now.getTime() + 31 * 60 * 1000))).resolves.toBeNull();

    await storeCloudResumeCandidates(ownerId, "dropbox", [{
      provider: "dropbox",
      sourceId: `${marker}-cascade-object-id`,
      name: "CV.pdf",
      mimeType: "application/pdf",
      size: 456,
      modifiedAt: now.toISOString(),
    }], now);
    await db.delete(users).where(eq(users.id, ownerId));
    ownerId = 0;
    expect(await db.select().from(cloudResumeCandidates).where(eq(cloudResumeCandidates.userId, Number(claimed!.userId))))
      .toHaveLength(0);
  });
});
