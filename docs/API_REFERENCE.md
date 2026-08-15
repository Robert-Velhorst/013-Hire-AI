# Hire.AI V2 - API Reference

> Contract note: this is a high-level integration guide. The checked-in tRPC router is the implementation source of truth; provider credentials and production authorization remain deployment prerequisites. The `privacy.exportData` protected query exports user-owned metadata while excluding credentials and private document bytes.

## Overview

Hire.AI V2 uses tRPC for type-safe API communication. All endpoints are available under `/api/trpc`.

The optional HAI interoperability surface is a separate, bearer-authenticated A2A 1.0-shaped read-only endpoint at `/api/hai/a2a`; see `docs/WINDOWS_NGROK_HAI.md`. It is not a tRPC user session and has no mutation authority.

## Authentication

All protected endpoints require a valid session cookie. Use the auth endpoints to manage authentication.

---

## Auth Router

### `auth.me`
Get the current authenticated user.

**Type:** Query (Public)

**Returns:**
```typescript
{
  id: number;
  openId: string;
  email: string | null;
  name: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
} | null
```

### `auth.logout`
Log out the current user. The mutation clears the browser cookie and revokes all
previously issued Hire.AI sessions for that user, including copied cookies.

**Type:** Mutation (Public)

**Returns:**
```typescript
{ success: true }
```

---

## Privacy Router

All privacy procedures require an authenticated session and operate only on the current user.

### `privacy.exportData`

Returns a versioned portable metadata export. Connector grants, private object keys, signed URLs, and document bytes are excluded.

### `privacy.getDeletionRequest`

Returns the current user's latest bounded deletion-review status or `null`. Internal descriptions, assignments, and admin resolution notes are not exposed.

### `privacy.requestDeletion`

Creates or reuses one open high-priority operator review. The optional reason is limited to 1,000 characters. This mutation records an audit event and does not delete data.

### `privacy.cancelDeletionRequest`

Cancels the current user's open request and records the cancellation. It cannot target another user's review and fails when no open request exists.

### `admin.previewPrivacyErasure`

Admin-only query for a privacy-deletion review. Counts every direct and application-linked user-owned table under policy `2026-08-09.v2`, classifies records as `erase`, `scrub_and_retain`, or `retain`, and reports private-object and provider-revocation work. It fails closed in development-memory mode and performs no deletion.

### `admin.getPrivacyErasurePlan`

Returns the durable run and itemized tasks for a privacy review without returning OAuth tokens or private object keys.

### `admin.executePrivacyErasureCleanup`

Requires exact run-specific confirmation. Claims a five-minute lease, revokes supported providers, deletes erasable private objects idempotently, and records retry/manual states.

### `admin.finalizePrivacyErasure`

Requires `ready_for_database` state and the exact `ERASE DATABASE USER <id> USING <policy>` confirmation. Claims a separate lease and transactionally deletes erasable records, scrubs retained ledgers, pseudonymizes and suspends the account, preserves regulated records, completes itemized tasks, and rolls back the entire database stage on failure.

### `admin.confirmManualPrivacyCleanup`

Records bounded evidence for a blocked Microsoft or LinkedIn account-side cleanup task. The run advances to `ready_for_database` only when every external task is complete.

---

## Workspaces Router

All workspace procedures require an authenticated account. Membership never grants access to candidate profiles, documents, jobs, applications, or provider connections.

- `workspaces.list` and `workspaces.detail` return only active, authorized workspaces. Unauthorized IDs are concealed as not found.
- `workspaces.create` creates an owner-controlled workspace.
- `workspaces.rename` is available to owners and administrators.
- `workspaces.invite` creates an email-bound, seven-day invitation. The plaintext token is returned once and only its SHA-256 hash is stored.
- `workspaces.acceptInvitation` is email-bound and idempotent for its original recipient.
- `workspaces.revokeInvitation` is available to managers.
- `workspaces.changeMemberRole`, `workspaces.removeMember`, and `workspaces.transferOwnership` enforce owner and administrator privilege ceilings.
- `workspaces.archive` requires a sole active owner and prevents accidental removal of a shared workspace.

Workloads are bounded to 20 actively owned workspaces per user, 100 active memberships per user, 100 active members per workspace, and 50 active invitations per workspace.

---

