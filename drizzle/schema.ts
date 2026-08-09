import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  locale: varchar("locale", { length: 10 }).default("en").notNull(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  accountStatus: mysqlEnum("account_status", ["active", "suspended", "pending"]).default("active").notNull(),
  tosAcceptedAt: timestamp("tos_accepted_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const workspaces = mysqlTable("workspaces", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  createdByUserId: int("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("workspaces_creator_status_idx").on(table.createdByUserId, table.status, table.id),
]);

export const workspaceMembers = mysqlTable("workspace_members", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", ["owner", "admin", "member"]).default("member").notNull(),
  status: mysqlEnum("status", ["active", "removed"]).default("active").notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("workspace_members_workspace_user_unique").on(table.workspaceId, table.userId),
  index("workspace_members_user_status_idx").on(table.userId, table.status, table.workspaceId),
  index("workspace_members_workspace_status_role_idx").on(table.workspaceId, table.status, table.role),
]);

export const workspaceInvitations = mysqlTable("workspace_invitations", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("role", ["admin", "member"]).default("member").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  invitedByUserId: int("invited_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  acceptedByUserId: int("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("workspace_invitations_token_unique").on(table.tokenHash),
  index("workspace_invitations_workspace_created_idx").on(table.workspaceId, table.createdAt, table.id),
  index("workspace_invitations_email_expiry_idx").on(table.email, table.expiresAt, table.id),
]);

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;

/**
 * Job Platforms Configuration
 * Stores information about the 50+ remote job platforms we aggregate from
 */
