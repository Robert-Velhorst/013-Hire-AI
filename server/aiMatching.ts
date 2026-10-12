import { invokeLLM } from "./_core/llm";
import type { Job, UserProfile } from "../drizzle/schema";
import { buildEvidenceBoundApplicationDraft } from "./applicationMaterialDraft";
import { scoreJobForProfile } from "./autonomousOrchestrator";
import { getLocationPreferenceFit } from "../shared/locationEligibility";
import { areSalaryCurrenciesComparable, normalizeSalaryCurrency } from "../shared/salaryCurrency";
import { logOperationalFailure } from "./operationalFailureLog";

/**
 * AI-powered job matching service
 * Uses LLM to analyze job requirements and user profiles to generate match scores
 */

export interface JobMatchResult {
  jobId: number;
  matchScore: number;
  matchReasons: string;
  skillsMatch: number;
  experienceMatch: number;
  locationMatch: number;
  salaryMatch: number;
  analysisSource: "llm" | "deterministic_fallback";
}

function splitList(value?: string | null): string[] {
  return Array.from(new Set(
    (value || "")
      .split(/[,;\n]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ));
}

function overlaps(left: string, right: string) {
  return left.includes(right) || right.includes(left);
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Match score must be a finite number.");
  }
  if (value < 0 || value > 100) {
    throw new Error("Match score must be between 0 and 100.");
  }
  return Math.round(value);
}

function matchSkillScore(profile: UserProfile, job: Job): number {
  const profileSkills = splitList(profile.skills);
  const jobSkills = splitList(job.skills);
  if (jobSkills.length === 0) return 50;
  if (profileSkills.length === 0) return 0;

  const matched = jobSkills.filter((jobSkill) =>
    profileSkills.some((profileSkill) => overlaps(profileSkill, jobSkill))
  ).length;
  return Math.round((matched / jobSkills.length) * 100);
}

function matchLocationScore(profile: UserProfile, job: Job): number {
  const fit = getLocationPreferenceFit(job.location, profile.desiredLocations);
  if (fit === "fit") return 100;
  if (fit === "partial") return 50;
  if (fit === "gap") return 0;
  return 50;
}

function matchSalaryScore(profile: UserProfile, job: Job): number {
  const hasProfileExpectation = Boolean(profile.salaryExpectationMin || profile.salaryExpectationMax);
  const hasJobSalary = Boolean(job.salaryMin || job.salaryMax);
  if (!hasProfileExpectation || !hasJobSalary) return 50;
  if (!areSalaryCurrenciesComparable(job.salaryCurrency, profile.salaryExpectationCurrency)) return 50;

  if (profile.salaryExpectationMin && job.salaryMax && job.salaryMax < profile.salaryExpectationMin) {
    return 0;
  }
  if (profile.salaryExpectationMax && job.salaryMin && job.salaryMin > profile.salaryExpectationMax) {
    return 50;
  }
  return 100;
}

/**
 * Produces a review-safe match from only structured profile and job evidence.
 * It is used whenever an optional LLM analysis is unavailable or invalid.
 */
export function calculateDeterministicJobMatch(
  userProfile: UserProfile,
  job: Job,
  context: "llm_fallback" | "profile_evidence_refresh" = "llm_fallback"
): JobMatchResult {
  const score = scoreJobForProfile(job, userProfile);
  const experienceMatch = userProfile.experience?.trim() ? 50 : 0;
  const reasons = [
    context === "profile_evidence_refresh"
      ? "Current candidate evidence was reconciled into this deterministic match."
      : "Deterministic profile-based analysis used because AI matching was unavailable or invalid.",
    ...score.reasons,
    userProfile.experience?.trim()
      ? "Experience is recorded, but requires human review because no structured years-to-requirement comparison is available."
      : "Experience evidence is missing from the profile.",
    ...score.blockers.map((blocker) => `Review: ${blocker}`),
  ];

  return {
    jobId: job.id,
    matchScore: score.score,
    matchReasons: reasons.join("\n"),
    skillsMatch: matchSkillScore(userProfile, job),
    experienceMatch,
    locationMatch: matchLocationScore(userProfile, job),
    salaryMatch: matchSalaryScore(userProfile, job),
    analysisSource: "deterministic_fallback",
  };
}

/**
 * Calculate match score between a user profile and a job
 */
