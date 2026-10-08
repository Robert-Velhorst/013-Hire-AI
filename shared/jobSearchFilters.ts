import { normalizeSalaryCurrency } from "./salaryCurrency";
import { assessListingSafety, type ListingSafetyStatus } from "./listingSafety";
import { hasExplicitRemoteWorkSignal, hasNonRemoteWorkSignal } from "./remoteEligibility";

export type JobExperienceLevel = "all" | "entry" | "junior" | "mid" | "senior" | "lead" | "executive";
export type JobApplicationProcessFilter = "all" | "greenhouse" | "lever" | "workday" | "email" | "other";
export type JobPostedWithin = "all" | "1" | "3" | "7" | "30";
export type JobTypeFilter = "all" | "full-time" | "part-time" | "contract" | "temporary";
export type JobListingSafetyFilter = "all" | ListingSafetyStatus;

export interface JobSearchFilterState {
  query: string;
  location: string;
  jobType: JobTypeFilter;
  platformId: string;
  salaryRange: [number, number];
  salaryCurrency: string;
  remoteOnly: boolean;
  experienceLevel: JobExperienceLevel;
  applicationProcess: JobApplicationProcessFilter;
  visaSponsorshipOnly: boolean;
  openHiringSupportOnly: boolean;
  diversityFriendlyOnly: boolean;
  salaryDisclosedOnly: boolean;
  postedWithin: JobPostedWithin;
  listingSafety: JobListingSafetyFilter;
}

export interface JobSearchFilterJob {
  title?: string | null;
  company?: string | null;
  description?: string | null;
  requirements?: string | null;
  responsibilities?: string | null;
  benefits?: string | null;
  skills?: string | null;
  location?: string | null;
  jobType?: string | null;
  platformId?: number | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  applicationProcess?: string | null;
  visaSponsorshipAvailable?: number | boolean | null;
  openHiringSupport?: number | boolean | null;
  diversityFriendly?: number | boolean | null;
  postedDate?: Date | string | null;
  createdAt?: Date | string | null;
  applicationUrl?: string | null;
  applicationEmail?: string | null;
  isActive?: number | boolean | null;
  expiryDate?: Date | string | null;
  updatedAt?: Date | string | null;
}

export const defaultJobSearchFilters: JobSearchFilterState = {
  query: "",
  location: "",
  jobType: "all",
  platformId: "all",
  salaryRange: [0, 300000],
  salaryCurrency: "all",
  remoteOnly: true,
  experienceLevel: "all",
  applicationProcess: "all",
  visaSponsorshipOnly: false,
  openHiringSupportOnly: false,
  diversityFriendlyOnly: false,
  salaryDisclosedOnly: false,
  postedWithin: "all",
  listingSafety: "clear",
};

