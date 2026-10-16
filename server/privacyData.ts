import {
  getAuditEventsForUser,
  getInterviewCalendarSyncsForPrivacyExport,
  getAllEducationEntriesForPrivacyExport,
  getAllUserProjectsForPrivacyExport,
  getAllUserSkillsForPrivacyExport,
  getAllWorkExperiencesForPrivacyExport,
  getUserApplications,
  getUserProfile,
  listPublicSocialProfiles,
  listUserConnectorAccounts,
} from "./db";
import { getJobAlerts, getSavedJobs } from "./applicationFeatures";
import { getResumeVersions } from "./resumeStorage";
import { listConnectorRevocationHistory } from "./connectorRevocationObligations";

/**
 * Produces a user-owned portable record without private object keys, signed URLs,
 * OAuth grants, or other credentials. Original document bytes remain available
 * only through the authenticated download flow.
 */
export async function buildPrivacyDataExport(userId: number) {
  const [
    profile,
    applications,
    workExperiences,
    education,
    skills,
    projects,
    publicSocialProfiles,
    connectorAccounts,
    savedJobs,
    jobAlerts,
    resumes,
    auditEvents,
    connectorRevocationHistory,
    interviewCalendarSyncs,
  ] = await Promise.all([
    getUserProfile(userId),
    getUserApplications(userId),
    getAllWorkExperiencesForPrivacyExport(userId),
    getAllEducationEntriesForPrivacyExport(userId),
    getAllUserSkillsForPrivacyExport(userId),
    getAllUserProjectsForPrivacyExport(userId),
    listPublicSocialProfiles(userId),
    listUserConnectorAccounts(userId),
    getSavedJobs(userId),
    getJobAlerts(userId),
    getResumeVersions(userId),
    getAuditEventsForUser(userId, 100),
    listConnectorRevocationHistory(userId),
    getInterviewCalendarSyncsForPrivacyExport(userId),
  ]);

  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    profile,
    applications,
    workExperiences,
    education,
    skills,
    projects,
    publicSocialProfiles,
    connectorAccounts: connectorAccounts.map((account) => ({
      provider: account.provider,
      status: account.status,
      consentScopes: account.consentScopes,
      externalAccountLabel: account.externalAccountLabel,
      connectionRequestedAt: account.connectionRequestedAt,
      lastVerifiedAt: account.lastVerifiedAt,
      disconnectedAt: account.disconnectedAt,
    })),
    savedJobs,
    jobAlerts,
    resumes: resumes.map((resume) => ({
      id: resume.id,
      version: resume.version,
      fileName: resume.fileName,
      fileSize: resume.fileSize,
      mimeType: resume.mimeType,
      isActive: resume.isActive,
      uploadedAt: resume.uploadedAt,
    })),
    auditEvents,
    connectorRevocationHistory,
    interviewCalendarSyncs,
    excluded: [
      "Resume, offer, and verification file bytes are not included. Use authenticated document download while access is retained.",
      "Connector authorization tokens, private storage keys, and provider credentials are never exported.",
      "Calendar event content remains in the user's connected calendar; this export includes only Hire.AI's provider event ID and synchronization record.",
    ],
  } as const;
}
