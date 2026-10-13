import { invokeLLM } from "./_core/llm";
import { MAX_DOCUMENT_UPLOAD_BYTES, MAX_RESUME_TEXT_CHARS } from "@shared/documentUploads";
import mammoth from "mammoth";
import yauzl from "yauzl";
import { validateGitHubUrl, validateLinkedInUrl, validatePortfolioUrl } from "./socialConnections";
import { logOperationalFailure } from "./operationalFailureLog";

/**
 * AI-powered resume parsing service
 * Extracts structured data from resume text, PDF, and DOCX files using LLM
 */

export const MAX_RESUME_PDF_PAGES = 60;
const MAX_DOCX_ARCHIVE_ENTRIES = 2_048;
const MAX_DOCX_EXPANDED_BYTES = 20 * 1024 * 1024;

export class ResumeInputLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeInputLimitError";
  }
}

function assertResumeFileSize(buffer: Buffer): void {
  if (buffer.byteLength > MAX_DOCUMENT_UPLOAD_BYTES) {
    throw new ResumeInputLimitError("Resume files must be 10 MB or smaller.");
  }
}

async function validateDocxArchive(buffer: Buffer): Promise<void> {
  const archive = await yauzl.fromBufferPromise(buffer, {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
  });

  try {
    if (archive.entryCount > MAX_DOCX_ARCHIVE_ENTRIES) {
      throw new ResumeInputLimitError("DOCX contains too many archive entries.");
    }

    let declaredExpandedBytes = 0;
    let actualExpandedBytes = 0;
    let hasDocument = false;
    let hasContentTypes = false;
    const names = new Set<string>();

    for await (const entry of archive.eachEntry()) {
      if (names.has(entry.fileName)) {
        throw new Error("DOCX contains duplicate archive entries.");
      }
      names.add(entry.fileName);

      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new Error("DOCX uses an unsupported archive encoding.");
      }
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw new Error("DOCX contains invalid archive sizes.");
      }

      declaredExpandedBytes += entry.uncompressedSize;
      if (declaredExpandedBytes > MAX_DOCX_EXPANDED_BYTES) {
        throw new ResumeInputLimitError("DOCX expands beyond the supported size limit.");
      }

      hasDocument ||= entry.fileName === "word/document.xml";
      hasContentTypes ||= entry.fileName === "[Content_Types].xml";

      // ZIP size headers are untrusted; count inflated bytes before Mammoth sees the archive.
      const stream = await archive.openReadStreamPromise(entry);
      for await (const chunk of stream) {
        actualExpandedBytes += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
        if (actualExpandedBytes > MAX_DOCX_EXPANDED_BYTES) {
          stream.destroy();
          throw new ResumeInputLimitError("DOCX expands beyond the supported size limit.");
        }
      }
    }

    if (!hasDocument || !hasContentTypes) {
      throw new Error("DOCX is missing required document parts.");
    }
  } finally {
    archive.close();
  }
}

export interface ParsedResume {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  summary?: string;
  skills: string[];
  experience: Array<{
    company: string;
    title: string;
    startDate: string;
    endDate: string;
    description: string;
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field: string;
    graduationDate: string;
  }>;
  certifications: string[];
  languages: string[];
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
}

/**
 * Extract text from PDF buffer
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  assertResumeFileSize(buffer);
  try {
    // Load the PDF engine only for PDF uploads, not for every resume operation.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const data = await parser.getText({ first: MAX_RESUME_PDF_PAGES + 1, pageJoiner: "" });
      if (data.total > MAX_RESUME_PDF_PAGES) {
        throw new ResumeInputLimitError(`PDFs may contain at most ${MAX_RESUME_PDF_PAGES} pages.`);
      }
      if (data.text.length > MAX_RESUME_TEXT_CHARS) {
        throw new ResumeInputLimitError(`Resume text exceeds the ${MAX_RESUME_TEXT_CHARS} character limit.`);
      }
      return data.text;
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    if (error instanceof ResumeInputLimitError) throw error;
    logOperationalFailure("ResumeParser", "PDF extraction");
    throw new Error("Failed to extract text from PDF");
  }
}

/**
 * Extract text from DOCX buffer
 */
export async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  assertResumeFileSize(buffer);
  try {
    await validateDocxArchive(buffer);
    const result = await mammoth.extractRawText({ buffer });
    if (result.value.length > MAX_RESUME_TEXT_CHARS) {
      throw new ResumeInputLimitError(`Resume text exceeds the ${MAX_RESUME_TEXT_CHARS} character limit.`);
    }
    return result.value;
  } catch (error) {
    if (error instanceof ResumeInputLimitError) throw error;
    logOperationalFailure("ResumeParser", "DOCX extraction");
    throw new Error("Failed to extract text from DOCX");
  }
}

