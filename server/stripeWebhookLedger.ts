import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { stripeWebhookEvents } from "../drizzle/schema";

type WebhookStatus = "processing" | "processed" | "failed";
export const STRIPE_WEBHOOK_FAILURE_MESSAGE = "Webhook processing failed.";

const memoryEvents = new Map<string, { eventType: string; status: WebhookStatus; errorMessage: string | null }>();

function isDuplicateEventError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

export async function claimStripeWebhookEvent(eventId: string, eventType: string) {
  const db = await getDb();
  if (!db) {
    const existing = memoryEvents.get(eventId);
    if (existing?.status === "processed" || existing?.status === "processing") {
      return { claimed: false, duplicate: true };
    }
    memoryEvents.set(eventId, { eventType, status: "processing", errorMessage: null });
    return { claimed: true, duplicate: false };
  }

  const existing = await db
    .select()
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.stripeEventId, eventId))
    .limit(1);
  if (existing[0]) {
    if (existing[0].status === "failed") {
      await db.update(stripeWebhookEvents)
        .set({ status: "processing", errorMessage: null, processedAt: null })
        .where(eq(stripeWebhookEvents.id, existing[0].id));
      return { claimed: true, duplicate: false };
    }
    return { claimed: false, duplicate: true };
  }

  try {
    await db.insert(stripeWebhookEvents).values({ stripeEventId: eventId, eventType, status: "processing" });
    return { claimed: true, duplicate: false };
  } catch (error) {
    // A concurrent delivery may have inserted the unique event id after the read.
    if (isDuplicateEventError(error)) {
      return { claimed: false, duplicate: true };
    }
    throw error;
  }
}

export async function completeStripeWebhookEvent(eventId: string) {
  const db = await getDb();
  if (!db) {
    const event = memoryEvents.get(eventId);
    if (event) event.status = "processed";
    return;
  }
  await db.update(stripeWebhookEvents)
    .set({ status: "processed", processedAt: new Date(), errorMessage: null })
    .where(eq(stripeWebhookEvents.stripeEventId, eventId));
}

export async function failStripeWebhookEvent(eventId: string, _error: unknown) {
  const errorMessage = STRIPE_WEBHOOK_FAILURE_MESSAGE;
  const db = await getDb();
  if (!db) {
    const event = memoryEvents.get(eventId);
    if (event) {
      event.status = "failed";
      event.errorMessage = errorMessage;
    }
    return;
  }
  await db.update(stripeWebhookEvents)
    .set({ status: "failed", errorMessage })
    .where(eq(stripeWebhookEvents.stripeEventId, eventId));
}

export function clearStripeWebhookLedgerForTests() {
  memoryEvents.clear();
}
