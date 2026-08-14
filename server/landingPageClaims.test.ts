import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public landing-page claims", () => {
  it("keeps outcome claims review-first and free of invented social proof", () => {
    const landing = readFileSync(resolve(process.cwd(), "client", "src", "pages", "LandingPage.tsx"), "utf8");
    const landingCopy = readFileSync(resolve(process.cwd(), "client", "src", "lib", "landingCopy.ts"), "utf8");
    const publicCopy = `${landing}\n${landingCopy}`;

    expect(landing).toContain('useLocale()');
    expect(landing).toContain('setLocale(language)');
    expect(landing).toContain('lp("heroTitle")');
    expect(publicCopy).toContain("does not silently submit applications");
    expect(publicCopy).toContain("review-gated handoff");
    expect(publicCopy).not.toMatch(/\b\d{1,3}(?:,\d{3})+\+?\s+(?:job seekers|users|people hired|applications)/i);
    expect(publicCopy).not.toMatch(/(?:testimonial|what our users say|success stor(?:y|ies))/i);
  });
});
