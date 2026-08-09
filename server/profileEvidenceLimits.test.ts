import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILE_EVIDENCE_LIMITS, profileEvidenceLimitMessage } from "../shared/profileEvidenceLimits";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("profile evidence resource limits", () => {
  it("defines practical non-zero ceilings and an actionable error", () => {
    expect(PROFILE_EVIDENCE_LIMITS).toEqual({
      workExperiences: 100,
      educationEntries: 50,
      skills: 250,
      projects: 100,
    });
    expect(profileEvidenceLimitMessage("skills", 250)).toContain("Remove an existing entry");
  });

  it("locks each user quota transaction and bounds every operating read", () => {
    const database = source("server/db.ts");
    const evidence = database.slice(database.indexOf("// Work Experiences"));

    expect(evidence.match(/FOR UPDATE/g)).toHaveLength(4);
    expect(evidence.match(/COUNT\(\*\)/g)).toHaveLength(4);
    expect(evidence).toContain(".limit(PROFILE_EVIDENCE_LIMITS.workExperiences)");
    expect(evidence).toContain(".limit(PROFILE_EVIDENCE_LIMITS.educationEntries)");
    expect(evidence).toContain(".limit(PROFILE_EVIDENCE_LIMITS.skills)");
    expect(evidence).toContain(".limit(PROFILE_EVIDENCE_LIMITS.projects)");
    expect(evidence).toContain("desc(workExperiences.id)");
    expect(evidence).toContain("desc(educationEntries.id)");
    expect(evidence).toContain("userSkills.sortOrder, userSkills.id");
    expect(evidence).toContain("userProjects.sortOrder, userProjects.id");
  });

  it("retains complete export-only reads for legacy overflow", () => {
    const privacy = source("server/privacyData.ts");
    for (const helper of [
      "getAllWorkExperiencesForPrivacyExport",
      "getAllEducationEntriesForPrivacyExport",
      "getAllUserSkillsForPrivacyExport",
      "getAllUserProjectsForPrivacyExport",
    ]) {
      expect(privacy).toContain(`${helper}(userId)`);
    }
    expect(privacy).not.toContain("getWorkExperiences(userId)");
    expect(privacy).not.toContain("getUserSkills(userId)");
  });

  it("bounds API fields and exposes collection capacity in Profile", () => {
    const router = source("server/routers.ts");
    const profile = source("client/src/pages/Profile.tsx");

    expect(router).toContain("jobTitle: z.string().trim().min(1).max(255)");
    expect(router).toContain("skillName: z.string().trim().min(1).max(100)");
    expect(router).toContain("yearsOfExperience: z.number().int().min(0).max(80)");
    expect(router).toContain("description: z.string().trim().max(5000)");
    expect(profile).toContain('from "@shared/profileEvidenceLimits"');
    expect(profile).toContain("PROFILE_EVIDENCE_LIMITS.workExperiences");
    expect(profile).toContain("PROFILE_EVIDENCE_LIMITS.educationEntries");
    expect(profile).toContain("PROFILE_EVIDENCE_LIMITS.skills");
    expect(profile).toContain("PROFILE_EVIDENCE_LIMITS.projects");
    expect(profile).toContain("disabled={atLimit && !editing}");
  });
});
