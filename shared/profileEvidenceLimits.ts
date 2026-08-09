export const PROFILE_EVIDENCE_LIMITS = {
  workExperiences: 100,
  educationEntries: 50,
  skills: 250,
  projects: 100,
} as const;

export function profileEvidenceLimitMessage(label: string, limit: number) {
  return `You can store up to ${limit} ${label}. Remove an existing entry before adding another.`;
}
