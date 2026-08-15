/**
 * Browser application handoff compatibility adapter.
 *
 * Hire.AI does not launch stealth browsers, populate third-party forms, or
 * upload a candidate's documents to an employer portal. Application material
 * is prepared in the operating ledger and handed to the user for review and
 * manual submission with deterministic confirmation evidence.
 */

import { detectATSType, type ATSType } from "./atsClassification";

export { detectATSType } from "./atsClassification";
export type { ATSType } from "./atsClassification";

export interface ApplicationData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  resumeUrl?: string;
  /** Retained for compatibility; Hire.AI never uploads it to an employer portal. */
  resumeFilePath?: string;
  coverLetter?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  currentCompany?: string;
  currentTitle?: string;
  yearsOfExperience?: number;
  salaryExpectation?: string;
  startDate?: string;
  workAuthorization?: string;
  requiresSponsorship?: boolean;
  customAnswers?: Record<string, string>;
}

export interface AutomationResult {
  success: boolean;
  prepared?: boolean;
  applicationId?: string;
  confirmationNumber?: string;
  error?: string;
  screenshot?: string;
  logs: string[];
}

export function getResumeUploadBlocker(data: ApplicationData): string | null {
  if (!data.resumeUrl) {
    return "A resume is required before Hire.AI can prepare this application.";
  }

  if (!data.resumeFilePath) {
    return "Resume upload is blocked because no server-resolved local resume artifact is available.";
  }

  return null;
}

/** Browser execution is disabled for every platform until an approval-wired integration exists. */
export function isPreparationSupported(_atsType: ATSType): boolean {
  return false;
}

/**
 * Kept as a compatibility shell for callers that previously created a browser
 * helper. It cannot initialize, navigate, fill, upload, click, or capture an
 * employer portal.
 */
export class BrowserAutomation {
  private readonly logs = ["Browser-based employer-portal automation is disabled; use the manual handoff."];

  async initialize(): Promise<boolean> {
    return false;
  }

  async close(): Promise<void> {}

  getLogs(): string[] {
    return [...this.logs];
  }

  async applyGreenhouse(_url: string, _data: ApplicationData): Promise<AutomationResult> {
    return disabledHandoffResult("greenhouse");
  }

  async applyLever(_url: string, _data: ApplicationData): Promise<AutomationResult> {
    return disabledHandoffResult("lever");
  }
}

function disabledHandoffResult(atsType: ATSType): AutomationResult {
  return {
    success: false,
    prepared: false,
    error: `Browser-based ${atsType} preparation is disabled. Review the Hire.AI material, complete the employer portal manually, then record confirmation evidence.`,
    logs: [
      `Detected ATS: ${atsType}`,
      "No employer portal browser was launched.",
      "No form field was populated and no document was uploaded.",
    ],
  };
}

export async function automateApplication(
  url: string,
  data: ApplicationData
): Promise<AutomationResult> {
  const atsType = detectATSType(url);
  const resumeBlocker = getResumeUploadBlocker(data);

  if (resumeBlocker) {
    return {
      success: false,
      prepared: false,
      error: resumeBlocker,
      logs: [`Detected ATS: ${atsType}`, resumeBlocker],
    };
  }

  return disabledHandoffResult(atsType);
}

/** Prepare a local material draft only; it is never transmitted by this module. */
export function prepareApplicationData(
  userProfile: Record<string, unknown> | null | undefined,
  job: Record<string, unknown> | null | undefined,
  coverLetter?: string
): ApplicationData {
  const name = typeof userProfile?.name === "string" ? userProfile.name : "";
  const nameParts = name.split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  const title = typeof job?.title === "string" ? job.title : "position";
  const company = typeof job?.company === "string" ? job.company : "your company";

  return {
    firstName,
    lastName,
    email: typeof userProfile?.email === "string" ? userProfile.email : "",
    phone: typeof userProfile?.phone === "string" ? userProfile.phone : "",
    resumeUrl: typeof userProfile?.resumeUrl === "string" ? userProfile.resumeUrl : undefined,
    coverLetter: coverLetter || `I am excited to apply for the ${title} at ${company}.`,
    linkedinUrl: typeof userProfile?.linkedinUrl === "string" ? userProfile.linkedinUrl : undefined,
    portfolioUrl: typeof userProfile?.portfolioUrl === "string" ? userProfile.portfolioUrl : undefined,
    currentCompany: typeof userProfile?.currentCompany === "string" ? userProfile.currentCompany : undefined,
    currentTitle: typeof userProfile?.currentTitle === "string" ? userProfile.currentTitle : undefined,
    requiresSponsorship: userProfile?.needsVisaSponsorship === 1,
  };
}
