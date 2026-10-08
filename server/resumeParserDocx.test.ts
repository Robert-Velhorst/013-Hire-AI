import { readFileSync } from "node:fs";
import mammoth from "mammoth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "@shared/documentUploads";
import { extractTextFromDOCX, parseResumeFromFile, ResumeInputLimitError } from "./resumeParser";

const fixture = readFileSync(new URL("./testFixtures/resume.docx", import.meta.url));
const oversizedFixture = readFileSync(new URL("./testFixtures/oversized-resume.docx", import.meta.url));
const misreportedFixture = readFileSync(new URL("./testFixtures/misreported-resume.docx", import.meta.url));

afterEach(() => vi.restoreAllMocks());

describe("DOCX resume extraction", () => {
  it("extracts candidate text through Mammoth's library API", async () => {
    const text = await extractTextFromDOCX(fixture);

    expect(text).toContain("Alex Example");
    expect(text).toContain("Skills: TypeScript, React");
  });

  it("rejects oversized ZIP expansion before Mammoth decompresses document parts", async () => {
    const extract = vi.spyOn(mammoth, "extractRawText");

    await expect(extractTextFromDOCX(oversizedFixture))
      .rejects.toBeInstanceOf(ResumeInputLimitError);
    expect(extract).not.toHaveBeenCalled();
  });

  it("enforces the expansion limit even when ZIP size metadata understates the actual output", async () => {
    const extract = vi.spyOn(mammoth, "extractRawText");

    await expect(extractTextFromDOCX(misreportedFixture))
      .rejects.toThrow("Failed to extract text from DOCX");
    expect(extract).not.toHaveBeenCalled();
  });

  it("rejects oversized source buffers before decoding or parsing", async () => {
    const extract = vi.spyOn(mammoth, "extractRawText");

    await expect(parseResumeFromFile(Buffer.alloc(MAX_DOCUMENT_UPLOAD_BYTES + 1), "text/plain"))
      .rejects.toBeInstanceOf(ResumeInputLimitError);
    expect(extract).not.toHaveBeenCalled();
  });

  it("enforces the file-size ceiling when the DOCX extractor is called directly", async () => {
    const extract = vi.spyOn(mammoth, "extractRawText");

    await expect(extractTextFromDOCX(Buffer.alloc(MAX_DOCUMENT_UPLOAD_BYTES + 1)))
      .rejects.toBeInstanceOf(ResumeInputLimitError);
    expect(extract).not.toHaveBeenCalled();
  });
});
