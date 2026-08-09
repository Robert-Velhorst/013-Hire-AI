import { describe, expect, it } from "vitest";
import {
  createApplication,
  getPendingInboxResponseCandidatePage,
  listPendingInboxResponseCandidates,
  resolveInboxResponseCandidateBySourceReference,
  upsertInboxResponseCandidate,
} from "./db";
import { sampleJobs } from "./sampleData";

describe("inbox response candidate ledger", () => {
  it("deduplicates candidate discovery and removes a dismissed message from the pending queue", async () => {
    const userId = 99701;
    const input = {
      userId,
      applicationId: 1,
      provider: "gmail" as const,
      messageId: "candidate-99701",
      sender: "recruiter@example.test",
      subject: "Interview invitation",
      preview: "Can we schedule a first interview?",
      receivedAt: new Date("2026-07-13T12:00:00.000Z"),
      suggestedResponseType: "interview_invite" as const,
      confidence: "high" as const,
    };

    expect((await upsertInboxResponseCandidate(input)).existing).toBe(false);
    expect((await upsertInboxResponseCandidate(input)).existing).toBe(true);
    await expect(listPendingInboxResponseCandidates(userId)).resolves.toEqual([
      expect.objectContaining({ messageId: "candidate-99701", status: "pending" }),
    ]);

    await expect(resolveInboxResponseCandidateBySourceReference({
      userId,
      provider: "gmail",
      messageId: "candidate-99701",
      status: "dismissed",
    })).resolves.toEqual(expect.objectContaining({ status: "dismissed" }));
    await expect(resolveInboxResponseCandidateBySourceReference({
      userId,
      provider: "gmail",
      messageId: "candidate-99701",
      status: "confirmed",
    })).resolves.toEqual(expect.objectContaining({ status: "dismissed" }));
    await expect(listPendingInboxResponseCandidates(userId)).resolves.toEqual([]);
  });

  it("keeps an exact owner-scoped total while bounding the operating page", async () => {
    const userId = 99702;
    const otherUserId = 99703;
    for (let index = 0; index < 103; index += 1) {
      const application = await createApplication({
        userId,
        jobId: index === 102 ? sampleJobs[0].id : 20_000 + index,
        status: "applied",
      });
      await upsertInboxResponseCandidate({
        userId,
        applicationId: Number(application.insertId),
        provider: "gmail",
        messageId: `candidate-99702-${index}`,
        receivedAt: new Date(1_800_000_000_000 + index),
        suggestedResponseType: "other",
        confidence: "medium",
      });
    }
    const foreignApplication = await createApplication({
      userId: otherUserId,
      jobId: 30_000,
      status: "applied",
    });
    await upsertInboxResponseCandidate({
      userId: otherUserId,
      applicationId: Number(foreignApplication.insertId),
      provider: "outlook",
      messageId: "candidate-other-owner",
      receivedAt: new Date(1_900_000_000_000),
      suggestedResponseType: "other",
      confidence: "medium",
    });

    await expect(getPendingInboxResponseCandidatePage(userId)).resolves.toMatchObject({
      total: 103,
      limit: 100,
      hasMore: true,
      items: expect.any(Array),
    });
    const page = await getPendingInboxResponseCandidatePage(userId, 3);
    expect(page.items).toHaveLength(3);
    expect(page.items.every((candidate) => candidate.userId === userId)).toBe(true);
    expect(page.items.map((candidate) => candidate.messageId)).toEqual([
      "candidate-99702-102",
      "candidate-99702-101",
      "candidate-99702-100",
    ]);
    expect(page.items[0].job).toMatchObject({
      id: sampleJobs[0].id,
      title: sampleJobs[0].title,
      company: sampleJobs[0].company,
    });
  });
});
