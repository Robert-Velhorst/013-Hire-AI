import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { successFeesRouter } from "./routers/successFees";
import { adminRouter } from "./routers/admin";

const mocks = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  createAuditEvent: vi.fn(),
  storageGet: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./db")>(),
  createAuditEvent: mocks.createAuditEvent,
  getDb: mocks.getDb,
}));

vi.mock("./storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("./storage")>(),
  storageGet: mocks.storageGet,
}));

function createContext(userId: number, role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `private-download-${userId}`,
      name: "Private Download User",
      email: `private-download-${userId}@example.local`,
      loginMethod: "test",
      role,
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("private document download routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: mocks.selectLimit })),
        })),
      })),
    });
    mocks.storageGet.mockResolvedValue({
      key: "private/document.pdf",
      url: "https://storage.example.local/signed/document.pdf",
    });
  });

  it("returns and audits an owner-authorized offer-letter URL", async () => {
    mocks.selectLimit.mockResolvedValue([{ id: 41, offerLetterKey: "offer-letters/41/offer.pdf" }]);
    const caller = successFeesRouter.createCaller(createContext(91));

    await expect(caller.getOfferLetterDownloadUrl({ successFeeId: 41 })).resolves.toEqual({
      url: "https://storage.example.local/signed/document.pdf",
    });
    expect(mocks.storageGet).toHaveBeenCalledWith("offer-letters/41/offer.pdf");
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 91,
      entityId: 41,
      actor: "user",
    }));
  });

  it("does not request storage when the fee ownership query finds no document", async () => {
    mocks.selectLimit.mockResolvedValue([]);
    const caller = successFeesRouter.createCaller(createContext(92));

    await expect(caller.getOfferLetterDownloadUrl({ successFeeId: 41 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.storageGet).not.toHaveBeenCalled();
  });

  it("returns and audits an administrator-authorized verification URL", async () => {
    mocks.selectLimit.mockResolvedValue([{
      id: 72,
      userId: 93,
      documentKey: "verifications/93/proof.pdf",
    }]);
    const caller = adminRouter.createCaller(createContext(7, "admin"));

    await expect(caller.getVerificationDocumentDownloadUrl({ verificationId: 72 })).resolves.toEqual({
      url: "https://storage.example.local/signed/document.pdf",
    });
    expect(mocks.storageGet).toHaveBeenCalledWith("verifications/93/proof.pdf");
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 93,
      entityId: 72,
      actor: "admin",
    }));
  });
});
