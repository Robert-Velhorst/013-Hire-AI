import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./_core/cookies";

describe("session cookie options", () => {
  it("uses lax cookies on local non-secure requests so browsers keep the session", () => {
    const options = getSessionCookieOptions({
      secure: false,
    } as Request);

    expect(options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
  });

  it("uses secure lax cookies on trusted HTTPS requests", () => {
    const options = getSessionCookieOptions({
      secure: true,
    } as Request);

    expect(options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("does not trust a forwarded protocol on an otherwise insecure request", () => {
    const options = getSessionCookieOptions({
      secure: false,
      headers: { "x-forwarded-proto": "https" },
    } as unknown as Request);

    expect(options).toMatchObject({ secure: false, sameSite: "lax" });
  });
});