export const jobPlatforms = mysqlTable("job_platforms", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  url: varchar("url", { length: 500 }).notNull(),
  tier: mysqlEnum("tier", ["tier1", "tier2", "tier3", "tier4"]).notNull(),
  category: varchar("category", { length: 100 }),
  isActive: int("is_active").default(1).notNull(),
  lastScraped: timestamp("last_scraped"),
  lastScrapeAttemptedAt: timestamp("last_scrape_attempted_at"),
  lastScrapeStatus: mysqlEnum("last_scrape_status", ["success", "partial", "failed"]),
  lastScrapeJobCount: int("last_scrape_job_count"),
  lastScrapeError: varchar("last_scrape_error", { length: 2000 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("job_platforms_name_unique").on(table.name),
]);

/**
 * Jobs Table
 * Stores aggregated job listings from all platforms
 */
export const jobs = mysqlTable("jobs", {
  id: int("id").autoincrement().primaryKey(),
  externalId: varchar("external_id", { length: 255 }),
  title: varchar("title", { length: 500 }).notNull(),
  company: varchar("company", { length: 255 }).notNull(),
  description: text("description"),
  requirements: text("requirements"),
  responsibilities: text("responsibilities"),
  benefits: text("benefits"),
  location: varchar("location", { length: 255 }),
  jobType: mysqlEnum("job_type", ["full-time", "part-time", "contract", "temporary"]),
  salaryMin: int("salary_min"),
  salaryMax: int("salary_max"),
  salaryCurrency: varchar("salary_currency", { length: 10 }),
  skills: text("skills"),
  applicationUrl: varchar("application_url", { length: 1000 }),
  applicationEmail: varchar("application_email", { length: 320 }),
  applicationProcess: varchar("application_process", { length: 100 }),
  platformId: int("platform_id").notNull(),
  sourceUrl: varchar("source_url", { length: 1000 }),
  postedDate: timestamp("posted_date"),
  expiryDate: timestamp("expiry_date"),
  isActive: int("is_active").default(1).notNull(),
  visaSponsorshipAvailable: int("visa_sponsorship_available").default(0),
  openHiringSupport: int("open_hiring_support").default(0),
  diversityFriendly: int("diversity_friendly").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("jobs_active_posted_created_idx").on(table.isActive, table.postedDate, table.createdAt),
  index("jobs_platform_external_idx").on(table.platformId, table.externalId),
]);

/**
 * Job Duplicates Tracking
 * Tracks which jobs are duplicates of each other across platforms
 */
export const jobDuplicates = mysqlTable("job_duplicates", {
  id: int("id").autoincrement().primaryKey(),
  primaryJobId: int("primary_job_id").notNull(),
  duplicateJobId: int("duplicate_job_id").notNull(),
  similarityScore: int("similarity_score"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("job_duplicates_primary_duplicate_unique").on(table.primaryJobId, table.duplicateJobId),
  uniqueIndex("job_duplicates_duplicate_job_unique").on(table.duplicateJobId),
]);

/**
 * User Profiles Extended
 * Additional profile information for job matching
 */
export const userProfiles = mysqlTable("user_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  skills: text("skills"),
  experience: text("experience"),
  education: text("education"),
  preferences: text("preferences"),
  desiredJobTypes: text("desired_job_types"),
  desiredLocations: text("desired_locations"),
  salaryExpectationMin: int("salary_expectation_min"),
  salaryExpectationMax: int("salary_expectation_max"),
  salaryExpectationCurrency: varchar("salary_expectation_currency", { length: 10 }).default("USD").notNull(),
  resumeUrl: varchar("resume_url", { length: 1000 }),
  resumeFileKey: varchar("resume_file_key", { length: 500 }),
  linkedinUrl: varchar("linkedin_url", { length: 500 }),
  githubUrl: varchar("github_url", { length: 500 }),
  portfolioUrl: varchar("portfolio_url", { length: 500 }),
  diversityGroup: varchar("diversity_group", { length: 255 }),
  needsVisaSponsorship: int("needs_visa_sponsorship").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("user_profiles_user_unique").on(table.userId),
]);

/**
 * Social Media Profiles
 * Stores user-provided public social profile references. OAuth consent and
 * connection state live in userConnectorAccounts; raw credentials are never
 * persisted in application tables.
 */
export const socialMediaProfiles = mysqlTable("social_media_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  platform: mysqlEnum("platform", ["facebook", "twitter", "linkedin"]).notNull(),
  profileUrl: varchar("profile_url", { length: 500 }),
  isActive: int("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("social_profiles_user_platform_unique").on(table.userId, table.platform),
  index("social_media_profiles_user_active_idx").on(table.userId, table.isActive),
]);

/**
 * User Connector Accounts
 * Tracks consent and readiness for external account integrations without storing tokens.
 */
export const userConnectorAccounts = mysqlTable("user_connector_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  provider: mysqlEnum("provider", ["gmail", "google_drive", "dropbox", "outlook", "linkedin", "github", "portfolio"]).notNull(),
  status: mysqlEnum("status", ["not_connected", "connection_requested", "connected", "needs_reauth", "disabled"]).default("not_connected").notNull(),
  consentScopes: text("consent_scopes"),
  externalAccountLabel: varchar("external_account_label", { length: 255 }),
  connectionRequestedAt: timestamp("connection_requested_at"),
  lastVerifiedAt: timestamp("last_verified_at"),
  disconnectedAt: timestamp("disconnected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("user_connector_accounts_user_provider_unique").on(table.userId, table.provider),
]);

/**
 * Encrypted OAuth grants for external profile and inbox connectors. Tokens are
 * intentionally separate from the user-visible connector account state.
 */
export const connectorAuthorizations = mysqlTable("connector_authorizations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  provider: mysqlEnum("provider", ["gmail", "google_drive", "dropbox", "outlook", "linkedin", "github"]).notNull(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  tokenType: varchar("token_type", { length: 64 }),
  grantedScopes: text("granted_scopes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("connector_authorizations_user_provider_unique").on(table.userId, table.provider),
]);

/**
 * Applications
 * Tracks job applications submitted through the platform
 */
export const applications = mysqlTable("applications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: int("job_id").notNull().references(() => jobs.id, { onDelete: "restrict" }),
  status: mysqlEnum("status", [
    "pending",
    "applied",
    "viewed",
    "interview",
    "offer",
    "rejected",
    "accepted",
    "withdrawn"
  ]).default("pending").notNull(),
  appliedDate: timestamp("applied_date"),
  lastActivity: timestamp("last_activity"),
  coverLetter: text("cover_letter"),
  customResume: text("custom_resume"),
  notes: text("notes"),
  isAutoApplied: int("is_auto_applied").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("applications_user_job_unique").on(table.userId, table.jobId),
  index("applications_user_created_idx").on(table.userId, table.createdAt, table.id),
  index("applications_user_status_activity_idx").on(
    table.userId,
    table.status,
    table.lastActivity,
    table.createdAt,
    table.id
  ),
]);

/**
 * Application Decisions
 * Stores the operating-ledger decision for each user/job pair.
 */