## Jobs Router

### `jobs.list`
List all active jobs with pagination.

**Type:** Query (Public)

**Input:**
```typescript
{
  limit?: number;  // Default: 20
  offset?: number; // Default: 0
}
```

**Returns:**
```typescript
Array<{
  id: number;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  jobType: string;
  description: string;
  applicationUrl: string;
  platformId: number;
  postedAt: Date;
  expiresAt: Date | null;
}>
```

### `jobs.search`
Search jobs with filters.

**Type:** Query (Public)

**Input:**
```typescript
{
  title?: string;
  company?: string;
  location?: string;
  jobType?: string;
  minSalary?: number;
  maxSalary?: number;
  platformId?: number;
  limit?: number;
  offset?: number;
}
```

### `jobs.getById`
Get a single job by ID.

**Type:** Query (Public)

**Input:**
```typescript
{ id: number }
```

### `jobs.saveJob`
Save a job for later.

**Type:** Mutation (Protected)

**Input:**
```typescript
{ jobId: number }
```

### `jobs.unsaveJob`
Remove a saved job.

**Type:** Mutation (Protected)

**Input:**
```typescript
{ jobId: number }
```

### `jobs.getSavedJobs`
Get all saved jobs for the current user.

**Type:** Query (Protected)

**Returns:**
```typescript
Array<{
  id: number;
  jobId: number;
  savedAt: Date;
  notes: string | null;
  job: Job;
}>
```

---

## Platforms Router

### `platforms.list`
List all job platforms.

**Type:** Query (Public)

**Returns:**
```typescript
Array<{
  id: number;
  name: string;
  url: string;
  category: string;
  tier: number;
  isActive: boolean;
  lastScrapedAt: Date | null;
}>
```

### `platforms.active`
List only active platforms.

**Type:** Query (Public)

### `platforms.getById`
Get a platform by ID.

**Type:** Query (Public)

**Input:**
```typescript
{ id: number }
```

---

## Profile Router

### `profile.get`
Get the current user's profile.

**Type:** Query (Protected)

**Returns:**
```typescript
{
  id: number;
  userId: number;
  headline: string | null;
  summary: string | null;
  skills: string[];
  experience: number | null;
  education: string | null;
  preferredJobTypes: string[];
  preferredLocations: string[];
  minSalary: number | null;
  maxSalary: number | null;
} | null
```

### `profile.update`
Update the user's profile.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  headline?: string;
  summary?: string;
  skills?: string[];
  experience?: number;
  education?: string;
  preferredJobTypes?: string[];
  preferredLocations?: string[];
  minSalary?: number;
  maxSalary?: number;
}
```

---

## Resume Router

### `resume.parse`
Parse resume text and extract structured data.

**Type:** Mutation (Protected)

**Input:**
```typescript
{ resumeText: string }
```

**Returns:**
```typescript
{
  name: string | null;
  email: string | null;
  phone: string | null;
  skills: string[];
  experience: Array<{
    company: string;
    title: string;
    startDate: string;
    endDate: string | null;
    description: string;
  }>;
  education: Array<{
    school: string;
    degree: string;
    field: string;
    graduationYear: number;
  }>;
}
```

### `resume.upload`
Upload a resume file to S3.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  filename: string;
  content: string; // Base64 encoded
  mimeType: string;
}
```

**Returns:**
```typescript
{
  id: number;
  url: string;
  filename: string;
}
```

### `resume.parseFile`
Parse an uploaded resume file (PDF/DOCX).

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  fileContent: string; // Base64 encoded
  mimeType: string;
}
```

---

## Applications Router

### `applications.list`
List all applications for the current user.

**Type:** Query (Protected)

**Returns:**
```typescript
Array<{
  id: number;
  jobId: number;
  status: "draft" | "applied" | "viewed" | "interview" | "offer" | "rejected" | "withdrawn";
  appliedAt: Date;
  updatedAt: Date;
  notes: string | null;
  job: Job;
}>
```

### `applications.create`
Create a new application.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  jobId: number;
  coverLetter?: string;
}
```

### `applications.updateStatus`
Update application status.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  applicationId: number;
  status: "draft" | "applied" | "viewed" | "interview" | "offer" | "rejected" | "withdrawn";
}
```

### `applications.addNote`
Add a note to an application.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  applicationId: number;
  note: string;
}
```

