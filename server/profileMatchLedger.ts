import { resolveProfileCandidateEvidence } from "@shared/profileSkillEvidence";
import { calculateDeterministicJobMatch } from "./aiMatching";
import {
  createAuditEvent,
  createCanonicalJobMatches,
  createJobMatch,
  getActiveJobs,
  getUserProfile,
  getUserSkills,
  getWorkExperiences,
} from "./db";

export interface ProfileMatchLedgerRefreshInput {
  userId: number;
  source: string;
  actor?: "user" | "system" | "admin";
}

export interface ProfileMatchLedgerRefreshResult {
  profileAvailable: boolean;
  consideredJobs: number;
  refreshedMatches: number;
  failedMatches: number;
}

const MATCH_REFRESH_CONCURRENCY = 10;

/**
 * Reconciles the cached match ledger after a candidate changes evidence that
 * affects fit. It is deliberately deterministic and ledger-only: it never
 * creates an application, changes a decision, or contacts an employer.
 */
export async function refreshProfileMatchLedger(
  input: ProfileMatchLedgerRefreshInput
): Promise<ProfileMatchLedgerRefreshResult> {
  const [profile, structuredSkills, structuredWorkHistory, jobs] = await Promise.all([
    getUserProfile(input.userId),
    getUserSkills(input.userId),
    getWorkExperiences(input.userId),
    getActiveJobs(250, 0),
  ]);
  if (!profile) {
    return {
      profileAvailable: false,
      consideredJobs: jobs.length,
      refreshedMatches: 0,
      failedMatches: 0,
    };
  }

  const profileForMatching = resolveProfileCandidateEvidence(
    profile,
    structuredSkills,
    structuredWorkHistory
  );
  let refreshedMatches = 0;
  let failedMatches = 0;

  for (let start = 0; start < jobs.length; start += MATCH_REFRESH_CONCURRENCY) {
    const batch = jobs.slice(start, start + MATCH_REFRESH_CONCURRENCY);
    const matches: Parameters<typeof createCanonicalJobMatches>[0] = [];
    for (const job of batch) {
      try {
        const match = calculateDeterministicJobMatch(profileForMatching, job, "profile_evidence_refresh");
        matches.push({
          userId: input.userId,
          jobId: job.id,
          matchScore: match.matchScore,
          matchReasons: match.matchReasons,
          skillsMatch: match.skillsMatch,
          experienceMatch: match.experienceMatch,
          locationMatch: match.locationMatch,
          salaryMatch: match.salaryMatch,
        });
      } catch {
        failedMatches += 1;
      }
    }
    if (matches.length === 0) continue;
    let batchResults: boolean[];
    try {
      await createCanonicalJobMatches(matches);
      batchResults = matches.map(() => true);
    } catch {
      batchResults = await Promise.all(matches.map(async (match) => {
        try {
          await createJobMatch(match);
          return true;
        } catch {
          return false;
        }
      }));
    }
    refreshedMatches += batchResults.filter(Boolean).length;
    failedMatches += batchResults.filter((result) => !result).length;
  }

  const result = {
    profileAvailable: true,
    consideredJobs: jobs.length,
    refreshedMatches,
    failedMatches,
  };
  await createAuditEvent({
    userId: input.userId,
    entityType: "user",
    entityId: input.userId,
    action: failedMatches > 0
      ? "profile_match_ledger_reconciliation_partial"
      : "profile_match_ledger_refreshed",
    actor: input.actor || "user",
    source: input.source,
    afterState: JSON.stringify({
      ...result,
      deterministicOnly: true,
      externalSubmissionPerformed: false,
    }),
    riskLevel: failedMatches > 0 ? "medium" : "low",
  });
  return result;
}
