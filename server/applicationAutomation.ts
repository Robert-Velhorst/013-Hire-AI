/**
 * Automated Application System
 * Detects ATS (Applicant Tracking System) and automates job applications
 */

import type { SubmissionEvidenceInput } from "./applicationSubmissionEvidence";
import { detectATSType, type ATSType } from "./atsClassification";

export { detectATSType } from "./atsClassification";
export type { ATSType } from "./atsClassification";

export interface ApplicationData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  resumeUrl: string;
  /** Versioned storage key for the resume selected for this application. */
  resumeFileKey: string;
  coverLetter?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  answers?: Record<string, string>; // For custom questions
}

export interface ApplicationResult {
  success: boolean;
  prepared: boolean;
  submissionAttempted: boolean;
  /** True only when an external submission actually completed. */
  externalSubmissionPerformed: boolean;
  reviewRequired: boolean;
  atsType: ATSType;
  message: string;
  confirmationId?: string;
  submissionEvidence?: SubmissionEvidenceInput;
  error?: string;
}

/**
 * Prepare an application for a guarded user-review handoff.
 * Final submission is intentionally not attempted by this service.
 */
export async function applyToJob(
  applicationUrl: string,
  applicationData: ApplicationData
): Promise<ApplicationResult> {
  const atsType = detectATSType(applicationUrl);

  // Final submission remains disabled until a reviewable browser handoff exists.
  return {
    success: false,
    prepared: true,
    submissionAttempted: false,
    externalSubmissionPerformed: false,
    reviewRequired: true,
    atsType,
    message: `Application data is ready, but ${atsType} submission requires user review and manual confirmation.`,
    error: "Final submission is disabled",
  };
}

/**
 * Employer portals are a strict preparation boundary. Keep the persistence
 * contract independent of result-shaped flags so a future adapter cannot turn
 * a preparation call into an unreviewed external-submission claim.
 */
export function getPortalPreparationLedgerState(
  result: Pick<ApplicationResult, "prepared" | "reviewRequired">
) {
  return {
    status: "pending" as const,
    isAutoApplied: 0 as const,
    attemptStatus: result.reviewRequired
      ? "review_required" as const
      : result.prepared
        ? "prepared" as const
        : "failed" as const,
    externalSubmissionPerformed: false,
    auditAction: "application_prepared_by_automation" as const,
  };
}

/**
 * Validate application data
 */
export function validateApplicationData(data: ApplicationData): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data.firstName || data.firstName.trim() === "") {
    errors.push("First name is required");
  }

  if (!data.lastName || data.lastName.trim() === "") {
    errors.push("Last name is required");
  }

  if (!data.email || !data.email.includes("@")) {
    errors.push("Valid email is required");
  }

  if (!data.resumeUrl || data.resumeUrl.trim() === "") {
    errors.push("Resume URL is required");
  }

  if (!data.resumeFileKey || data.resumeFileKey.trim() === "") {
    errors.push("Active versioned resume is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Prepare application data from user profile
 */
export function prepareApplicationData(
  user: { name?: string | null; email?: string | null },
  profile: {
    resumeUrl?: string | null;
    resumeFileKey?: string | null;
    linkedinUrl?: string | null;
    githubUrl?: string | null;
    portfolioUrl?: string | null;
  },
  coverLetter?: string
): ApplicationData | null {
  // Parse name
  const nameParts = (user.name || "").split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  if (!firstName || !user.email || !profile.resumeUrl || !profile.resumeFileKey) {
    return null;
  }

  return {
    firstName,
    lastName,
    email: user.email,
    resumeUrl: profile.resumeUrl,
    resumeFileKey: profile.resumeFileKey,
    coverLetter,
    linkedinUrl: profile.linkedinUrl || undefined,
    githubUrl: profile.githubUrl || undefined,
    portfolioUrl: profile.portfolioUrl || undefined,
  };
}

/**
 * Describes Hire.AI's employer-portal boundary for a URL. Material can be
 * prepared in the internal ledger, but this service never opens, fills,
 * uploads to, or submits an employer portal.
 */
export function isAutomationSupported(url: string): {
  supported: boolean;
  preparationSupported: boolean;
  atsType: ATSType;
  message: string;
} {
  const atsType = detectATSType(url);

  return {
    supported: false,
    preparationSupported: false,
    atsType,
    message: `Hire.AI can prepare application material in its ledger for ${atsType}, but it does not access employer portal forms. Review and submit manually through the employer portal.`,
  };
}
