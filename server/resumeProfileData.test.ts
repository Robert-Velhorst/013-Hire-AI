import { describe, expect, it } from "vitest";
import { resumeToProfileData, type ParsedResume } from "./resumeParser";

const emptyResume: ParsedResume = {
  skills: [],
  experience: [],
  education: [],
  certifications: [],
  languages: [],
};

describe("resume profile conversion", () => {
  it("omits profile fields that have no resume evidence", () => {
    expect(resumeToProfileData(emptyResume)).toEqual({});
  });

  it("omits structurally valid but blank work and education records", () => {
    expect(resumeToProfileData({
      ...emptyResume,
      experience: [{ company: "", title: " ", startDate: "", endDate: "", description: "\n" }],
      education: [{ institution: "", degree: "\t", field: "", graduationDate: " " }],
    })).toEqual({});
  });

  it("keeps documented experience without manufacturing years from role count", () => {
    const profileData = resumeToProfileData({
      ...emptyResume,
      skills: ["TypeScript", "React", "TypeScript"],
      experience: [{
        title: "Platform Engineer",
        company: "Example Systems",
        startDate: "2021-01",
        endDate: "Present",
        description: "Built reliable distributed services.",
      }],
      education: [{
        degree: "BSc",
        field: "Computer Science",
        institution: "Example University",
        graduationDate: "2020",
      }],
    });

    expect(profileData).toMatchObject({
      skills: "TypeScript, React",
      experience: "Platform Engineer at Example Systems (2021-01 - Present)\nBuilt reliable distributed services.",
      education: "BSc in Computer Science from Example University (2020)",
    });
    expect(profileData.experience).not.toContain("years of experience");
  });

  it("keeps only social links that pass the profile validation rules", () => {
    const profileData = resumeToProfileData({
      ...emptyResume,
      linkedinUrl: "javascript:alert(1)",
      githubUrl: "https://example.com/not-github",
      portfolioUrl: "file:///private/resume.html",
    });

    expect(profileData).toEqual({});

    expect(resumeToProfileData({
      ...emptyResume,
      linkedinUrl: "https://www.linkedin.com/in/example-candidate",
      githubUrl: "https://github.com/example-candidate",
      portfolioUrl: "https://example-candidate.dev",
    })).toMatchObject({
      linkedinUrl: "https://www.linkedin.com/in/example-candidate",
      githubUrl: "https://github.com/example-candidate",
      portfolioUrl: "https://example-candidate.dev",
    });
  });
});