export const applicationDecisions = mysqlTable("application_decisions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  jobId: int("job_id").notNull(),
  decision: mysqlEnum("decision", ["apply", "save", "ignore", "review", "manual_apply"]).notNull(),
  decisionReason: text("decision_reason"),
  matchScore: int("match_score"),
  riskLevel: mysqlEnum("risk_level", ["low", "medium", "high"]).default("medium").notNull(),
  reviewRequired: int("review_required").default(1).notNull(),
  reviewReason: text("review_reason"),
  decidedBy: mysqlEnum("decided_by", ["system", "user", "admin"]).default("system").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("application_decisions_user_job_unique").on(table.userId, table.jobId),
  index("application_decisions_user_decision_idx").on(table.userId, table.decision),
  index("application_decisions_user_updated_idx").on(table.userId, table.updatedAt),
  index("application_decisions_review_required_idx").on(table.reviewRequired),
]);

/**
 * Application Materials
 * Stores the exact candidate-facing material prepared for an application.
 */
export const applicationMaterials = mysqlTable("application_materials", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull(),
  resumeId: int("resume_id"),
  customResume: text("custom_resume"),
  coverLetter: text("cover_letter"),
  customAnswers: text("custom_answers"),
  claimsMade: text("claims_made"),
  sourceProfileSnapshot: text("source_profile_snapshot"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("application_materials_application_unique").on(table.applicationId),
]);

/**
 * Application Attempts
 * Tracks every preparation, handoff, and confirmed submission attempt.
 */
export const applicationAttempts = mysqlTable("application_attempts", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userId: int("user_id").notNull(),
  jobId: int("job_id").notNull(),
  platformId: int("platform_id"),
  attemptType: mysqlEnum("attempt_type", ["prepare", "manual_confirmation", "external_handoff"]).default("prepare").notNull(),
  status: mysqlEnum("status", ["prepared", "review_required", "submitted", "failed", "cancelled"]).default("prepared").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  errorMessage: text("error_message"),
  confirmationText: text("confirmation_text"),
  confirmationUrl: varchar("confirmation_url", { length: 1000 }),
  screenshotKey: varchar("screenshot_key", { length: 500 }),
  retryCount: int("retry_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("application_attempts_application_idx").on(table.applicationId),
  index("application_attempts_user_status_idx").on(table.userId, table.status),
]);

/**
 * Employer Responses
 * Stores the exact employer reply classification that moved or informed an application.
 */
export const employerResponses = mysqlTable("employer_responses", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  interviewId: int("interview_id"),
  userId: int("user_id").notNull(),
  responseType: mysqlEnum("response_type", [
    "viewed",
    "rejection",
    "interview_invite",
    "offer",
    "employer_question",
    "no_response",
    "other",
  ]).notNull(),
  source: mysqlEnum("source", ["email", "employer_portal", "linkedin", "phone", "other"]).notNull(),
  sourceReference: varchar("source_reference", { length: 320 }),
  summary: text("summary").notNull(),
  receivedAt: timestamp("received_at").notNull(),
  statusBefore: mysqlEnum("status_before", [
    "pending",
    "applied",
    "viewed",
    "interview",
    "offer",
    "rejected",
    "accepted",
    "withdrawn"
  ]).notNull(),
  statusAfter: mysqlEnum("status_after", [
    "pending",
    "applied",
    "viewed",
    "interview",
    "offer",
    "rejected",
    "accepted",
    "withdrawn"
  ]).notNull(),
  noteId: int("note_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("employer_responses_application_idx").on(table.applicationId),
  index("employer_responses_application_type_received_id_idx").on(
    table.applicationId,
    table.responseType,
    table.receivedAt,
    table.id
  ),
  index("employer_responses_user_interview_idx").on(table.userId, table.interviewId),
  index("employer_responses_user_received_idx").on(table.userId, table.receivedAt),
  uniqueIndex("employer_responses_user_source_reference_unique").on(
    table.userId,
    table.source,
    table.sourceReference
  ),
]);

/**
 * Application Notifications
 * Keeps user-facing interview alerts tied to deterministic employer-response evidence.
 * This is intentionally separate from external email delivery: an alert is only queued
 * after an interview invite has been recorded in the application ledger.
 */
export const applicationNotifications = mysqlTable("application_notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  applicationId: int("application_id").notNull(),
  employerResponseId: int("employer_response_id").notNull(),
  notificationType: mysqlEnum("notification_type", ["interview_invite"]).notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("application_notifications_employer_response_unique").on(table.employerResponseId),
  index("application_notifications_user_read_created_idx").on(table.userId, table.readAt, table.createdAt),
  index("application_notifications_application_idx").on(table.applicationId),
]);

/**
 * Audit Events
 * Records consequential operating-ledger decisions and actions.
 */
