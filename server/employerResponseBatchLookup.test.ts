import { describe, expect, it } from "vitest";
import {
  createEmployerResponse,
  findEmployerResponseSourceReferences,
} from "./db";

describe("employer response source-reference batch lookup", () => {
  it("deduplicates requested references and keeps results owner scoped", async () => {
    const ownerId = 970_001;
    const otherUserId = 970_002;
    const recordedReference = "gmail:batch-recorded-970001";
    const otherUserReference = "gmail:batch-other-970002";
    const response = {
      applicationId: 980_001,
      responseType: "other" as const,
      source: "email" as const,
      summary: "Batch lookup contract fixture.",
      receivedAt: new Date("2026-08-09T10:00:00.000Z"),
      statusBefore: "applied" as const,
      statusAfter: "applied" as const,
    };
    await createEmployerResponse({
      ...response,
      userId: ownerId,
      sourceReference: recordedReference,
    });
    await createEmployerResponse({
      ...response,
      applicationId: 980_002,
      userId: otherUserId,
      sourceReference: otherUserReference,
    });

    await expect(findEmployerResponseSourceReferences({
      userId: ownerId,
      source: "email",
      sourceReferences: [recordedReference, recordedReference, otherUserReference, "gmail:new"],
    })).resolves.toEqual([recordedReference]);
  });

  it("returns immediately for an empty reference set", async () => {
    await expect(findEmployerResponseSourceReferences({
      userId: 970_003,
      source: "email",
      sourceReferences: [],
    })).resolves.toEqual([]);
  });
});
