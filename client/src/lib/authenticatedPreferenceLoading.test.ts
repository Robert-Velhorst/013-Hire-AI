import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function page(name: string) {
  return readFileSync(resolve(process.cwd(), `client/src/pages/${name}`), "utf8");
}

describe("authenticated preference loading", () => {
  it("keeps protected profile requests and saves behind authoritative auth and loading state", () => {
    const aiPreferences = page("AIPreferences.tsx");
    const settings = page("Settings.tsx");
    const jobSearch = page("JobSearch.tsx");

    expect(aiPreferences).toContain("enabled: isAuthenticated");
    expect(aiPreferences).toContain("isAuthenticated && profileLoading");
    expect(aiPreferences).toContain("useState(false)");
    expect(settings).toContain("isAuthenticated && profileLoading");
    expect(jobSearch).toContain("enabled: Boolean(user)");
    expect(jobSearch).toContain("Boolean(user) && !profileLoading");
  });
});
