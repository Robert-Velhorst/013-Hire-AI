import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { stripeWebhookEvents } from "../drizzle/schema";

type WebhookStatus = "processing" | "processed" | "failed";
export const STRIPE_WEBHOOK_FAILURE_MESSAGE = "Webhook processing failed.";
const STALE_PROCESSING_MS = 10 * 60 * 1000;

const memoryEvents = new Map<string, {
  eventType: string;
  status: WebhookStatus;
  errorMessage: string | null;
  updatedAt: number;
}>();

function isDuplicateEventError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

export async function claimStripeWebhookEvent(eventId: string, eventType: string) {
  const db = await getDb();
  if (!db) {
    const existing = memoryEvents.get(eventId);
    if (existing?.eventType !== undefined && existing.eventType !== eventType) {
      throw new Error("Stripe event ID was received with conflicting event types.");
    }
    if (existing?.status === "processed" || (existing?.status === "processing" &&
      Date.now() - existing.updatedAt <= STALE_PROCESSING_MS)) {
      return { claimed: false, duplicate: true };
    }
    memoryEvents.set(eventId, { eventType, status: "processing", errorMessage: null, updatedAt: Date.now() });
    return { claimed: true, duplicate: false };
  }

  try {
    return await db.transaction(async tx => {
      const [existing] = await tx.select()
        .from(stripeWebhookEvents)
        .where(eq(stripeWebhookEvents.stripeEventId, eventId))
        .limit(1)
        .for("update");

      if (existing) {
        if (existing.eventType !== eventType) {
          throw new Error("Stripe event ID was received with conflicting event types.");
        }
        const staleProcessing = existing.status === "processing" && existing.updatedAt &&
          Date.now() - existing.updatedAt.getTime() > STALE_PROCESSING_MS;
        if (existing.status !== "failed" && !staleProcessing) {
          return { claimed: false, duplicate: true };
        }
        await tx.update(stripeWebhookEvents)
          .set({ status: "processing", errorMessage: null, processedAt: null })
          .where(eq(stripeWebhookEvents.id, existing.id));
        return { claimed: true, duplicate: false };
      }

      try {
        await tx.insert(stripeWebhookEvents).values({ stripeEventId: eventId, eventType, status: "processing" });
        return { claimed: true, duplicate: false };
      } catch (error) {
        if (isDuplicateEventError(error)) return { claimed: false, duplicate: true };
        throw error;
      }
    });
  } catch (error) {
    if (isDuplicateEventError(error)) return { claimed: false, duplicate: true };
    throw error;
  }
}

export async function completeStripeWebhookEvent(eventId: string) {
  const db = await getDb();
  if (!db) {
    const event = memoryEvents.get(eventId);
    if (event) {
      event.status = "processed";
      event.updatedAt = Date.now();
    }
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
      event.updatedAt = Date.now();
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
