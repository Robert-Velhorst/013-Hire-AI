import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("session sign-in timestamp wiring", () => {
  it("records sign-in during OAuth or first-user synchronization, not every API request", () => {
    const oauth = readFileSync(
      resolve(process.cwd(), "server", "_core", "oauth.ts"),
      "utf8"
    );
    const sdk = readFileSync(
      resolve(process.cwd(), "server", "_core", "sdk.ts"),
      "utf8"
    );
    const authenticateBody = sdk.slice(
      sdk.indexOf("async authenticateRequest")
    );

    expect(oauth).toContain("lastSignedIn: new Date()");
    expect(authenticateBody.match(/lastSignedIn:\s*signedInAt/g)).toHaveLength(
      1
    );
    expect(authenticateBody).not.toContain(
      "openId: user.openId,\n      lastSignedIn: signedInAt"
    );
  });
});
