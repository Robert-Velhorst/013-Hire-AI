import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptConnectorToken: vi.fn(() => "access-token"),
  encryptConnectorToken: vi.fn((value: string) => value),
  getConnectorAuthorization: vi.fn(),
  getConnectorOAuthConfig: vi.fn(),
  getDb: vi.fn(),
  getUserConnectorAccount: vi.fn(),
  refreshConnectorAccessToken: vi.fn(),
  upsertConnectorAuthorization: vi.fn(),
  upsertUserConnectorAccount: vi.fn(),
}));

vi.mock("./db", () => ({
  getConnectorAuthorization: mocks.getConnectorAuthorization,
  getDb: mocks.getDb,
  getUserConnectorAccount: mocks.getUserConnectorAccount,
  upsertConnectorAuthorization: mocks.upsertConnectorAuthorization,
  upsertUserConnectorAccount: mocks.upsertUserConnectorAccount,
}));

vi.mock("./connectorOAuth", () => ({
  decryptConnectorToken: mocks.decryptConnectorToken,
  encryptConnectorToken: mocks.encryptConnectorToken,
  getConnectorOAuthConfig: mocks.getConnectorOAuthConfig,
  refreshConnectorAccessToken: mocks.refreshConnectorAccessToken,
}));

import { sendApprovedFollowUp } from "./followUpMailDelivery";

function createSelectQuery(rows: unknown[][]) {
  return () => ({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => rows.shift() ?? [] }),
        }),
        where: () => ({ limit: async () => rows.shift() ?? [] }),
      }),
      where: () => ({
        orderBy: () => ({ limit: async () => rows.shift() ?? [] }),
        limit: async () => rows.shift() ?? [],
      }),
    }),
  });
}

describe("uncertain follow-up mailbox delivery", () => {
  it("records an explicit unknown delivery state and blocks retries after a transport failure", async () => {
    const selectedRows: unknown[][] = [
      [{
        followUpId: 41,
        applicationId: 73,
        message: "Hello,\n\nI wanted to follow up.",
        sentDate: null,
        deliveryState: "draft",
        applicationStatus: "applied",
        jobTitle: "Product Engineer",
        company: "Example Co",
      }],
      [{ id: 89, status: "approved" }],
      [{ applicationId: 73 }],
    ];
    const where = vi.fn(async () => [{ affectedRows: 1 }]);
    const set = vi.fn(() => ({ where }));
    const values = vi.fn(async () => [{ insertId: 1 }]);
    const tx = {
      select: createSelectQuery(selectedRows),
      update: vi.fn(() => ({ set })),
      insert: vi.fn(() => ({ values })),
    };
    mocks.getDb.mockResolvedValue({ transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx) });

    await expect(sendApprovedFollowUp({
      followUpId: 41,
      userId: 11,
      provider: "gmail",
      recipient: "recruiter@example.com",
    }, {
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network timeout: Bearer provider-secret")),
      dependencies: {
        decryptConnectorToken: mocks.decryptConnectorToken,
        encryptConnectorToken: mocks.encryptConnectorToken,
        getConnectorAuthorization: mocks.getConnectorAuthorization.mockResolvedValue({
          encryptedAccessToken: "encrypted-access-token",
          encryptedRefreshToken: null,
          accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
        getConnectorOAuthConfig: mocks.getConnectorOAuthConfig,
        getUserConnectorAccount: mocks.getUserConnectorAccount.mockResolvedValue({
          provider: "gmail",
          status: "connected",
          consentScopes: JSON.stringify(["email.messages.send"]),
          lastVerifiedAt: new Date(),
        }),
        refreshConnectorAccessToken: mocks.refreshConnectorAccessToken,
        upsertConnectorAuthorization: mocks.upsertConnectorAuthorization,
        upsertUserConnectorAccount: mocks.upsertUserConnectorAccount,
      },
    })).rejects.toThrow(/outcome is uncertain.*do not retry/i);

    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({
      deliveryState: "unknown",
      deliveryFailureMessage: "Mailbox delivery could not be completed.",
    }));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      action: "follow_up_mail_delivery_uncertain",
      entityId: 73,
      riskLevel: "high",
    }));
    expect(JSON.parse(values.mock.calls[0][0].afterState)).toMatchObject({
      followUpId: 41,
      reason: "Mailbox delivery could not be completed.",
      externalMessageSent: "unknown",
      retryBlocked: true,
    });
    expect(JSON.stringify(values.mock.calls[0][0])).not.toContain("provider-secret");
  });
});
