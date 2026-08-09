import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("profile match ledger batching", () => {
  it("uses bounded multi-row upserts with individual failure isolation fallback", () => {
    const ledger = readFileSync(resolve(process.cwd(), "server", "profileMatchLedger.ts"), "utf8");
    const database = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const batchWriter = database.slice(
      database.indexOf("export async function createCanonicalJobMatches"),
      database.indexOf("export async function getUserJobMatches")
    );

    expect(ledger).toContain("const MATCH_REFRESH_CONCURRENCY = 10");
    expect(ledger).toContain("await createCanonicalJobMatches(matches)");
    expect(ledger).toContain("await createJobMatch(match)");
    expect(batchWriter).toContain(".values(matches)");
    expect(batchWriter).toContain(".onDuplicateKeyUpdate({");
  });
});
