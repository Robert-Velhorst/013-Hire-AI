import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getLoginUrl } from "../const";

describe("getLoginUrl", () => {
  it("always uses the server-owned same-origin initiation route", () => {
    expect(getLoginUrl()).toBe("/api/oauth/login");
  });

  it("does not embed a callback or provider portal in the browser URL", () => {
    expect(getLoginUrl()).not.toContain("callback");
    expect(getLoginUrl()).not.toContain("auth.example.test");
  });

  it("keeps build-time provider configuration and browser-generated state out of the login helper", () => {
    const source = readFileSync(resolve("client", "src", "const.ts"), "utf8");
    expect(source).not.toContain("VITE_OAUTH_PORTAL_URL");
    expect(source).not.toContain("window.location.origin");
    expect(source).not.toContain("btoa(");
  });
});
