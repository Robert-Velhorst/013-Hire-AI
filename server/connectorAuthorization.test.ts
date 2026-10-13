import { describe, expect, it } from "vitest";
import { isAuthoritativeInvalidConnectorToken } from "./connectorAuthorization";

describe("connector token rejection classification", () => {
  it("treats 401 as an authentication rejection", () => {
    expect(isAuthoritativeInvalidConnectorToken(new Response(null, { status: 401 }))).toBe(true);
  });

  it("requires an explicit invalid_token challenge before treating 403 as revoked", () => {
    expect(isAuthoritativeInvalidConnectorToken(new Response(null, {
      status: 403,
      headers: { "www-authenticate": 'Bearer realm="api", error="invalid_token"' },
    }))).toBe(true);
    expect(isAuthoritativeInvalidConnectorToken(new Response(null, {
      status: 403,
      headers: { "www-authenticate": 'Bearer error="insufficient_scope"' },
    }))).toBe(false);
    expect(isAuthoritativeInvalidConnectorToken(new Response(null, { status: 403 }))).toBe(false);
  });

  it("does not classify unrelated errors as a revoked grant", () => {
    expect(isAuthoritativeInvalidConnectorToken(new Response(null, { status: 429 }))).toBe(false);
    expect(isAuthoritativeInvalidConnectorToken(new Response(null, { status: 503 }))).toBe(false);
  });
});
