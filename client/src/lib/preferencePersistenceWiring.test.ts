import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("preference persistence wiring", () => {
  it("uses validated server-side patches from every preference surface", () => {
    for (const page of ["Settings.tsx", "AIPreferences.tsx", "JobSearch.tsx"]) {
      const source = readFileSync(resolve(process.cwd(), `client/src/pages/${page}`), "utf8");
      expect(source).toContain("trpc.profile.updatePreferences.useMutation");
      expect(source).not.toContain("preferences: JSON.stringify");
    }
  });
});
