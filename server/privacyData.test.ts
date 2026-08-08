import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuditEventsForUser: vi.fn(),
  getEducationEntries: vi.fn(),
  getUserApplications: vi.fn(),
  getUserProfile: vi.fn(),
  getUserProjects: vi.fn(),
  getUserSkills: vi.fn(),
  getWorkExperiences: vi.fn(),
  listPublicSocialProfiles: vi.fn(),
  listUserConnectorAccounts: vi.fn(),
  getJobAlerts: vi.fn(),
  getSavedJobs: vi.fn(),
  getResumeVersions: vi.fn(),
}));

vi.mock("./db", () => ({
  getAuditEventsForUser: mocks.getAuditEventsForUser,
  getEducationEntries: mocks.getEducationEntries,
  getUserApplications: mocks.getUserApplications,
  getUserProfile: mocks.getUserProfile,
  getUserProjects: mocks.getUserProjects,
  getUserSkills: mocks.getUserSkills,
  getWorkExperiences: mocks.getWorkExperiences,
  listPublicSocialProfiles: mocks.listPublicSocialProfiles,
  listUserConnectorAccounts: mocks.listUserConnectorAccounts,
}));
vi.mock("./applicationFeatures", () => ({ getJobAlerts: mocks.getJobAlerts, getSavedJobs: mocks.getSavedJobs }));
vi.mock("./resumeStorage", () => ({ getResumeVersions: mocks.getResumeVersions }));

import { buildPrivacyDataExport } from "./privacyData";

describe("privacy data export", () => {
  it("includes user-owned records while excluding credentials and private storage references", async () => {
    Object.values(mocks).forEach((mock) => mock.mockResolvedValue([]));
    mocks.getUserProfile.mockResolvedValue({ userId: 17, resumeFileKey: "private/object-key" });
    mocks.listUserConnectorAccounts.mockResolvedValue([{
      provider: "gmail",
      status: "connected",
      consentScopes: "[\"email.metadata.read\"]",
      externalAccountLabel: "Primary inbox",
      connectionRequestedAt: null,
      lastVerifiedAt: null,
      disconnectedAt: null,
      encryptedAccessToken: "must-not-leak",
    }]);
    mocks.getResumeVersions.mockResolvedValue([{
      id: 7,
      version: 2,
      fileName: "resume.pdf",
      fileUrl: "https://private.example/file",
      fileSize: 128,
      mimeType: "application/pdf",
      isActive: true,
      uploadedAt: new Date("2026-01-01"),
    }]);

    const result = await buildPrivacyDataExport(17);

    expect(result.connectorAccounts[0]).not.toHaveProperty("encryptedAccessToken");
    expect(result.resumes[0]).not.toHaveProperty("fileUrl");
    expect(result.excluded).toHaveLength(2);
  });
});