/** Extract readable text from an RTF document without interpreting embedded objects. */
export function extractTextFromRTF(buffer: Buffer): string {
  const source = buffer.toString("utf8");
  if (!/^\s*\{\\rtf\d+/i.test(source)) {
    throw new Error("Failed to extract text from RTF");
  }

  return source
    .replace(/\\u(-?\d+)\??/g, (_match, value: string) => {
      const codePoint = Number(value);
      const normalizedCodePoint = codePoint < 0 ? codePoint + 65_536 : codePoint;
      return Number.isInteger(normalizedCodePoint) && normalizedCodePoint >= 0 && normalizedCodePoint <= 0x10ffff
        ? String.fromCodePoint(normalizedCodePoint)
        : "";
    })
    .replace(/\\'([0-9a-f]{2})/gi, (_match, value: string) => Buffer.from(value, "hex").toString("latin1"))
    .replace(/\\(par|line)\b ?/gi, "\n")
    .replace(/\\tab\b ?/gi, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/\\([\\{}])/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse resume from file buffer (PDF, DOCX, RTF, or plain text)
 */
export async function parseResumeFromFile(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedResume> {
  assertResumeFileSize(buffer);
  let text: string;
  
  if (mimeType === "application/pdf" || mimeType.includes("pdf")) {
    text = await extractTextFromPDF(buffer);
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType.includes("docx")
  ) {
    text = await extractTextFromDOCX(buffer);
  } else if (mimeType === "text/rtf" || mimeType === "application/rtf") {
    text = extractTextFromRTF(buffer);
  } else if (mimeType === "text/plain" || mimeType.includes("text")) {
    text = buffer.toString("utf-8");
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
  
  return parseResumeText(text);
}

/**
 * Parse resume text and extract structured information
 */
export async function parseResumeText(resumeText: string): Promise<ParsedResume> {
  const text = resumeText.trim();
  if (!text) {
    throw new Error("Resume contains no readable text. Upload a text-based document or paste the resume text.");
  }
  if (text.length > MAX_RESUME_TEXT_CHARS) {
    throw new Error(`Resume text exceeds the ${MAX_RESUME_TEXT_CHARS} character limit.`);
  }
  try {
    const prompt = `You are an expert resume parser. Extract all relevant information from the following resume text and structure it in a standardized format.

Resume Text:
${text}

Extract the following information:
1. Personal information (name, email, phone, location)
2. Professional summary
3. Skills (technical and soft skills)
4. Work experience (company, title, dates, description)
5. Education (institution, degree, field, graduation date)
6. Certifications
7. Languages
8. Social profiles (LinkedIn, GitHub, portfolio)

Return the data in a structured JSON format.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an expert resume parser that extracts structured information from resumes with high accuracy.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parsed_resume",
          strict: true,
          schema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Full name of the candidate",
              },
              email: {
                type: "string",
                description: "Email address",
              },
              phone: {
                type: "string",
                description: "Phone number",
              },
              location: {
                type: "string",
                description: "Current location or address",
              },
              summary: {
                type: "string",
                description: "Professional summary or objective",
              },
              skills: {
                type: "array",
                items: { type: "string" },
                description: "List of skills",
              },
              experience: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    company: { type: "string" },
                    title: { type: "string" },
                    startDate: { type: "string" },
                    endDate: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["company", "title", "startDate", "endDate", "description"],
                  additionalProperties: false,
                },
                description: "Work experience history",
              },
              education: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    institution: { type: "string" },
                    degree: { type: "string" },
                    field: { type: "string" },
                    graduationDate: { type: "string" },
                  },
                  required: ["institution", "degree", "field", "graduationDate"],
                  additionalProperties: false,
                },
                description: "Educational background",
              },
              certifications: {
                type: "array",
                items: { type: "string" },
                description: "Professional certifications",
              },
              languages: {
                type: "array",
                items: { type: "string" },
                description: "Languages spoken",
              },
              linkedinUrl: {
                type: "string",
                description: "LinkedIn profile URL",
              },
              githubUrl: {
                type: "string",
                description: "GitHub profile URL",
              },
              portfolioUrl: {
                type: "string",
                description: "Portfolio or personal website URL",
              },
            },
            required: ["skills", "experience", "education", "certifications", "languages"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("No response from LLM");
    }

    const parsed = JSON.parse(content) as ParsedResume;
    return parsed;
  } catch {
    logOperationalFailure("ResumeParser", "Resume parsing");
    throw new Error("Failed to parse resume");
  }
}

/**
 * Convert parsed resume data to user profile format
 */
export function resumeToProfileData(parsed: ParsedResume) {
  const profileData: {
    skills?: string;
    experience?: string;
    education?: string;
    linkedinUrl?: string;
    githubUrl?: string;
    portfolioUrl?: string;
  } = {};
  const skills = Array.from(new Set(
    parsed.skills.map((skill) => skill.trim()).filter(Boolean)
  )).join(", ");
  if (skills) profileData.skills = skills;

  const experience = parsed.experience
    .filter((exp) => [exp.title, exp.company, exp.startDate, exp.endDate, exp.description]
      .some((value) => value.trim()))
    .map(
      (exp) =>
        `${exp.title} at ${exp.company} (${exp.startDate} - ${exp.endDate})\n${exp.description}`
    )
    .filter((entry) => entry.trim())
    .join("\n\n");
  if (experience) profileData.experience = experience;

  const education = parsed.education
    .filter((edu) => [edu.degree, edu.field, edu.institution, edu.graduationDate]
      .some((value) => value.trim()))
    .map((edu) => `${edu.degree} in ${edu.field} from ${edu.institution} (${edu.graduationDate})`)
    .filter((entry) => entry.trim())
    .join("\n");
  if (education) profileData.education = education;

  const linkedinUrl = parsed.linkedinUrl?.trim();
  const githubUrl = parsed.githubUrl?.trim();
  const portfolioUrl = parsed.portfolioUrl?.trim();
  if (linkedinUrl && validateLinkedInUrl(linkedinUrl)) profileData.linkedinUrl = linkedinUrl;
  if (githubUrl && validateGitHubUrl(githubUrl)) profileData.githubUrl = githubUrl;
  if (portfolioUrl && validatePortfolioUrl(portfolioUrl)) profileData.portfolioUrl = portfolioUrl;

  return profileData;
}
