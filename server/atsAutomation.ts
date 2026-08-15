/**
 * Legacy ATS compatibility adapter.
 *
 * Hire.AI does not automate CAPTCHA challenges, credentials, or final employer
 * portal submissions. This module remains as a stable boundary for callers
 * that need to classify an ATS and create a reviewable manual handoff.
 */

import { detectATSType, type ATSType } from "./atsClassification";

export { detectATSType } from "./atsClassification";
export type { ATSType } from "./atsClassification";

export interface ATSCredentials {
  email: string;
  linkedinUrl?: string;
  useLinkedInAuth?: boolean;
}

export interface ApplicationData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  resume: {
    url: string;
    filename: string;
  };
  workAuthorization: string;
  requiresSponsorship: boolean;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  coverLetter?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  githubUrl?: string;
  salaryExpectation?: number;
  startDate?: string;
  yearsExperience?: number;
  education?: Array<{
    school: string;
    degree: string;
    field: string;
    graduationYear: number;
    gpa?: number;
  }>;
  workHistory?: Array<{
    company: string;
    title: string;
    startDate: string;
    endDate?: string;
    current: boolean;
    description: string;
  }>;
  skills?: string[];
  customAnswers?: Record<string, string>;
}

export interface ATSResult {
  success: boolean;
  applicationId?: string;
  confirmationNumber?: string;
  status: "submitted" | "partial" | "failed" | "captcha_required" | "login_required";
  message: string;
  screenshots?: string[];
  errors?: string[];
  nextSteps?: string[];
}

export interface CAPTCHAResult {
  solved: boolean;
  solution?: string;
  method: "manual";
  error?: string;
}

function finalSubmissionDisabled(atsType: ATSType): ATSResult {
  return {
    success: false,
    status: "partial",
    message: `${atsType} application data can be prepared, but final submission is disabled until a user reviews and submits externally.`,
    nextSteps: [
      "Review the prepared application material.",
      "Complete any login or CAPTCHA challenge directly on the employer portal.",
      "Submit manually through the employer portal.",
      "Record deterministic confirmation evidence in Hire.AI.",
    ],
  };
}

/**
 * Compatibility shell for callers that previously inspected CAPTCHA state.
 * It never sends challenges to third parties or injects challenge solutions.
 */
export class CAPTCHAHandler {
  async detectCAPTCHA(): Promise<{
    detected: boolean;
    type?: "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "funcaptcha" | "image" | "text";
    siteKey?: string;
  }> {
    return { detected: false };
  }

  async solveCAPTCHA(): Promise<CAPTCHAResult> {
    return {
      solved: false,
      method: "manual",
      error: "CAPTCHA handling is disabled. Complete the challenge directly on the employer portal.",
    };
  }
}

export class WorkdayAutomation {
  constructor(_captchaHandler?: CAPTCHAHandler) {}

  async initialize(): Promise<void> {
    throw new Error("Browser-based ATS automation is disabled. Use the manual employer-portal handoff.");
  }

  async close(): Promise<void> {}

  async apply(
    _applicationUrl: string,
    _data: ApplicationData,
    _credentials?: ATSCredentials
  ): Promise<ATSResult> {
    return finalSubmissionDisabled("workday");
  }
}

export class TaleoAutomation {
  constructor(_captchaHandler?: CAPTCHAHandler) {}

  async initialize(): Promise<void> {
    throw new Error("Browser-based ATS automation is disabled. Use the manual employer-portal handoff.");
  }

  async close(): Promise<void> {}

  async apply(
    _applicationUrl: string,
    _data: ApplicationData,
    _credentials?: ATSCredentials
  ): Promise<ATSResult> {
    return finalSubmissionDisabled("taleo");
  }
}

export async function applyWithATS(
  applicationUrl: string,
  _data: ApplicationData,
  _credentials?: ATSCredentials
): Promise<ATSResult> {
  return finalSubmissionDisabled(detectATSType(applicationUrl));
}