export const auditEvents = mysqlTable("audit_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  entityType: mysqlEnum("entity_type", ["job", "application", "success_fee", "verification", "user", "admin_review", "workspace"]).notNull(),
  entityId: int("entity_id").notNull(),
  action: varchar("action", { length: 120 }).notNull(),
  actor: mysqlEnum("actor", ["system", "user", "admin"]).default("system").notNull(),
  source: varchar("source", { length: 120 }),
  beforeState: text("before_state"),
  afterState: text("after_state"),
  riskLevel: mysqlEnum("risk_level", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  approvalId: int("approval_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("audit_events_user_created_idx").on(table.userId, table.createdAt),
  index("audit_events_entity_idx").on(table.entityType, table.entityId),
]);

/**
 * Admin Review Items
 * Surfaces compliance, revenue, and high-risk automation items for admin action.
 */
export const adminReviewItems = mysqlTable("admin_review_items", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  entityType: mysqlEnum("entity_type", ["job", "application", "success_fee", "verification", "user"]).notNull(),
  entityId: int("entity_id").notNull(),
  category: mysqlEnum("category", [
    "application_review",
    "submission_evidence",
    "employer_response",
    "offer_attribution",
    "verification_overdue",
    "payment_failed",
    "legal_escalation",
    "employment_ended",
    "privacy_deletion"
  ]).notNull(),
  status: mysqlEnum("status", ["open", "in_progress", "resolved", "dismissed"]).default("open").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  assignedTo: int("assigned_to"),
  resolvedBy: int("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("admin_review_items_status_priority_idx").on(table.status, table.priority),
  index("admin_review_items_status_created_idx").on(table.status, table.createdAt),
  index("admin_review_items_user_status_idx").on(table.userId, table.status),
  index("admin_review_items_user_category_created_idx").on(
    table.userId,
    table.category,
    table.entityType,
    table.entityId,
    table.createdAt
  ),
  index("admin_review_items_entity_idx").on(table.entityType, table.entityId),
]);

/** Durable, non-destructive privacy-erasure planning and execution state. */
export const privacyErasureRuns = mysqlTable("privacy_erasure_runs", {
  id: int("id").autoincrement().primaryKey(),
  reviewItemId: int("review_item_id").notNull(),
  userId: int("user_id").notNull(),
  requestedByAdminId: int("requested_by_admin_id").notNull(),
  policyVersion: varchar("policy_version", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["planned", "cleanup_in_progress", "manual_action_required", "ready_for_database", "database_in_progress", "completed", "failed", "cancelled"]).default("planned").notNull(),
  inventorySnapshot: text("inventory_snapshot").notNull(),
  failureSummary: text("failure_summary"),
  executionLeaseId: varchar("execution_lease_id", { length: 64 }),
  executionLeaseExpiresAt: timestamp("execution_lease_expires_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("privacy_erasure_runs_review_unique").on(table.reviewItemId),
  index("privacy_erasure_runs_user_status_idx").on(table.userId, table.status),
]);

export const privacyErasureTasks = mysqlTable("privacy_erasure_tasks", {
  id: int("id").autoincrement().primaryKey(),
  runId: int("run_id").notNull(),
  userId: int("user_id").notNull(),
  taskKey: varchar("task_key", { length: 255 }).notNull(),
  kind: mysqlEnum("kind", ["provider_revoke", "private_object_delete", "retention_hold", "database_finalize"]).notNull(),
  sourceTable: varchar("source_table", { length: 64 }).notNull(),
  sourceRecordId: int("source_record_id"),
  sourceColumn: varchar("source_column", { length: 64 }),
  provider: mysqlEnum("provider", ["gmail", "google_drive", "dropbox", "outlook", "linkedin", "github"]),
  status: mysqlEnum("status", ["pending", "blocked", "in_progress", "completed", "failed"]).default("pending").notNull(),
  attemptCount: int("attempt_count").default(0).notNull(),
  lastErrorCode: varchar("last_error_code", { length: 120 }),
  completionEvidence: text("completion_evidence"),
  lastAttemptAt: timestamp("last_attempt_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("privacy_erasure_tasks_run_key_unique").on(table.runId, table.taskKey),
  index("privacy_erasure_tasks_run_status_idx").on(table.runId, table.status),
  index("privacy_erasure_tasks_user_status_idx").on(table.userId, table.status),
]);

/**
 * Application Approvals
 * Captures explicit user/admin approval for consequential job-search actions.
 */
export const applicationApprovals = mysqlTable("application_approvals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  applicationId: int("application_id"),
  entityType: mysqlEnum("entity_type", ["application", "follow_up", "success_fee", "profile", "billing"]).notNull(),
  entityId: int("entity_id").notNull(),
  approvalType: mysqlEnum("approval_type", [
    "application_submission",
    "follow_up_send",
    "offer_attribution",
    "interview_schedule",
    "profile_claim",
    "billing_action"
  ]).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "cancelled"]).default("pending").notNull(),
  riskLevel: mysqlEnum("risk_level", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  requestedBy: mysqlEnum("requested_by", ["system", "user", "admin"]).default("system").notNull(),
  decidedBy: mysqlEnum("decided_by", ["user", "admin"]),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  payload: text("payload"),
  decisionNote: text("decision_note"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("application_approvals_user_status_idx").on(table.userId, table.status),
  index("application_approvals_user_status_created_idx").on(table.userId, table.status, table.createdAt),
  index("application_approvals_application_idx").on(table.applicationId),
  index("application_approvals_entity_idx").on(table.entityType, table.entityId),
]);

/**
 * Application Campaigns
 * Stores the durable operating-state snapshot for a user's active job-search campaign.
 */
export const applicationCampaigns = mysqlTable("application_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  status: mysqlEnum("status", ["active", "paused", "completed", "archived"]).default("active").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  targetRoles: text("target_roles"),
  targetLocations: text("target_locations"),
  salaryMin: int("salary_min"),
  salaryMax: int("salary_max"),
  remoteOnly: int("remote_only").default(1).notNull(),
  automationMode: mysqlEnum("automation_mode", ["review_first", "auto_apply"]).default("review_first").notNull(),
  dailyApplicationLimit: int("daily_application_limit").default(12).notNull(),
  minMatchScore: int("min_match_score").default(70).notNull(),
  readinessScore: int("readiness_score").default(0).notNull(),
  autoApplyEligible: int("auto_apply_eligible").default(0).notNull(),
  blockers: text("blockers"),
  nextActions: text("next_actions"),
  lastPlanSummary: text("last_plan_summary"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("application_campaigns_user_unique").on(table.userId),
  index("application_campaigns_status_idx").on(table.status),
  index("application_campaigns_synced_idx").on(table.lastSyncedAt),
]);

/**
 * Autonomous run state
 * Provides durable scheduling state and a cross-instance execution lease.
 */
export const autonomousRunStates = mysqlTable("autonomous_run_states", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  leaseToken: varchar("lease_token", { length: 64 }),
  leaseExpiresAt: timestamp("lease_expires_at"),
  lastStartedAt: timestamp("last_started_at"),
  lastCompletedAt: timestamp("last_completed_at"),
  lastStatus: mysqlEnum("last_status", ["running", "completed", "failed", "skipped"]),
  lastError: text("last_error"),
  lastOutcomeDetail: text("last_outcome_detail"),
  lastRunSummary: text("last_run_summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("autonomous_run_states_user_id_unique").on(table.userId),
  index("autonomous_run_states_lease_expires_idx").on(table.leaseExpiresAt),
]);

/**
 * Decision Makers
 * Stores information about hiring managers and decision makers
 */
export const decisionMakers = mysqlTable("decision_makers", {
  id: int("id").autoincrement().primaryKey(),
  company: varchar("company", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }),
  title: varchar("title", { length: 255 }),
  email: varchar("email", { length: 320 }),
  linkedinUrl: varchar("linkedin_url", { length: 500 }),
  department: varchar("department", { length: 100 }),
  verificationSource: varchar("verification_source", { length: 100 }),
  isVerified: int("is_verified").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/**
 * Job Matches
 * Stores AI-powered job matching scores
 */
export const jobMatches = mysqlTable("job_matches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  jobId: int("job_id").notNull(),
  matchScore: int("match_score").notNull(),
  matchReasons: text("match_reasons"),
  skillsMatch: int("skills_match"),
  experienceMatch: int("experience_match"),
  locationMatch: int("location_match"),
  salaryMatch: int("salary_match"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("job_matches_user_job_unique").on(table.userId, table.jobId),
  index("job_matches_user_score_idx").on(table.userId, table.matchScore),
]);

/**
 * Interview Preparation
 * Stores AI-generated interview questions and coaching
 */
export const interviewPreparation = mysqlTable("interview_preparation", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  jobId: int("job_id").notNull(),
  questions: text("questions"),
  coachingTips: text("coaching_tips"),
  companyInsights: text("company_insights"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("interview_prep_user_job_unique").on(table.userId, table.jobId),
]);

/**
 * Follow-ups
 * Tracks automated follow-up messages
 */
export const followUps = mysqlTable("follow_ups", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  message: text("message"),
  sentDate: timestamp("sent_date"),
  deliveryConfirmation: text("delivery_confirmation"),
  deliveryProvider: mysqlEnum("delivery_provider", ["gmail", "outlook"]),
  deliveryState: mysqlEnum("delivery_state", ["draft", "sending", "sent", "failed", "unknown"]).default("draft").notNull(),
  deliveryRecipient: varchar("delivery_recipient", { length: 320 }),
  deliverySubject: varchar("delivery_subject", { length: 500 }),
  deliveryMessageId: varchar("delivery_message_id", { length: 320 }),
  deliveryAttemptKey: varchar("delivery_attempt_key", { length: 64 }),
  deliveryFailureMessage: varchar("delivery_failure_message", { length: 500 }),
  responseReceived: int("response_received").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("follow_ups_delivery_attempt_key_unique").on(table.deliveryAttemptKey),
  index("follow_ups_delivery_state_idx").on(table.deliveryState),
  index("follow_ups_application_created_idx").on(table.applicationId, table.createdAt),
]);

/**
 * Inbox Response Candidates
 * Stores read-only, application-linked message metadata until the user confirms
 * or dismisses the proposed employer-response classification.
 */
export const inboxResponseCandidates = mysqlTable("inbox_response_candidates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  applicationId: int("application_id").notNull(),
  provider: mysqlEnum("provider", ["gmail", "outlook"]).notNull(),
  messageId: varchar("message_id", { length: 280 }).notNull(),
  sender: varchar("sender", { length: 500 }),
  subject: varchar("subject", { length: 500 }).notNull(),
  preview: text("preview").notNull(),
  receivedAt: timestamp("received_at").notNull(),
  suggestedResponseType: mysqlEnum("suggested_response_type", [
    "rejection",
    "interview_invite",
    "offer",
    "employer_question",
    "other",
  ]).notNull(),
  confidence: mysqlEnum("confidence", ["high", "medium"]).notNull(),
  status: mysqlEnum("status", ["pending", "confirmed", "dismissed"]).default("pending").notNull(),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("inbox_response_candidates_user_provider_message_unique").on(table.userId, table.provider, table.messageId),
  index("inbox_response_candidates_user_status_received_idx").on(table.userId, table.status, table.receivedAt),
  index("inbox_response_candidates_application_idx").on(table.applicationId),
]);

/**
 * User Resumes
 * Stores resume files with version history
 */
export const userResumes = mysqlTable("user_resumes", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: varchar("file_url", { length: 1000 }).notNull(),
  fileKey: varchar("file_key", { length: 500 }).notNull(),
  fileSize: int("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  version: int("version").default(1).notNull(),
  isActive: int("is_active").default(1).notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("user_resumes_user_active_version_idx").on(table.userId, table.isActive, table.version),
]);

/**
 * Saved Jobs (Bookmarks)
 * Stores jobs saved by users for later review
 */
export const savedJobs = mysqlTable("saved_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  jobId: int("job_id").notNull(),
  notes: text("notes"),
  tags: text("tags"),
  priority: mysqlEnum("priority", ["low", "medium", "high"]).default("medium"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("saved_jobs_user_job_unique").on(table.userId, table.jobId),
  index("saved_jobs_user_updated_idx").on(table.userId, table.updatedAt),
]);

/**
 * Application Notes
 * Stores detailed notes for applications
 */
export const applicationNotes = mysqlTable("application_notes", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  noteType: mysqlEnum("note_type", ["general", "interview", "followup", "research", "feedback"]).default("general"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/**
 * Interview Schedules
 * Tracks scheduled interviews
 */
export const interviewSchedules = mysqlTable("interview_schedules", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  employerResponseId: int("employer_response_id").references(() => employerResponses.id, { onDelete: "set null" }),
  interviewType: mysqlEnum("interview_type", ["phone", "video", "onsite", "technical", "behavioral", "panel"]).notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  duration: int("duration"),
  location: varchar("location", { length: 500 }),
  meetingLink: varchar("meeting_link", { length: 500 }),
  interviewerName: varchar("interviewer_name", { length: 255 }),
  interviewerTitle: varchar("interviewer_title", { length: 255 }),
  notes: text("notes"),
  status: mysqlEnum("status", ["scheduled", "completed", "cancelled", "rescheduled"]).default("scheduled"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("interview_schedules_application_scheduled_idx").on(table.applicationId, table.scheduledAt),
  index("interview_schedules_application_status_created_response_idx").on(
    table.applicationId,
    table.status,
    table.createdAt,
    table.employerResponseId
  ),
  index("interview_schedules_status_scheduled_idx").on(table.status, table.scheduledAt),
  index("interview_schedules_status_updated_id_idx").on(table.status, table.updatedAt, table.id),
]);

/**
 * Work Experiences
 * Stores structured work history for resume-style profiles
 */
export const workExperiences = mysqlTable("work_experiences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  jobTitle: varchar("job_title", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }).notNull(),
  location: varchar("location", { length: 255 }),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  isCurrent: int("is_current").default(0),
  description: text("description"),
  achievements: text("achievements"),
  skills: text("skills"),
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("work_experiences_user_sort_idx").on(table.userId, table.sortOrder),
]);

/**
 * Education
 * Stores structured education history for resume-style profiles
 */
export const educationEntries = mysqlTable("education_entries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  degree: varchar("degree", { length: 255 }).notNull(),
  fieldOfStudy: varchar("field_of_study", { length: 255 }),
  institution: varchar("institution", { length: 255 }).notNull(),
  location: varchar("location", { length: 255 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  isCurrent: int("is_current").default(0),
  gpa: varchar("gpa", { length: 20 }),
  achievements: text("achievements"),
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("education_entries_user_sort_idx").on(table.userId, table.sortOrder),
]);

/**
 * Skills
 * Stores individual skills with proficiency levels
 */
export const userSkills = mysqlTable("user_skills", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  category: varchar("category", { length: 100 }),
  proficiency: mysqlEnum("proficiency", ["beginner", "intermediate", "advanced", "expert"]).default("intermediate"),
  yearsOfExperience: int("years_of_experience"),
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("user_skills_user_sort_idx").on(table.userId, table.sortOrder),
]);

/**
 * Projects
 * Stores portfolio projects
 */
export const userProjects = mysqlTable("user_projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  url: varchar("url", { length: 500 }),
  technologies: text("technologies"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/**
 * Job Alerts
 * Stores user-configured job alerts
 */
export const jobAlerts = mysqlTable("job_alerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  keywords: text("keywords"),
  locations: text("locations"),
  platforms: text("platforms"),
  minSalary: int("min_salary"),
  jobTypes: text("job_types"),
  frequency: mysqlEnum("frequency", ["instant", "daily", "weekly"]).default("daily"),
  isActive: int("is_active").default(1).notNull(),
  lastTriggered: timestamp("last_triggered"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("job_alerts_active_frequency_triggered_idx").on(table.isActive, table.frequency, table.lastTriggered),
]);

export type JobPlatform = typeof jobPlatforms.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobDuplicate = typeof jobDuplicates.$inferSelect;
export type UserProfile = typeof userProfiles.$inferSelect;
export type SocialMediaProfile = typeof socialMediaProfiles.$inferSelect;
export type UserConnectorAccount = typeof userConnectorAccounts.$inferSelect;
export type ConnectorAuthorization = typeof connectorAuthorizations.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type ApplicationDecision = typeof applicationDecisions.$inferSelect;
export type ApplicationMaterial = typeof applicationMaterials.$inferSelect;
export type ApplicationAttempt = typeof applicationAttempts.$inferSelect;
export type EmployerResponse = typeof employerResponses.$inferSelect;
export type InboxResponseCandidate = typeof inboxResponseCandidates.$inferSelect;
export type ApplicationNotification = typeof applicationNotifications.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type AdminReviewItem = typeof adminReviewItems.$inferSelect;
export type ApplicationApproval = typeof applicationApprovals.$inferSelect;
export type ApplicationCampaign = typeof applicationCampaigns.$inferSelect;
export type AutonomousRunState = typeof autonomousRunStates.$inferSelect;
export type DecisionMaker = typeof decisionMakers.$inferSelect;
export type JobMatch = typeof jobMatches.$inferSelect;
export type InterviewPreparation = typeof interviewPreparation.$inferSelect;
export type FollowUp = typeof followUps.$inferSelect;
export type UserResume = typeof userResumes.$inferSelect;
export type SavedJob = typeof savedJobs.$inferSelect;
export type ApplicationNote = typeof applicationNotes.$inferSelect;
export type InterviewSchedule = typeof interviewSchedules.$inferSelect;
export type JobAlertConfig = typeof jobAlerts.$inferSelect;
export type WorkExperience = typeof workExperiences.$inferSelect;
export type EducationEntry = typeof educationEntries.$inferSelect;
export type UserSkill = typeof userSkills.$inferSelect;
export type UserProject = typeof userProjects.$inferSelect;

/**
 * Success Fees
 * Tracks 5% monthly salary fees for users who land jobs via the platform
 */
export const successFees = mysqlTable("success_fees", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  applicationId: int("application_id").references(() => applications.id, { onDelete: "set null" }),
  employerName: varchar("employer_name", { length: 255 }).notNull(),
  jobTitle: varchar("job_title", { length: 255 }).notNull(),
  monthlySalary: int("monthly_salary").notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  feePercent: int("fee_percent").default(5).notNull(),
  monthlyFeeAmount: int("monthly_fee_amount").notNull(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripePriceId: varchar("stripe_price_id", { length: 255 }),
  stripeCheckoutSessionId: varchar("stripe_checkout_session_id", { length: 255 }),
  status: mysqlEnum("status", ["pending_verification", "active", "paused", "ended", "suspended", "disputed"]).default("pending_verification").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  nextVerificationDue: timestamp("next_verification_due"),
  verificationGraceExpiry: timestamp("verification_grace_expiry"),
  offerLetterUrl: varchar("offer_letter_url", { length: 1000 }),
  offerLetterKey: varchar("offer_letter_key", { length: 500 }),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("success_fees_stripe_subscription_unique").on(table.stripeSubscriptionId),
  index("success_fees_user_status_idx").on(table.userId, table.status),
  index("success_fees_user_created_id_idx").on(table.userId, table.createdAt, table.id),
  index("success_fees_user_application_created_idx").on(table.userId, table.applicationId, table.createdAt, table.id),
  index("success_fees_user_status_due_id_idx").on(table.userId, table.status, table.nextVerificationDue, table.id),
]);

/**
 * Employment Verifications
 * Tracks quarterly re-verification submissions
 */
export const employmentVerifications = mysqlTable("employment_verifications", {
  id: int("id").autoincrement().primaryKey(),
  successFeeId: int("success_fee_id").notNull().references(() => successFees.id, { onDelete: "cascade" }),
  userId: int("user_id").notNull(),
  verificationType: mysqlEnum("verification_type", ["initial", "quarterly"]).default("initial").notNull(),
  documentUrl: varchar("document_url", { length: 1000 }),
  documentKey: varchar("document_key", { length: 500 }),
  documentType: mysqlEnum("document_type", ["offer_letter", "paystub", "employment_letter", "bank_statement", "other"]).default("offer_letter"),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Fee Payments
 * Tracks monthly fee payment records
 */
export const feePayments = mysqlTable("fee_payments", {
  id: int("id").autoincrement().primaryKey(),
  successFeeId: int("success_fee_id").notNull().references(() => successFees.id, { onDelete: "cascade" }),
  userId: int("user_id").notNull(),
  amount: int("amount").notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  stripeInvoiceId: varchar("stripe_invoice_id", { length: 255 }),
  status: mysqlEnum("status", ["pending", "paid", "failed", "refunded"]).default("pending").notNull(),
  paidAt: timestamp("paid_at"),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("fee_payments_stripe_invoice_unique").on(table.stripeInvoiceId),
  index("fee_payments_success_fee_status_idx").on(table.successFeeId, table.status),
]);

/**
 * Stripe Webhook Events
 * A durable event ledger prevents duplicate delivery from repeating payment writes
 * or success-fee state changes.
 */
export const stripeWebhookEvents = mysqlTable("stripe_webhook_events", {
  id: int("id").autoincrement().primaryKey(),
  stripeEventId: varchar("stripe_event_id", { length: 255 }).notNull(),
  eventType: varchar("event_type", { length: 120 }).notNull(),
  status: mysqlEnum("status", ["processing", "processed", "failed"]).default("processing").notNull(),
  errorMessage: text("error_message"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("stripe_webhook_events_event_id_unique").on(table.stripeEventId),
  index("stripe_webhook_events_status_received_idx").on(table.status, table.receivedAt),
]);

export type SuccessFee = typeof successFees.$inferSelect;
export type InsertSuccessFee = typeof successFees.$inferInsert;
export type EmploymentVerification = typeof employmentVerifications.$inferSelect;
export type FeePayment = typeof feePayments.$inferSelect;
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