### `applications.scheduleInterview`
Schedule an interview for an application.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  applicationId: number;
  scheduledAt: Date;
  type: "phone" | "video" | "onsite" | "technical";
  notes?: string;
}
```

### `applications.getUpcomingInterviews`
Get upcoming interviews.

**Type:** Query (Protected)

**Returns:**
```typescript
Array<{
  id: number;
  applicationId: number;
  scheduledAt: Date;
  type: string;
  notes: string | null;
  application: Application;
}>
```

### `applications.createFollowUp`
Create a follow-up reminder.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  applicationId: number;
  followUpDate: Date;
  message?: string;
}
```

---

## Matching Router

### `matching.calculateMatch`
Calculate match score between user and job.

**Type:** Query (Protected)

**Input:**
```typescript
{ jobId: number }
```

**Returns:**
```typescript
{
  overallScore: number;
  skillsMatch: number;
  experienceMatch: number;
  salaryMatch: number;
  locationMatch: number;
  breakdown: {
    matchedSkills: string[];
    missingSkills: string[];
    recommendations: string[];
  };
}
```

### `matching.getMatches`
Get top job matches for the user.

**Type:** Query (Protected)

**Input:**
```typescript
{
  minScore?: number; // Default: 70
  limit?: number;    // Default: 20
}
```

---

## AI Router

### `ai.generateCoverLetter`
Generate a personalized cover letter.

**Type:** Mutation (Protected)

**Input:**
```typescript
{ jobId: number }
```

**Returns:**
```typescript
{
  coverLetter: string;
  highlights: string[];
}
```

### `ai.prepareInterview`
Generate interview preparation materials.

**Type:** Mutation (Protected)

**Input:**
```typescript
{ jobId: number }
```

**Returns:**
```typescript
{
  commonQuestions: string[];
  technicalQuestions: string[];
  behavioralQuestions: string[];
  companyInsights: string[];
  tipsForSuccess: string[];
}
```

---

## Scraping Router

### `scraping.listScrapers`
List all available scrapers.

**Type:** Query (Admin)

**Returns:**
```typescript
string[]
```

### `scraping.status`
Get current scraping status.

**Type:** Query (Admin)

**Returns:**
```typescript
{
  initialized: true;
  availableScrapers: number;
  registeredScrapers: number;
  supportedPlatforms: string[];
  platforms: Array<{
    id: number;
    name: string;
    readiness: "ready" | "unavailable";
    freshness: "fresh" | "stale" | "awaiting_first_scan";
  }>;
  coverage: Record<string, unknown>;
  scheduler: Record<string, unknown>;
  executionPolicy: {
    scrapeTimeoutMs: number;
    maxConcurrentScrapes: number;
    serializedPerPlatform: true;
  };
  message: string;
}
```

### `scraping.scrapeAll`
Trigger scraping for all platforms.

**Type:** Mutation (Admin)

**Input:** Optional `{ keywords?: string; location?: string; limit?: number }`

### `scraping.scrapePlatform`

Trigger scraping for a specific platform.

Runs one configured and policy-approved source adapter. Jobicy uses its documented public remote-jobs API. Arbeitnow reads one bounded API page, accepts only records where `remote === true`, and preserves the provider job URL required for attribution. Both enforce a durable one-hour minimum polling interval. A request inside that interval returns `skippedReason: "poll_interval"`, no jobs, and no error; it does not overwrite the latest persisted source result.

**Type:** Mutation (Admin)

**Input:**
```typescript
{
  platform: string;
  keywords?: string;
  location?: string;
  limit?: number;
}
```

---

## Automation Router

### `automation.detectATS`
Detect the ATS type from a job URL.

**Type:** Query (Public)

**Input:**
```typescript
{ url: string }
```

**Returns:**
```typescript
{
  atsType: "greenhouse" | "lever" | "workday" | "taleo" | "icims" | "smartrecruiters" | "unknown";
  confidence: number;
}
```

