import { describe, expect, it } from "vitest";
import {
  createAdminReviewItem,
  createAuditEvent,
  getAuditEventsForEntity,
  getAuditEventsForUser,
  getUserAdminReviewPage,
  listActiveAdminReviewItemsForEntity,
  listAdminReviewItems,
  listUserAdminReviewItems,
  resolveAdminReviewItem,
} from "./db";

describe("audit and admin review ledger", () => {
  it("records audit events for a user-owned entity", async () => {
    const userId = 97001;
    const entityId = 12345;

    await createAuditEvent({
      userId,
      entityType: "application",
      entityId,
      action: "application_submission_confirmed",
      actor: "user",
      source: "test",
      riskLevel: "high",
      afterState: JSON.stringify({ status: "applied" }),
    });

    const events = await getAuditEventsForEntity(userId, "application", entityId);

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("application_submission_confirmed");
    expect(events[0].riskLevel).toBe("high");
  });

  it("lists recent audit events for one user without leaking other users", async () => {
    const userId = 97003;
    const otherUserId = 97004;

    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: 1,
      action: "application_prepared",
      actor: "system",
      source: "test",
      riskLevel: "medium",
    });
    await createAuditEvent({
      userId,
      entityType: "application",
      entityId: 2,
      action: "approval_requested",
      actor: "system",
      source: "test",
      riskLevel: "high",
    });
    await createAuditEvent({
      userId: otherUserId,
      entityType: "application",
      entityId: 3,
      action: "other_user_event",
      actor: "system",
      source: "test",
      riskLevel: "low",
    });

    const events = await getAuditEventsForUser(userId, 10);

    expect(events.map((event) => event.userId).every((id) => id === userId)).toBe(true);
    expect(events.map((event) => event.action)).toEqual(
      expect.arrayContaining(["application_prepared", "approval_requested"])
    );
    expect(events.some((event) => event.action === "other_user_event")).toBe(false);
  });

  it("keeps one open review item per user/entity/category and resolves it", async () => {
    const userId = 97002;
    const entityId = 54321;

    const first = await createAdminReviewItem({
      userId,
      entityType: "application",
      entityId,
      category: "application_review",
      priority: "medium",
      title: "Review prepared application",
      description: "Initial review required.",
    });
    const second = await createAdminReviewItem({
      userId,
      entityType: "application",
      entityId,
      category: "application_review",
      priority: "high",
      title: "High-risk prepared application",
      description: "Updated review reason.",
    });

    const openItems = await listAdminReviewItems("open");
    const item = openItems.find((review) => review.id === Number(first.insertId));

    expect(second.existing).toBe(true);
    expect(item?.priority).toBe("high");
    expect(item?.title).toBe("High-risk prepared application");

    await resolveAdminReviewItem(Number(first.insertId), 1, "resolved", "Reviewed and approved.");

    const remainingOpenItems = await listAdminReviewItems("open");
    expect(remainingOpenItems.some((review) => review.id === Number(first.insertId))).toBe(false);
  });

  it("bounds user review reads without exposing other users or closed statuses", async () => {
    const userId = 97005;
    const otherUserId = 97006;
    await createAdminReviewItem({
      userId,
      entityType: "application",
      entityId: 1,
      category: "application_review",
      status: "open",
      priority: "medium",
      title: "Open user review",
    });
    await createAdminReviewItem({
      userId,
      entityType: "application",
      entityId: 2,
      category: "submission_evidence",
      status: "in_progress",
      priority: "high",
      title: "In-progress user review",
    });
    await createAdminReviewItem({
      userId,
      entityType: "application",
      entityId: 3,
      category: "employer_response",
      status: "resolved",
      priority: "low",
      title: "Closed user review",
    });
    await createAdminReviewItem({
      userId: otherUserId,
      entityType: "application",
      entityId: 4,
      category: "application_review",
      status: "open",
      priority: "critical",
      title: "Other user review",
    });

    const activeReviews = await listUserAdminReviewItems(userId);
    const limitedReviews = await listUserAdminReviewItems(userId, ["open", "in_progress"], 1);

    expect(activeReviews).toHaveLength(2);
    expect(activeReviews.every((review) => review.userId === userId)).toBe(true);
    expect(activeReviews.every((review) => ["open", "in_progress"].includes(review.status))).toBe(true);
    expect(activeReviews.some((review) => review.title === "Closed user review")).toBe(false);
    expect(activeReviews.some((review) => review.title === "Other user review")).toBe(false);
    expect(limitedReviews).toHaveLength(1);
  });

  it("loads active reviews for one owned entity without scanning unrelated reviews", async () => {
    const userId = 97007;
    const otherUserId = 97008;
    const targetVerificationId = 88001;
    const target = await createAdminReviewItem({
      userId,
      entityType: "verification",
      entityId: targetVerificationId,
      category: "verification_overdue",
      status: "open",
      priority: "high",
      title: "Target verification review",
    });
    await createAdminReviewItem({
      userId,
      entityType: "verification",
      entityId: 88002,
      category: "verification_overdue",
      status: "open",
      priority: "medium",
      title: "Different verification review",
    });
    await createAdminReviewItem({
      userId: otherUserId,
      entityType: "verification",
      entityId: targetVerificationId,
      category: "verification_overdue",
      status: "open",
      priority: "critical",
      title: "Other user's verification review",
    });

    const reviews = await listActiveAdminReviewItemsForEntity(
      userId,
      "verification",
      targetVerificationId
    );

    expect(reviews.map((review) => review.id)).toEqual([Number(target.insertId)]);
    expect(reviews[0]).toMatchObject({
      userId,
      entityType: "verification",
      entityId: targetVerificationId,
      status: "open",
    });
  });

  it("returns an exact owned total with a bounded active review page", async () => {
    const userId = 97009;
    const otherUserId = 97010;

    await Promise.all(
      Array.from({ length: 105 }, (_, index) =>
        createAdminReviewItem({
          userId,
          entityType: "application",
          entityId: 99000 + index,
          category: "application_review",
          status: index % 2 === 0 ? "open" : "in_progress",
          priority: "medium",
          title: `Owned review ${index + 1}`,
        })
      )
    );
    await createAdminReviewItem({
      userId: otherUserId,
      entityType: "application",
      entityId: 99105,
      category: "application_review",
      status: "open",
      priority: "critical",
      title: "Other user review",
    });
    await createAdminReviewItem({
      userId,
      entityType: "application",
      entityId: 99106,
      category: "application_review",
      status: "resolved",
      priority: "low",
      title: "Resolved owned review",
    });

    const page = await getUserAdminReviewPage(userId, ["open", "in_progress"], 100);

    expect(page).toMatchObject({ total: 105, limit: 100, hasMore: true });
    expect(page.items).toHaveLength(100);
    expect(page.items.every((review) => review.userId === userId)).toBe(true);
    expect(page.items.every((review) => ["open", "in_progress"].includes(review.status))).toBe(true);
    expect(page.items.some((review) => review.title === "Other user review")).toBe(false);
    expect(page.items.some((review) => review.title === "Resolved owned review")).toBe(false);
  });
});
