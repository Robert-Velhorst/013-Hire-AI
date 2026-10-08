import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "@shared/documentUploads";
import { PDFParse, type TextResult } from "pdf-parse";
import { extractTextFromPDF, MAX_RESUME_PDF_PAGES, ResumeInputLimitError } from "./resumeParser";

const fixture = readFileSync(new URL("./testFixtures/resume.pdf", import.meta.url));

afterEach(() => vi.restoreAllMocks());

describe("PDF resume extraction", () => {
  it("extracts text from both pages with the installed PDF parser", async () => {
    const original = Buffer.from(fixture);
    const text = await extractTextFromPDF(fixture);

    expect(text).toContain("Alex Example");
    expect(text).toContain("Skills: TypeScript, React, PostgreSQL");
    expect(text).toContain("Experience: Software Engineer at Example Company");
    expect(text).toContain("Education: Computer Science");
    expect(fixture.equals(original)).toBe(true);
  });

  it("destroys the parser after successful extraction", async () => {
    const destroy = vi.spyOn(PDFParse.prototype, "destroy");
    await extractTextFromPDF(fixture);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("returns no synthetic page labels for an empty PDF page", async () => {
    const blank = readFileSync(new URL("./testFixtures/blank-resume.pdf", import.meta.url));
    expect((await extractTextFromPDF(blank)).trim()).toBe("");
  });

  it("limits PDF text extraction to the maximum resume page count plus one", async () => {
    const getText = vi.spyOn(PDFParse.prototype, "getText").mockResolvedValue({
      pages: [],
      text: "",
      total: MAX_RESUME_PDF_PAGES + 1,
    } as TextResult);
    const destroy = vi.spyOn(PDFParse.prototype, "destroy");

    await expect(extractTextFromPDF(fixture)).rejects.toBeInstanceOf(ResumeInputLimitError);
    expect(getText).toHaveBeenCalledWith({ first: MAX_RESUME_PDF_PAGES + 1, pageJoiner: "" });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects extracted text above the shared resume limit", async () => {
    vi.spyOn(PDFParse.prototype, "getText").mockResolvedValue({
      pages: [],
      text: "x".repeat(500_001),
      total: 1,
    } as TextResult);

    await expect(extractTextFromPDF(fixture)).rejects.toBeInstanceOf(ResumeInputLimitError);
  });

  it("rejects oversized PDF buffers before initializing the parser", async () => {
    const getText = vi.spyOn(PDFParse.prototype, "getText");

    await expect(extractTextFromPDF(Buffer.alloc(MAX_DOCUMENT_UPLOAD_BYTES + 1)))
      .rejects.toBeInstanceOf(ResumeInputLimitError);
    expect(getText).not.toHaveBeenCalled();
  });

  it("destroys the parser and returns a safe error for malformed documents", async () => {
    const destroy = vi.spyOn(PDFParse.prototype, "destroy");
    await expect(extractTextFromPDF(Buffer.from("not a PDF")))
      .rejects.toThrow("Failed to extract text from PDF");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("does not expose provider exceptions or cleanup errors", async () => {
    vi.spyOn(PDFParse.prototype, "getText").mockRejectedValue(new Error("private document text"));
    const destroy = vi.spyOn(PDFParse.prototype, "destroy")
      .mockRejectedValue(new Error("private cleanup details"));
    await expect(extractTextFromPDF(fixture))
      .rejects.toThrow(/^Failed to extract text from PDF$/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