export async function calculateJobMatch(
  userProfile: UserProfile,
  job: Job
): Promise<JobMatchResult> {
  try {
    const salaryCurrencyRequiresReview = Boolean(
      (userProfile.salaryExpectationMin || userProfile.salaryExpectationMax) &&
      (job.salaryMin || job.salaryMax) &&
      !areSalaryCurrenciesComparable(job.salaryCurrency, userProfile.salaryExpectationCurrency)
    );
    const prompt = `You are an expert job matching AI. Analyze the following user profile and job posting to determine how well they match.

User Profile:
- Skills: ${userProfile.skills || "Not specified"}
- Experience: ${userProfile.experience || "Not specified"}
- Education: ${userProfile.education || "Not specified"}
- Desired Job Types: ${userProfile.desiredJobTypes || "Any"}
- Desired Locations: ${userProfile.desiredLocations || "Any"}
- Salary Expectation: ${normalizeSalaryCurrency(userProfile.salaryExpectationCurrency) ?? "Not specified"} ${userProfile.salaryExpectationMin || 0} - ${userProfile.salaryExpectationMax || 0}
- Needs Visa Sponsorship: ${userProfile.needsVisaSponsorship ? "Yes" : "No"}
- Diversity Group: ${userProfile.diversityGroup || "Not specified"}

Job Posting:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location || "Not provided; remote eligibility unknown"}
- Job Type: ${job.jobType || "Not specified"}
- Skills Required: ${job.skills || "Not specified"}
- Requirements: ${job.requirements || "Not specified"}
- Salary Range: ${normalizeSalaryCurrency(job.salaryCurrency) ?? "Currency unknown"} ${job.salaryMin || 0} - ${job.salaryMax || 0}
- Visa Sponsorship: ${job.visaSponsorshipAvailable ? "Available" : "Not available"}
- Diversity Friendly: ${job.diversityFriendly ? "Yes" : "No"}

If the profile and job salary currencies differ, do not convert or compare amounts. Set salary match to 50 and state that salary requires human review.

Provide a detailed match analysis with:
1. Overall match score (0-100)
2. Skills match score (0-100)
3. Experience match score (0-100)
4. Location match score (0-100)
5. Salary match score (0-100)
6. Detailed reasons for the match score

Return the analysis in JSON format.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an expert job matching AI that analyzes job postings and candidate profiles to determine compatibility.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "job_match_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              matchScore: {
                type: "integer",
                description: "Overall match score from 0-100",
              },
              skillsMatch: {
                type: "integer",
                description: "Skills compatibility score from 0-100",
              },
              experienceMatch: {
                type: "integer",
                description: "Experience level match score from 0-100",
              },
              locationMatch: {
                type: "integer",
                description: "Location preference match score from 0-100",
              },
              salaryMatch: {
                type: "integer",
                description: "Salary expectation match score from 0-100",
              },
              matchReasons: {
                type: "string",
                description: "Detailed explanation of why this is a good or poor match",
              },
            },
            required: [
              "matchScore",
              "skillsMatch",
              "experienceMatch",
              "locationMatch",
              "salaryMatch",
              "matchReasons",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("No response from LLM");
    }

    const analysis = JSON.parse(content) as Record<string, unknown>;
    if (typeof analysis.matchReasons !== "string" || !analysis.matchReasons.trim()) {
      throw new Error("Match analysis must include reasons.");
    }

    return {
      jobId: job.id,
      matchScore: clampScore(analysis.matchScore),
      matchReasons: salaryCurrencyRequiresReview
        ? `${analysis.matchReasons.trim()} Salary uses ${normalizeSalaryCurrency(job.salaryCurrency) ?? "an unknown currency"} and requires review against the ${normalizeSalaryCurrency(userProfile.salaryExpectationCurrency) ?? "unspecified"} expectation.`
        : analysis.matchReasons.trim(),
      skillsMatch: clampScore(analysis.skillsMatch),
      experienceMatch: clampScore(analysis.experienceMatch),
      locationMatch: clampScore(analysis.locationMatch),
      salaryMatch: salaryCurrencyRequiresReview ? 50 : clampScore(analysis.salaryMatch),
      analysisSource: "llm",
    };
  } catch {
    return calculateDeterministicJobMatch(userProfile, job);
  }
}

/**
 * Generate a personalized cover letter for a job application
 */
export async function generateCoverLetter(
  userProfile: UserProfile,
  job: Job
): Promise<string> {
  return buildEvidenceBoundApplicationDraft(userProfile, job).coverLetter;
}

/**
 * Identify decision makers for a company
 */
export async function identifyDecisionMakers(
  company: string,
  jobTitle: string
): Promise<{
  suggestions: Array<{
    title: string;
    department: string;
    reasoning: string;
  }>;
}> {
  try {
    const prompt = `For a ${jobTitle} position at ${company}, identify the most likely decision makers who would be involved in the hiring process.

Consider:
1. The typical hiring hierarchy for this role
2. Common job titles of hiring managers
3. Relevant departments

Provide 3-5 potential decision maker roles with their likely titles and departments.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an expert in corporate hiring structures and know how to identify key decision makers in the hiring process.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "decision_makers",
          strict: true,
          schema: {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description: "Job title of the decision maker",
                    },
                    department: {
                      type: "string",
                      description: "Department they work in",
                    },
                    reasoning: {
                      type: "string",
                      description: "Why this person would be involved in hiring",
                    },
                  },
                  required: ["title", "department", "reasoning"],
                  additionalProperties: false,
                },
              },
            },
            required: ["suggestions"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("No response from LLM");
    }

    return JSON.parse(content);
  } catch {
    logOperationalFailure("AIMatching", "Decision-maker analysis");
    return {
      suggestions: [],
    };
  }
}

/**
 * Generate interview preparation questions and tips
 */
export async function generateInterviewPreparation(
  job: Job
): Promise<{
  questions: string[];
  tips: string[];
  companyInsights: string;
}> {
  try {
    const prompt = `Generate interview preparation materials for a ${job.title} position at ${job.company}.

Job Description:
${job.description || "Not provided"}

Requirements:
${job.requirements || "Not provided"}

Provide:
1. 10 likely interview questions (mix of technical and behavioral)
2. 5 key preparation tips
3. Insights about the company and role`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an expert interview coach who helps candidates prepare for job interviews.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "interview_prep",
          strict: true,
          schema: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                items: { type: "string" },
                description: "List of likely interview questions",
              },
              tips: {
                type: "array",
                items: { type: "string" },
                description: "Key preparation tips",
              },
              companyInsights: {
                type: "string",
                description: "Insights about the company and role",
              },
            },
            required: ["questions", "tips", "companyInsights"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("No response from LLM");
    }

    return JSON.parse(content);
  } catch {
    logOperationalFailure("AIMatching", "Interview preparation");
    return {
      questions: [],
      tips: [],
      companyInsights: "Unable to generate insights at this time.",
    };
  }
}
