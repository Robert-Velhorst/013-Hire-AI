import { describe, expect, it, vi } from "vitest";
import { clearLegacyAuthUserInfo, LEGACY_AUTH_USER_INFO_KEY } from "./legacyAuthStorage";

describe("legacy auth storage migration", () => {
  it("removes the obsolete persisted identity record", () => {
    const storage = { removeItem: vi.fn() };

    clearLegacyAuthUserInfo(storage);

    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_AUTH_USER_INFO_KEY);
  });

  it("keeps the server-backed auth flow working when storage is unavailable", () => {
    const storage = { removeItem: vi.fn(() => { throw new Error("storage blocked"); }) };

    expect(() => clearLegacyAuthUserInfo(storage)).not.toThrow();
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_AUTH_USER_INFO_KEY);
  });
});
