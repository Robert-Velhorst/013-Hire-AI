import { randomBytes } from "node:crypto";
import { and, eq, gt, lte, or } from "drizzle-orm";
import { cloudResumeCandidates } from "../drizzle/schema";
import { getDb } from "./db";
import { logOperationalFailure } from "./operationalFailureLog";
import type { CloudDocumentProvider, CloudResumeDocument } from "./cloudDocumentDiscovery";

export type StoredCloudResumeCandidate = Omit<CloudResumeDocument, "sourceId"> & { candidateId: string };

const CANDIDATE_LIFETIME_MS = 30 * 60 * 1000;
const IMPORT_LEASE_MS = CANDIDATE_LIFETIME_MS;

export async function storeCloudResumeCandidates(
  userId: number,
  provider: CloudDocumentProvider,
  documents: CloudResumeDocument[],
  now = new Date(),
): Promise<StoredCloudResumeCandidate[]> {
  const db = await getDb();
  if (!db) throw new Error("Cloud resume discovery requires a configured database.");
  const expiresAt = new Date(now.getTime() + CANDIDATE_LIFETIME_MS);
  await db.delete(cloudResumeCandidates).where(or(
    lte(cloudResumeCandidates.expiresAt, now),
    and(eq(cloudResumeCandidates.userId, userId), eq(cloudResumeCandidates.provider, provider)),
  ));

  const candidates = documents.map((document) => ({
    ...document,
    candidateId: randomBytes(32).toString("base64url"),
  }));
  if (candidates.length > 0) {
    await db.insert(cloudResumeCandidates).values(candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      userId,
      provider,
      sourceId: candidate.sourceId,
      name: candidate.name,
      mimeType: candidate.mimeType,
      size: candidate.size,
      modifiedAt: candidate.modifiedAt ? new Date(candidate.modifiedAt) : null,
      expiresAt,
    })));
  }
  return candidates.map(({ sourceId: _sourceId, ...candidate }) => candidate);
}

export async function claimCloudResumeCandidate(
  userId: number,
  candidateId: string,
  now = new Date(),
) {
  const db = await getDb();
  if (!db) throw new Error("Cloud resume import requires a configured database.");
  return db.transaction(async (tx) => {
    const [candidate] = await tx.select().from(cloudResumeCandidates).where(and(
      eq(cloudResumeCandidates.candidateId, candidateId),
      eq(cloudResumeCandidates.userId, userId),
      gt(cloudResumeCandidates.expiresAt, now),
    )).limit(1).for("update");
    if (!candidate) return null;
    if (candidate.importLeaseUntil && candidate.importLeaseUntil > now) return null;
    await tx.update(cloudResumeCandidates).set({
      importLeaseUntil: new Date(now.getTime() + IMPORT_LEASE_MS),
    }).where(eq(cloudResumeCandidates.candidateId, candidateId));
    return candidate;
  });
}

export async function releaseCloudResumeCandidate(userId: number, candidateId: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(cloudResumeCandidates).set({ importLeaseUntil: null }).where(and(
    eq(cloudResumeCandidates.candidateId, candidateId),
    eq(cloudResumeCandidates.userId, userId),
  ));
}

export async function completeCloudResumeCandidate(userId: number, candidateId: string) {
  const db = await getDb();
  if (!db) throw new Error("Cloud resume import requires a configured database.");
  await db.delete(cloudResumeCandidates).where(and(
    eq(cloudResumeCandidates.candidateId, candidateId),
    eq(cloudResumeCandidates.userId, userId),
  ));
}

export async function cleanupExpiredCloudResumeCandidates(now = new Date()) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.delete(cloudResumeCandidates).where(lte(cloudResumeCandidates.expiresAt, now));
  return Number(result[0]?.affectedRows ?? 0);
}

export function startCloudResumeCandidateCleanup() {
  const run = () => {
    void cleanupExpiredCloudResumeCandidates().catch(() => {
      logOperationalFailure("Cloud resume candidates", "Expiry cleanup");
    });
  };
  const interval = setInterval(run, 5 * 60 * 1000);
  interval.unref();
  run();
  return () => clearInterval(interval);
}
