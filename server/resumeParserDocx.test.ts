import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractTextFromDOCX } from "./resumeParser";

const fixture = readFileSync(new URL("./testFixtures/resume.docx", import.meta.url));

describe("DOCX resume extraction", () => {
  it("extracts candidate text through Mammoth's library API", async () => {
    const text = await extractTextFromDOCX(fixture);

    expect(text).toContain("Alex Example");
    expect(text).toContain("Skills: TypeScript, React");
  });
});
