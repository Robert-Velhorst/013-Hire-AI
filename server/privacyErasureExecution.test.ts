import { beforeEach, describe, expect, it, vi } from "vitest";
import { applicationAttempts, privacyErasureRuns, privacyErasureTasks, userProfiles, userResumes } from "../drizzle/schema";
import { PRIVACY_RETENTION_POLICY_VERSION } from "./privacyRetention";
import { executePrivacyErasureCleanup, privacyErasureConfirmation } from "./privacyErasureExecution";
import { finalizePrivacyErasure, privacyDatabaseErasureConfirmation } from "./privacyErasureFinalization";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./connectorDisconnect", () => ({ disconnectConnectorAccess: vi.fn() }));

// The executor and storage validation are real. This database boundary double
// models one cleanup task; it does not establish SQL authorization or lease safety.
function setupCleanup(source: "user_profiles" | "user_resumes" | "application_attempts", key: string | null) {
  const date = new Date("2026-09-06T00:00:00Z");
  const run: typeof privacyErasureRuns.$inferSelect = {
    id: 1, userId: 7, reviewItemId: 1, requestedByAdminId: 10,
    policyVersion: PRIVACY_RETENTION_POLICY_VERSION, status: "planned", inventorySnapshot: "{}",
    failureSummary: null, executionLeaseId: null, executionLeaseExpiresAt: null,
    completedAt: null, createdAt: date, updatedAt: date,
  };
  const task: typeof privacyErasureTasks.$inferSelect = {
    id: 1, runId: 1, userId: 7, taskKey: "synthetic-cleanup", kind: "private_object_delete",
    sourceTable: source, sourceRecordId: 1,
    sourceColumn: source === "user_profiles" ? "resume_file_key" : source === "user_resumes" ? "file_key" : "screenshot_key",
    provider: null, status: "pending", attemptCount: 0, lastErrorCode: null,
    completionEvidence: null, lastAttemptAt: null, completedAt: null, createdAt: date, updatedAt: date,
  };
  const database = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = table === privacyErasureRuns ? [run]
            : table === privacyErasureTasks ? [task]
            : [userProfiles, userResumes, applicationAttempts].includes(table as never) ? [{ key }]
            : (() => { throw new Error("Unexpected test query"); })();
          return Object.assign(Promise.resolve(rows), { limit: async () => rows });
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          const target = table === privacyErasureRuns ? run : task;
          for (const field of ["status", "lastErrorCode", "completedAt"] as const) {
            if (field in patch) Object.assign(target, { [field]: patch[field] });
          }
          return [{ affectedRows: 1 }];
        },
      }),
    }),
  };
  mocks.getDb.mockResolvedValue(database);
  const deleteObject = vi.fn(async (key: string) => ({ key }));
  const disconnect = vi.fn();
  return {
    task, deleteObject, disconnect,
    execute: () => executePrivacyErasureCleanup(1, privacyErasureConfirmation(7, run.policyVersion), { deleteObject, disconnect }),
  };
}

describe("privacy erasure object ownership", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["user_profiles", "resumes/8/private.pdf"],
    ["user_resumes", "resumes/70/private.pdf"],
    ["application_attempts", "attempts/8/private.png"],
    ["user_profiles", "offers/7/retained.pdf"],
    ["user_profiles", "resumes/7/../8/private.pdf"],
    ["user_profiles", "resumes/7/%2e%2e/8/private.pdf"],
    ["user_profiles", "resumes/7/"],
    ["user_profiles", ""],
  ] as const)("does not delete an unowned or unsafe object from %s: %s", async (source, key) => {
    const fixture = setupCleanup(source, key);

    const result = await fixture.execute();

    expect(fixture.deleteObject).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(fixture.task.status).toBe("failed");
    expect(fixture.task.completedAt).toBeNull();
    expect(["private_object_owner_mismatch", "storage_delete_failed"]).toContain(fixture.task.lastErrorCode);
    expect(fixture.disconnect).not.toHaveBeenCalled();
    await expect(finalizePrivacyErasure(
      1, privacyDatabaseErasureConfirmation(7, PRIVACY_RETENTION_POLICY_VERSION)
    )).rejects.toThrow("finalization cannot run from status failed");
  });

  it.each([
    ["user_profiles", "resumes/7/private.pdf"],
    ["user_resumes", "/resumes/7/private.pdf"],
    ["application_attempts", "attempts/7/private.png"],
  ] as const)("deletes the canonical owned object from %s", async (source, key) => {
    const fixture = setupCleanup(source, key);

    const result = await fixture.execute();

    expect(fixture.deleteObject).toHaveBeenCalledExactlyOnceWith(key.replace(/^\//, ""));
    expect(result.status).toBe("ready_for_database");
    expect(fixture.task.status).toBe("completed");
    expect(fixture.task.completedAt).toBeInstanceOf(Date);
  });

  it("rejects a task owner that differs from its run even when its key matches that task", async () => {
    const fixture = setupCleanup("user_profiles", "resumes/8/private.pdf");
    fixture.task.userId = 8;

    const result = await fixture.execute();

    expect(fixture.deleteObject).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
  });

  it.each([null, 0, -1, 1.5])("does not treat invalid source identity %s as completed cleanup", async (id) => {
    const fixture = setupCleanup("user_profiles", "resumes/7/private.pdf");
    fixture.task.sourceRecordId = id;

    const result = await fixture.execute();

    expect(fixture.deleteObject).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
  });

  it("does not revoke provider access for a mismatched task owner", async () => {
    const fixture = setupCleanup("user_profiles", null);
    fixture.task.kind = "provider_revoke";
    fixture.task.provider = "dropbox";
    fixture.task.userId = 8;

    const result = await fixture.execute();

    expect(fixture.disconnect).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(fixture.task.lastErrorCode).toBe("privacy_task_owner_mismatch");
  });

  it("retains a failed storage task for a guarded retry", async () => {
    const fixture = setupCleanup("user_profiles", "resumes/7/private.pdf");
    fixture.deleteObject.mockRejectedValueOnce(new Error("Provider rejected private-key-secret"));

    expect((await fixture.execute()).status).toBe("failed");
    expect(fixture.task.lastErrorCode).toBe("storage_delete_failed");
    expect(fixture.task.completedAt).toBeNull();

    expect((await fixture.execute()).status).toBe("ready_for_database");
    expect(fixture.deleteObject).toHaveBeenCalledTimes(2);
    expect(fixture.task.lastErrorCode).toBeNull();
    expect(fixture.task.status).toBe("completed");
  });

  it("allows an already-cleared key without a storage request", async () => {
    const fixture = setupCleanup("user_profiles", null);

    const result = await fixture.execute();

    expect(fixture.deleteObject).not.toHaveBeenCalled();
    expect(result.status).toBe("ready_for_database");
  });
});