### `automation.apply`
Prepare a review-gated application handoff for a job. This procedure never opens an employer portal, fills a third-party form, uploads documents, or submits an application externally.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  jobId: number;
  coverLetter?: string;
}
```

**Returns:**
```typescript
{
  success: boolean;
  prepared: boolean;
  submissionAttempted: false;
  externalSubmissionPerformed: false;
  reviewRequired: true;
  atsType: string;
  applicationRecordId: number;
  applicationUrl: string;
  message: string;
  error?: string;
}
```

---

## Career Router

### `career.analyzeSalary`
Analyze salary for a role.

**Type:** Query (Protected)

**Input:**
```typescript
{
  jobTitle: string;
  location?: string;
  experience?: number;
}
```

**Returns:**
```typescript
{
  marketRange: { min: number; max: number; median: number };
  yourPosition: string;
  negotiationTips: string[];
  factors: Array<{ name: string; impact: string }>;
}
```

### `career.analyzeCompanyCulture`
Analyze company culture.

**Type:** Query (Protected)

**Input:**
```typescript
{ companyName: string }
```

### `career.generateNetworkingStrategy`
Generate networking recommendations.

**Type:** Query (Protected)

**Input:**
```typescript
{
  targetRole: string;
  targetCompany?: string;
}
```

### `career.generateCareerPlan`
Generate a career development plan.

**Type:** Query (Protected)

**Input:**
```typescript
{
  currentRole: string;
  targetRole: string;
  timeframe?: string;
}
```

---

## Diversity Router

### `diversity.analyzeCompanyDI`
Analyze company D&I practices.

**Type:** Query (Protected)

**Input:**
```typescript
{ companyName: string }
```

### `diversity.analyzeVisaSponsorship`
Analyze visa sponsorship likelihood.

**Type:** Query (Protected)

**Input:**
```typescript
{
  companyName: string;
  jobTitle: string;
}
```

### `diversity.getDIPlatforms`
Get D&I-focused job platforms.

**Type:** Query (Public)

**Input:**
```typescript
{
  categories: string[];
}
```

---

## Connector Router

### `connectors.disconnect`

Disables Hire.AI access before attempting provider cleanup. Google, Dropbox, and GitHub use their app-scoped revocation APIs. Microsoft and LinkedIn return explicit account-side removal guidance because neither provider documents a suitable app-scoped revocation endpoint for this connection. Local encrypted credentials are removed after revocation or when manual cleanup is required. A failed provider request leaves the account disabled and retains the encrypted grant only so revocation can be retried.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  provider: "gmail" | "google_drive" | "dropbox" | "outlook" | "linkedin" | "github" | "portfolio";
}
```

**Output cleanup status:** `not_needed | revoked | manual_required | failed`

---

## Social Router

### `social.connect`
Connect a social profile.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  platform: "linkedin" | "github" | "twitter" | "portfolio" | "dribbble" | "behance";
  profileUrl: string;
}
```

### `social.disconnect`
Disconnect a social profile.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  platform: string;
}
```

---

## Decision Makers Router

### `decisionMakers.identify`
Identify decision makers for a job.

**Type:** Query (Protected)

**Input:**
```typescript
{ jobId: number }
```

**Returns:**
```typescript
Array<{
  name: string;
  title: string;
  role: "hiring_manager" | "recruiter" | "team_lead" | "department_head";
  linkedinUrl?: string;
  email?: string;
  confidence: number;
}>
```

### `decisionMakers.getForCompany`
Get decision makers for a company.

**Type:** Query (Protected)

**Input:**
```typescript
{
  companyName: string;
  department?: string;
}
```

---

## Alerts Router

### `alerts.list`
List all job alerts.

**Type:** Query (Protected)

### `alerts.create`
Create a new job alert.

**Type:** Mutation (Protected)

**Input:**
```typescript
{
  name: string;
  criteria: {
    keywords?: string[];
    jobTypes?: string[];
    locations?: string[];
    minSalary?: number;
    companies?: string[];
  };
  frequency: "instant" | "daily" | "weekly";
}
```

### `alerts.delete`
Delete a job alert.

**Type:** Mutation (Protected)

**Input:**
```typescript
{ alertId: number }
```

---

## Error Handling

All endpoints return standard tRPC errors:

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | User not authenticated |
| `FORBIDDEN` | User lacks permission |
| `NOT_FOUND` | Resource not found |
| `BAD_REQUEST` | Invalid input |
| `INTERNAL_SERVER_ERROR` | Server error |

---

*Last Updated: January 2026*