function text(job: JobSearchFilterJob) {
  return [job.title, job.company, job.description, job.requirements, job.responsibilities, job.benefits, job.skills]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function locationTerms(value: string) {
  return value
    .split(/[,\n]/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function hasActiveSalaryRange(filters: JobSearchFilterState) {
  return filters.salaryCurrency !== "all" ||
    filters.salaryRange[0] !== defaultJobSearchFilters.salaryRange[0] ||
    filters.salaryRange[1] !== defaultJobSearchFilters.salaryRange[1];
}

function isRemote(job: JobSearchFilterJob) {
  const listingText = [
    job.location,
    job.title,
    job.description,
    job.requirements,
    job.responsibilities,
  ].filter(Boolean).join(" ");

  // A hybrid or office-bound statement is stronger than a generic "remote"
  // mention elsewhere in the listing when the user asks for remote-only work.
  if (hasNonRemoteWorkSignal(listingText)) return false;
  if (hasExplicitRemoteWorkSignal(job.location)) return true;

  // Some sources retain a geographic location while placing the remote
  // eligibility in the role title or posting body.
  return hasExplicitRemoteWorkSignal(listingText);
}

function experienceLevel(job: JobSearchFilterJob): Exclude<JobExperienceLevel, "all"> | "unknown" {
  const value = `${job.title || ""} ${job.requirements || ""}`.toLowerCase();
  if (/\b(intern|internship|graduate|entry[ -]?level|new grad)\b/.test(value)) return "entry";
  if (/\b(junior|jr\.?|1\+? years?|2\+? years?)\b/.test(value)) return "junior";
  if (/\b(mid[ -]?level|intermediate|3\+? years?|4\+? years?)\b/.test(value)) return "mid";
  if (/\b(senior|sr\.?|5\+? years?|6\+? years?)\b/.test(value)) return "senior";
  if (/\b(lead|principal|staff|architect|7\+? years?|8\+? years?)\b/.test(value)) return "lead";
  if (/\b(executive|director|vice president|\bvp\b|chief|c-suite)\b/.test(value)) return "executive";
  return "unknown";
}

function hasFlag(value: number | boolean | null | undefined) {
  return value === true || value === 1;
}

function hasSalaryOverlap(job: JobSearchFilterJob, range: [number, number]) {
  const hasSalary = typeof job.salaryMin === "number" || typeof job.salaryMax === "number";
  if (!hasSalary) return null;
  const jobMin = job.salaryMin ?? Number.NEGATIVE_INFINITY;
  const jobMax = job.salaryMax ?? Number.POSITIVE_INFINITY;
  return jobMin <= range[1] && jobMax >= range[0];
}

function isWithinPostedWindow(job: JobSearchFilterJob, postedWithin: JobPostedWithin, now: Date) {
  if (postedWithin === "all") return true;
  const dateValue = job.postedDate || job.createdAt;
  const postedAt = dateValue ? new Date(dateValue).getTime() : Number.NaN;
  return Number.isFinite(postedAt) && postedAt >= now.getTime() - Number(postedWithin) * 86400000;
}

export function filterJobListings<T extends JobSearchFilterJob>(jobs: T[], filters: JobSearchFilterState, now = new Date()) {
  const queryTerms = filters.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const selectedLocations = locationTerms(filters.location);
  const rangeIsActive = hasActiveSalaryRange(filters);

  return jobs.filter((job) => {
    const safety = assessListingSafety(job, now);
    // Explicit payment, cheque, and forwarding signals never reach the normal
    // discovery list. Ambiguous listings remain filterable for review.
    if (safety.status === "blocked") return false;
    if (filters.listingSafety !== "all" && safety.status !== filters.listingSafety) return false;
    if (queryTerms.length > 0 && !queryTerms.every((term) => text(job).includes(term))) return false;
    if (selectedLocations.length > 0 && !selectedLocations.some((term) => (job.location || "").toLowerCase().includes(term))) return false;
    if (filters.jobType !== "all" && job.jobType !== filters.jobType) return false;
    if (filters.platformId !== "all" && String(job.platformId) !== filters.platformId) return false;
    if (filters.remoteOnly && !isRemote(job)) return false;
    if (filters.experienceLevel !== "all" && experienceLevel(job) !== filters.experienceLevel) return false;
    if (filters.visaSponsorshipOnly && !hasFlag(job.visaSponsorshipAvailable)) return false;
    if (filters.openHiringSupportOnly && !hasFlag(job.openHiringSupport)) return false;
    if (filters.diversityFriendlyOnly && !hasFlag(job.diversityFriendly)) return false;
    if (!isWithinPostedWindow(job, filters.postedWithin, now)) return false;

    const process = (job.applicationProcess || "").toLowerCase();
    if (filters.applicationProcess !== "all") {
      const processMatches = filters.applicationProcess === "other"
        ? !["greenhouse", "lever", "workday", "email"].includes(process)
        : process === filters.applicationProcess;
      if (!processMatches) return false;
    }

    const hasSelectedSalaryCurrency = filters.salaryCurrency !== "all";
    const salaryCurrencyMatches = !hasSelectedSalaryCurrency ||
      normalizeSalaryCurrency(job.salaryCurrency) === normalizeSalaryCurrency(filters.salaryCurrency);
    if (!salaryCurrencyMatches) return false;

    // Preserve the established range-only API behavior when no currency is
    // selected. The UI disables range controls until a source currency is set.
    const salaryOverlap = rangeIsActive ? hasSalaryOverlap(job, filters.salaryRange) : null;
    const hasSalary = typeof job.salaryMin === "number" || typeof job.salaryMax === "number";
    if (filters.salaryDisclosedOnly && !hasSalary) return false;
    return salaryOverlap !== false;
  });
}

export function countActiveJobSearchFilters(filters: JobSearchFilterState) {
  return [
    filters.query.trim().length > 0,
    filters.location.trim().length > 0,
    filters.jobType !== "all",
    filters.platformId !== "all",
    filters.salaryCurrency !== "all",
    filters.salaryRange[0] !== defaultJobSearchFilters.salaryRange[0] || filters.salaryRange[1] !== defaultJobSearchFilters.salaryRange[1],
    filters.remoteOnly !== defaultJobSearchFilters.remoteOnly,
    filters.experienceLevel !== "all",
    filters.applicationProcess !== "all",
    filters.visaSponsorshipOnly,
    filters.openHiringSupportOnly,
    filters.diversityFriendlyOnly,
    filters.salaryDisclosedOnly,
    filters.postedWithin !== "all",
    filters.listingSafety !== defaultJobSearchFilters.listingSafety,
  ].filter(Boolean).length;
}
