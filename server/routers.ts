import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { normalizeSalary, normalizeLocation, normalizeJobType, normalizeExperienceLevel, extractSkills, extractBenefits, getDeduplicator } from "./jobNormalization";
import { isJobCurrentForAutonomousProcessing } from "./autonomousOrchestrator";
import { isConnectorAuthorizationStale } from "@shared/profileEvidence";
import { resolveProfileCandidateEvidence } from "@shared/profileSkillEvidence";
import { successFeesRouter } from "./routers/successFees";
import { adminRouter } from "./routers/admin";
import { workspacesRouter } from "./routers/workspaces";
import { uploadResume, getActiveResume, setActiveVersion, deleteResumeVersion, getResumeStats, getResumeDownloadUrl } from "./resumeStorage";
import {
  saveJob,
  unsaveJob,
  updateSavedJobNotes,
  addApplicationNote,
  getRecentApplicationNotes,
  updateApplicationNote,
  deleteApplicationNote,
  scheduleInterview,
  getInterviewSchedulePage,
  getUpcomingInterviews,
  updateInterviewStatus,
  recordInterviewOutcome,
  rescheduleInterview,
  confirmApplicationSubmission,
  recordEmployerResponse,
  createFollowUp,
  getFollowUpPage,
  withdrawApplication,
  acceptOfferApplication,
  markFollowUpSent,
  markFollowUpResponseReceived,
  generateInterviewPreparationForApplication,
  generateInterviewQuestionsForApplication,
  conductMockInterviewForApplication,
  getVideoInterviewTipsForApplication,
  generateEmployerReplyEmail,
  generateFollowUpEmail,
  createJobAlert,
  updateJobAlert,
  toggleJobAlert,
  deleteJobAlert,
} from "./applicationFeatures";
import { MAX_FOLLOW_UP_MESSAGE_CHARS } from "./messageSanitization";
import { SUPPORTED_LOCALES } from "@shared/localization";

const boundedPageSize = z.number().int().min(1).max(100);
const boundedOffset = z.number().int().min(0).max(100_000);
const boundedFilterText = z.string().trim().min(1).max(200);
const boundedShortText = z.string().trim().min(1).max(255);
const boundedNarrativeText = z.string().trim().min(1).max(20_000);
const boundedAiList = z.array(z.string().trim().min(1).max(500)).max(50);
const boundedResumeText = z.string().trim().min(1).max(500_000);
// 10 MiB of binary data expands to just under 14 MiB when base64 encoded.
const boundedUploadBase64 = z.string().min(1).max(14_000_000);
const boundedFileName = z.string().trim().min(1).max(255);
const boundedMimeType = z.string().trim().min(1).max(120);
const boundedProfilePayload = z.string().max(50_000);
const boundedNoteText = z.string().max(10_000);
const boundedTagsText = z.string().max(2_000);
const validDate = z.coerce.date();
const jobListPageSize = z.number().int().min(1).max(250);
const jobCatalogPageSize = z.number().int().min(1).max(100);
const jobSearchFiltersInput = z.object({
  query: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  jobType: z.enum(["all", "full-time", "part-time", "contract", "temporary"]).optional(),
  platformId: z.string().trim().max(20).optional(),
  salaryRange: z.tuple([z.number().min(0).max(10_000_000), z.number().min(0).max(10_000_000)]).optional(),
  salaryCurrency: z.union([z.literal("all"), z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase())]).optional(),
  remoteOnly: z.boolean().optional(),
  experienceLevel: z.enum(["all", "entry", "junior", "mid", "senior", "lead", "executive"]).optional(),
  applicationProcess: z.enum(["all", "greenhouse", "lever", "workday", "email", "other"]).optional(),
  visaSponsorshipOnly: z.boolean().optional(),
  openHiringSupportOnly: z.boolean().optional(),
  diversityFriendlyOnly: z.boolean().optional(),
  salaryDisclosedOnly: z.boolean().optional(),
  postedWithin: z.enum(["all", "1", "3", "7", "30"]).optional(),
  listingSafety: z.enum(["all", "clear", "review", "blocked"]).optional(),
}).optional();
const auditEntityType = z.enum(["job", "application", "success_fee", "verification", "user", "admin_review", "workspace"]);
const connectorProvider = z.enum([
  "gmail",
  "google_drive",
  "dropbox",
  "outlook",
  "linkedin",
  "github",
  "portfolio",
]);
const safeHttpUrl = z.string().trim().max(1000).url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "URL must use HTTP or HTTPS");
const safeProjectUrl = z.string().trim().max(500).url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "Project URL must use HTTP or HTTPS");
const socialProfileText = z.string().trim().min(1).max(30_000);
const profileMatchEvidenceFields = [
  "skills",
  "experience",
  "desiredJobTypes",
  "desiredLocations",
  "salaryExpectationMin",
  "salaryExpectationMax",
  "salaryExpectationCurrency",
  "needsVisaSponsorship",
] as const;

function profileMatchEvidenceChanged(input: object) {
  return profileMatchEvidenceFields.some((field) =>
    Object.prototype.hasOwnProperty.call(input, field)
  );
}

function defaultConnectorScopes(provider: z.infer<typeof connectorProvider>) {
  switch (provider) {
    case "gmail":
      return ["email.metadata.read", "email.messages.read_recruiting"];
    case "outlook":
      return ["mail.metadata.read", "mail.messages.read_recruiting"];
    case "google_drive":
      return ["files.metadata.read", "files.content.read_resume_candidates"];
    case "dropbox":
      return ["files.metadata.read", "files.content.read_resume_candidates"];
    case "linkedin":
      return ["profile.basic.read"];
    case "github":
      return ["profile.basic.read", "repositories.metadata.read"];
    case "portfolio":
      return ["profile.url.verify"];
  }
}

function profileSnapshotForApplication(
  user: { name?: string | null; email?: string | null },
  profile?: {
    skills?: string | null;
    experience?: string | null;
    education?: string | null;
    preferences?: string | null;
    desiredJobTypes?: string | null;
    desiredLocations?: string | null;
    salaryExpectationMin?: number | null;
    salaryExpectationMax?: number | null;
    salaryExpectationCurrency?: string | null;
    resumeUrl?: string | null;
    resumeFileKey?: string | null;
    linkedinUrl?: string | null;
    githubUrl?: string | null;
    portfolioUrl?: string | null;
  } | null
) {
  return JSON.stringify({
    user: {
      name: user.name || null,
      email: user.email || null,
    },
    profile: profile ? {
      skills: profile.skills || null,
      experience: profile.experience || null,
      education: profile.education || null,
      preferences: profile.preferences || null,
      desiredJobTypes: profile.desiredJobTypes || null,
      desiredLocations: profile.desiredLocations || null,
      salaryExpectationMin: profile.salaryExpectationMin ?? null,
      salaryExpectationMax: profile.salaryExpectationMax ?? null,
      salaryExpectationCurrency: profile.salaryExpectationCurrency || "USD",
      resumeUrl: profile.resumeUrl || null,
      resumeFileKey: profile.resumeFileKey || null,
      linkedinUrl: profile.linkedinUrl || null,
      githubUrl: profile.githubUrl || null,
      portfolioUrl: profile.portfolioUrl || null,
    } : null,
  });
}

function assertJobCurrentForPreparation(job: Awaited<ReturnType<typeof import("./db")["getJobById"]>>) {
  if (!job || !isJobCurrentForAutonomousProcessing(job)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This job is no longer active. Refresh discovery before preparing an application.",
    });
  }
}

function allowedConnectorScopes(provider: z.infer<typeof connectorProvider>) {
  const baselineScopes = defaultConnectorScopes(provider);
  switch (provider) {
    case "gmail":
      return [...baselineScopes, "email.messages.send"];
    case "outlook":
      return [...baselineScopes, "mail.messages.send"];
    default:
      return baselineScopes;
  }
}

function assertJobSearchTermsAccepted(user: {
  tosAcceptedAt?: Date | null;
  accountStatus?: string | null;
}) {
  if (user.accountStatus && user.accountStatus !== "active") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Job-search actions are unavailable while this account is not active.",
    });
  }
  if (!user.tosAcceptedAt) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Accept the Terms of Service before managing job-search applications, interviews, follow-ups, or offers.",
    });
  }
}

function resolveConnectorScopes(
  provider: z.infer<typeof connectorProvider>,
  requestedScopes?: string[]
) {
  const baselineScopes = defaultConnectorScopes(provider);
  const allowedScopes = allowedConnectorScopes(provider);
  const requested = requestedScopes?.length
    ? Array.from(new Set(requestedScopes.map((scope) => scope.trim()).filter(Boolean)))
    : baselineScopes;
  const unsupportedScopes = requested.filter((scope) => !allowedScopes.includes(scope));
  if (unsupportedScopes.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Requested connector scope is not permitted for ${provider}: ${unsupportedScopes.join(", ")}.`,
    });
  }
  const missingBaselineScopes = baselineScopes.filter((scope) => !requested.includes(scope));
  if (missingBaselineScopes.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Requested connector consent for ${provider} must include its monitoring baseline: ${missingBaselineScopes.join(", ")}.`,
    });
  }
  return requested;
}

/**
 * Connector implementations can receive provider, transport, and token
 * errors. Those details are useful only in protected server diagnostics and
 * must never be returned through a candidate-facing API response.
 */
export function safeExternalConnectorErrorMessage(_error: unknown, fallback: string) {
  return fallback;
}

function toPrivacyDeletionRequestView(review: {
  id: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
} | null) {
  if (!review) return null;
  return {
    id: review.id,
    status: review.status,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    resolvedAt: review.resolvedAt,
  };
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  workspaces: workspacesRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    acceptTos: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.update(users).set({ tosAcceptedAt: new Date() }).where(eq(users.id, ctx.user.id));
      return { success: true };
    }),
    updateLocale: protectedProcedure
      .input(z.object({ locale: z.enum(SUPPORTED_LOCALES) }))
      .mutation(async ({ ctx, input }) => {
        const { createAuditEvent, updateUserLocale } = await import("./db");
        const previousLocale = ctx.user.locale;
        await updateUserLocale(ctx.user.id, input.locale);
        await createAuditEvent({
          userId: ctx.user.id,
          entityType: "user",
          entityId: ctx.user.id,
          action: "account_locale_updated",
          actor: "user",
          source: "auth.updateLocale",
          beforeState: JSON.stringify({ locale: previousLocale }),
          afterState: JSON.stringify({ locale: input.locale }),
          riskLevel: "low",
        });
        return { locale: input.locale };
      }),
  }),
  privacy: router({
    getDeletionRequest: protectedProcedure.query(async ({ ctx }) => {
      const { getLatestPrivacyDeletionReview } = await import("./db");
      return toPrivacyDeletionRequestView(await getLatestPrivacyDeletionReview(ctx.user.id));
    }),
    requestDeletion: protectedProcedure
      .input(z.object({
        reason: z.string().trim().min(1).max(1000).optional(),
      }).optional())
      .mutation(async ({ ctx, input }) => {
        const { createAuditEvent, requestPrivacyDeletionReview } = await import("./db");
        const review = await requestPrivacyDeletionReview(ctx.user.id, input?.reason);
        await createAuditEvent({
          userId: ctx.user.id,
          entityType: "user",
          entityId: ctx.user.id,
          action: "privacy_deletion_requested",
          actor: "user",
          source: "privacy.requestDeletion",
          afterState: JSON.stringify({ reviewItemId: review?.id ?? null, status: review?.status ?? "open" }),
          riskLevel: "high",
        });
        return toPrivacyDeletionRequestView(review);
      }),
    cancelDeletionRequest: protectedProcedure.mutation(async ({ ctx }) => {
      const { cancelPrivacyDeletionReview, createAuditEvent } = await import("./db");
      const review = await cancelPrivacyDeletionReview(ctx.user.id);
      await createAuditEvent({
        userId: ctx.user.id,
        entityType: "user",
        entityId: ctx.user.id,
        action: "privacy_deletion_cancelled",
        actor: "user",
        source: "privacy.cancelDeletionRequest",
        afterState: JSON.stringify({ reviewItemId: review.id, status: review.status }),
        riskLevel: "medium",
      });
      return toPrivacyDeletionRequestView(review);
    }),
    exportData: protectedProcedure.query(async ({ ctx }) => {
      const { buildPrivacyDataExport } = await import("./privacyData");
      const { createAuditEvent } = await import("./db");
      const data = await buildPrivacyDataExport(ctx.user.id);
      await createAuditEvent({
        userId: ctx.user.id,
        entityType: "user",
        entityId: ctx.user.id,
        action: "privacy_data_exported",
        actor: "user",
        source: "privacy.exportData",
        afterState: JSON.stringify({ schemaVersion: data.schemaVersion }),
        riskLevel: "low",
      });
      return data;
    }),
  }),

  audit: router({
    getForUser: protectedProcedure
      .input(z.object({
        limit: boundedPageSize.optional().default(25),
      }).optional())
      .query(async ({ ctx, input }) => {
        const { getAuditEventsForUser } = await import("./db");
        return await getAuditEventsForUser(ctx.user.id, input?.limit ?? 25);
      }),
    getForEntity: protectedProcedure
      .input(z.object({
        entityType: auditEntityType,
        entityId: z.number().int().positive(),
        limit: boundedPageSize.optional().default(25),
      }))
      .query(async ({ ctx, input }) => {
        const { getRecentAuditEventsForEntity } = await import("./db");
        return await getRecentAuditEventsForEntity(
          ctx.user.id,
          input.entityType,
          input.entityId,
          input.limit
        );
      }),
  }),

  connectors: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { listUserConnectorAccounts } = await import("./db");
      return await listUserConnectorAccounts(ctx.user.id);
    }),
    getOAuthAvailability: protectedProcedure.query(async () => {
      const { getConnectorOAuthAvailability, isOAuthConnectorProvider } = await import("./connectorOAuth");
      return connectorProvider.options.map((provider) => ({
        provider,
        available: isOAuthConnectorProvider(provider)
          ? getConnectorOAuthAvailability(provider).available
          : false,
      }));
    }),
    startOAuth: protectedProcedure
      .input(z.object({
        provider: connectorProvider,
        consentScopes: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const {
          buildConnectorAuthorizationUrl,
          createConnectorOAuthState,
          getConnectorOAuthAvailability,
          getConnectorOAuthConfig,
          isOAuthConnectorProvider,
        } = await import("./connectorOAuth");
        if (!isOAuthConnectorProvider(input.provider)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This evidence source is verified manually and does not support OAuth authorization.",
          });
        }
        if (!getConnectorOAuthAvailability(input.provider).available) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `${input.provider} OAuth is not configured for this deployment.`,
          });
        }
        const consentScopes = resolveConnectorScopes(input.provider, input.consentScopes);
        const config = getConnectorOAuthConfig(input.provider, undefined, consentScopes);
        if (!config) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `${input.provider} OAuth is not configured for this deployment.`,
          });
        }

        const { getUserConnectorAccount, requestUserConnectorConnection, createAuditEvent } = await import("./db");
        const existingAccount = await getUserConnectorAccount(ctx.user.id, input.provider);
        // Preserve a verified mailbox while the user completes an optional
        // consent upgrade. A cancelled upgrade must not interrupt monitoring.
        const account = existingAccount?.status === "connected"
          ? existingAccount
          : await requestUserConnectorConnection({
            userId: ctx.user.id,
            provider: input.provider,
            consentScopes,
          });
        const state = createConnectorOAuthState({
          provider: input.provider,
          userId: ctx.user.id,
          consentScopes,
        });
        await createAuditEvent({
          userId: ctx.user.id,
          entityType: "user",
          entityId: ctx.user.id,
          action: "connector_oauth_started",
          actor: "user",
          source: "connectors.startOAuth",
          afterState: JSON.stringify({
            provider: input.provider,
            status: existingAccount?.status === "connected" ? "authorization_upgrade_requested" : "connection_requested",
            consentScopes,
          }),
          riskLevel: "medium",
        });
        return {
          success: true,
          account,
          authorizationUrl: buildConnectorAuthorizationUrl(config, state),
        };
      }),
    requestConnection: protectedProcedure
      .input(z.object({
        provider: connectorProvider,
        consentScopes: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { isOAuthConnectorProvider } = await import("./connectorOAuth");
        const { requestUserConnectorConnection, createAuditEvent } = await import("./db");
        const requiresOAuth = isOAuthConnectorProvider(input.provider);
        const consentScopes = resolveConnectorScopes(input.provider, input.consentScopes);
        const account = await requestUserConnectorConnection({
          userId: ctx.user.id,
          provider: input.provider,
          consentScopes,
        });

        await createAuditEvent({
          userId: ctx.user.id,
          entityType: "user",
          entityId: ctx.user.id,
          action: "connector_connection_requested",
          actor: "user",
          source: "connectors.requestConnection",
          afterState: JSON.stringify({
            provider: input.provider,
            status: "connection_requested",
            consentScopes,
          }),
          riskLevel: "medium",
        });

        return {
          success: true,
          requiresOAuth,
          account,
          message: requiresOAuth
            ? "Connection request recorded. OAuth authorization is still required before Hire.AI can read external data."
            : "Connection request recorded. Add or verify the source URL before Hire.AI can use this evidence.",
        };
      }),
    disconnect: protectedProcedure
      .input(z.object({ provider: connectorProvider }))
      .mutation(async ({ ctx, input }) => {
        const { createAuditEvent } = await import("./db");
        const { disconnectConnectorAccess } = await import("./connectorDisconnect");
        const { account, providerRevocation } = await disconnectConnectorAccess(
          ctx.user.id,
          input.provider
        );

        await createAuditEvent({
          userId: ctx.user.id,
          entityType: "user",
          entityId: ctx.user.id,
          action: "connector_disconnected",
          actor: "user",
          source: "connectors.disconnect",
          afterState: JSON.stringify({
            provider: input.provider,
            status: "disabled",
            providerRevocation: providerRevocation.status,
          }),
          riskLevel: providerRevocation.status === "failed" ? "high" : "low",
        });

        return {
          success: true,
          account,
          providerRevocation,
        };
      }),
  }),

  // Job Platforms
  platforms: router({
    list: publicProcedure.query(async () => {
      const { ensureScraperPlatformCatalog, getAllJobPlatforms } = await import("./db");
      const { getPlatformDiscoveryPolicy } = await import("./scrapers/platformCatalog");
      await ensureScraperPlatformCatalog();
      return (await getAllJobPlatforms()).map((platform) => ({
        ...platform,
        discoveryPolicy: getPlatformDiscoveryPolicy(platform.name),
      }));
    }),
    active: publicProcedure.query(async () => {
      const { ensureScraperPlatformCatalog, getActiveJobPlatforms } = await import("./db");
      const { getPlatformDiscoveryPolicy } = await import("./scrapers/platformCatalog");
      await ensureScraperPlatformCatalog();
      return (await getActiveJobPlatforms()).map((platform) => ({
        ...platform,
        discoveryPolicy: getPlatformDiscoveryPolicy(platform.name),
      }));
    }),
  }),

  // Jobs
  jobs: router({
    getDiscoveryStatus: publicProcedure.query(async () => {
      const { getJobDiscoveryStatus } = await import("./db");
      return await getJobDiscoveryStatus();
    }),
    list: publicProcedure
      .input(
        z.object({
          limit: jobListPageSize.optional().default(50),
          offset: boundedOffset.optional().default(0),
          filters: jobSearchFiltersInput,
        })
      )
      .query(async ({ input }) => {
        const { getActiveJobs } = await import("./db");
        return await getActiveJobs(input.limit, input.offset, input.filters);
      }),
    listPage: publicProcedure
      .input(
        z.object({
          limit: jobCatalogPageSize.optional().default(50),
          cursor: z.object({
            postedDate: z.date().nullable(),
            createdAt: z.date(),
            id: z.number().int().positive(),
          }).optional(),
          filters: jobSearchFiltersInput,
        })
      )
      .query(async ({ input }) => {
        const { getActiveJobPage } = await import("./db");
        return await getActiveJobPage(input);
      }),
    search: publicProcedure
      .input(
        z.object({
          title: boundedFilterText.optional(),
          company: boundedFilterText.optional(),
          location: boundedFilterText.optional(),
          skills: boundedFilterText.optional(),
          limit: boundedPageSize.optional().default(50),
          offset: boundedOffset.optional().default(0),
        })
      )
      .query(async ({ input }) => {
        const { searchJobs } = await import("./db");
        return await searchJobs(input);
      }),
    getById: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const { getJobById } = await import("./db");
        return await getJobById(input.id);
      }),
    getSources: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const { getJobAggregationSources } = await import("./db");
        return await getJobAggregationSources(input.id);
      }),

    // Saved Jobs
    saveJob: protectedProcedure
      .input(z.object({
        jobId: z.number().int().positive(),
        notes: boundedNoteText.optional(),
        tags: boundedTagsText.optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return await saveJob({
          userId: ctx.user.id,
          jobId: input.jobId,
          notes: input.notes,
          tags: input.tags,
          priority: input.priority,
        });
      }),

    unsaveJob: protectedProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        return await unsaveJob(ctx.user.id, input.jobId);
      }),

    getSavedJobPage: protectedProcedure
      .input(z.object({
        limit: boundedPageSize.optional().default(50),
        cursor: z.object({
          updatedAt: z.date(),
          id: z.number().int().positive(),
        }).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const { getSavedJobPage } = await import("./applicationFeatures");
        return await getSavedJobPage(ctx.user.id, input);
      }),

    updateSavedJobNotes: protectedProcedure
      .input(z.object({
        jobId: z.number().int().positive(),
        notes: boundedNoteText,
        tags: boundedTagsText.optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return await updateSavedJobNotes(
          ctx.user.id,
          input.jobId,
          input.notes,
          input.tags,
          input.priority
        );
      }),
  }),

  // User Profile
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const { getUserProfile } = await import("./db");
      return await getUserProfile(ctx.user.id) ?? null;
    }),
    getReadiness: protectedProcedure.query(async ({ ctx }) => {
      const {
        getUserProfile,
        getWorkExperiences,
        getEducationEntries,
        getUserSkills,
      } = await import("./db");
      const { calculateProfileReadiness } = await import("./profileReadiness");
      const [profile, workExperiences, educationEntries, skills] = await Promise.all([
        getUserProfile(ctx.user.id),
        getWorkExperiences(ctx.user.id),
        getEducationEntries(ctx.user.id),
        getUserSkills(ctx.user.id),
      ]);
      const activeResume = await getActiveResume(ctx.user.id);
      return calculateProfileReadiness({
        profile,
        workExperiences,
        educationEntries,
        skills,
        hasActiveResumeArtifact: Boolean(activeResume),
      });
    }),
    getEvidenceReadiness: protectedProcedure.query(async ({ ctx }) => {
      const {
        getUserProfile,
        getWorkExperiences,
        getEducationEntries,
        getUserSkills,
        listUserConnectorAccounts,
      } = await import("./db");
      const { calculateProfileReadiness } = await import("./profileReadiness");
      const { getProfileEvidenceControlSummary } = await import("@shared/profileEvidence");
      const [profile, workExperiences, educationEntries, skills, connectorAccounts, activeResume] = await Promise.all([
        getUserProfile(ctx.user.id),
        getWorkExperiences(ctx.user.id),
        getEducationEntries(ctx.user.id),
        getUserSkills(ctx.user.id),
        listUserConnectorAccounts(ctx.user.id),
        getActiveResume(ctx.user.id),
      ]);
      const readiness = calculateProfileReadiness({
        profile,
        workExperiences,
        educationEntries,
        skills,
        hasActiveResumeArtifact: Boolean(activeResume),
      });
      return getProfileEvidenceControlSummary({
        profile,
        readiness,
        hasActiveResumeArtifact: Boolean(activeResume),
        connectorAccounts: connectorAccounts.map((account) => ({
          provider: account.provider,
          status: account.status,
          externalAccountLabel: account.externalAccountLabel,
          consentScopes: account.consentScopes,
          lastVerifiedAt: account.lastVerifiedAt,
        })),
      });
    }),
    update: protectedProcedure
      .input(
        z.object({
          skills: boundedProfilePayload.optional(),
          experience: boundedProfilePayload.optional(),
          education: boundedProfilePayload.optional(),
          preferences: boundedProfilePayload.optional(),
          desiredJobTypes: z.string().trim().max(500).nullable().optional(),
          desiredLocations: z.string().trim().max(500).nullable().optional(),
          salaryExpectationMin: z.number().int().min(0).max(10_000_000).nullable().optional(),
          salaryExpectationMax: z.number().int().min(0).max(10_000_000).nullable().optional(),
          salaryExpectationCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
          resumeUrl: safeHttpUrl.optional(),
          resumeFileKey: z.string().trim().max(500).optional(),
          linkedinUrl: safeHttpUrl.nullable().optional(),
          githubUrl: safeHttpUrl.nullable().optional(),
          portfolioUrl: safeHttpUrl.nullable().optional(),
          diversityGroup: z.string().trim().max(255).optional(),
          needsVisaSponsorship: z.number().int().min(0).max(1).optional(),
        }).superRefine((value, context) => {
          if (
            value.salaryExpectationMin !== undefined &&
            value.salaryExpectationMax !== undefined &&
            value.salaryExpectationMin !== null &&
            value.salaryExpectationMax !== null &&
            value.salaryExpectationMin > value.salaryExpectationMax
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["salaryExpectationMax"],
              message: "Maximum salary must be at least the minimum salary.",
            });
          }
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { validateLinkedInUrl, validateGitHubUrl, validatePortfolioUrl } = await import("./socialConnections");
        const { upsertUserProfile } = await import("./db");
        const invalidConnection =
          (input.linkedinUrl && !validateLinkedInUrl(input.linkedinUrl)) ||
          (input.githubUrl && !validateGitHubUrl(input.githubUrl)) ||
          (input.portfolioUrl && !validatePortfolioUrl(input.portfolioUrl));
        if (invalidConnection) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "One or more social profile URLs are invalid.",
          });
        }
        await upsertUserProfile({
          userId: ctx.user.id,
          ...input,
        });
        const matchRefresh = profileMatchEvidenceChanged(input)
          ? await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
              userId: ctx.user.id,
              source: "profile.update",
            })
          : null;
        return { success: true, matchRefresh };
      }),

    updatePreferences: protectedProcedure
      .input(z.object({
        autonomousEnabled: z.boolean().optional(),
        mode: z.enum(["review_first", "auto_apply"]).optional(),
        dailyApplicationLimit: z.number().int().min(1).max(100).optional(),
        minMatchScore: z.number().int().min(0).max(100).optional(),
        remoteOnly: z.boolean().optional(),
        requireHumanReview: z.boolean().optional(),
        allowUnsupportedATS: z.boolean().optional(),
        createFollowUps: z.boolean().optional(),
        scanFrequency: z.enum(["continuous", "hourly", "daily", "twice-daily"]).optional(),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const { patchUserProfilePreferences } = await import("./db");
        const preferences = await patchUserProfilePreferences(ctx.user.id, input);
        return { success: true, preferences };
      }),

    discoverLinkedInIdentity: protectedProcedure
      .mutation(async ({ ctx }) => {
        const { discoverLinkedInIdentity } = await import("./linkedInProfileDiscovery");
        const { createAuditEvent } = await import("./db");
        try {
          const candidate = await discoverLinkedInIdentity(ctx.user.id);
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "user",
            entityId: ctx.user.id,
            action: "linkedin_identity_discovered",
            actor: "user",
            source: "profile.discoverLinkedInIdentity",
            afterState: JSON.stringify({
              hasName: Boolean(candidate.name),
              hasEmail: Boolean(candidate.email),
              emailVerified: candidate.emailVerified,
            }),
            riskLevel: "low",
          });
          return candidate;
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeExternalConnectorErrorMessage(
              error,
              "LinkedIn identity discovery could not be completed. Verify connector consent and reauthorize before retrying."
            ),
          });
        }
      }),

    discoverGitHubProfile: protectedProcedure
      .mutation(async ({ ctx }) => {
        const { discoverGitHubProfile } = await import("./githubProfileDiscovery");
        const { createAuditEvent } = await import("./db");
        try {
          const candidate = await discoverGitHubProfile(ctx.user.id);
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "user",
            entityId: ctx.user.id,
            action: "github_profile_discovered",
            actor: "user",
            source: "profile.discoverGitHubProfile",
            afterState: JSON.stringify({
              username: candidate.username,
              suggestedSkillCount: candidate.suggestedSkills.length,
              publicRepositoryCandidateCount: candidate.repositories.length,
            }),
            riskLevel: "low",
          });
          return candidate;
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeExternalConnectorErrorMessage(
              error,
              "GitHub profile discovery could not be completed. Verify connector consent and reauthorize before retrying."
            ),
          });
        }
      }),

    importGitHubProfile: protectedProcedure
      .input(z.object({
        repositoryUrls: z.array(safeHttpUrl).max(10).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { discoverGitHubProfile, mergeGitHubSkills } = await import("./githubProfileDiscovery");
        const { createAuditEvent, getUserProfile, upsertUserProfile } = await import("./db");
        try {
          // Re-read GitHub server-side so the client cannot supply unsupported skills or repositories.
          const candidate = await discoverGitHubProfile(ctx.user.id);
          const selectedUrls = new Set(input.repositoryUrls);
          const selectedRepositories = candidate.repositories.filter((repository) => selectedUrls.has(repository.url));
          const profile = await getUserProfile(ctx.user.id);
          const mergedSkills = mergeGitHubSkills(profile?.skills, candidate.suggestedSkills);
          await upsertUserProfile({
            userId: ctx.user.id,
            githubUrl: candidate.profileUrl,
            skills: mergedSkills || undefined,
          });
          const matchRefresh = await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
            userId: ctx.user.id,
            source: "profile.importGitHubProfile",
          });
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "user",
            entityId: ctx.user.id,
            action: "github_profile_imported",
            actor: "user",
            source: "profile.importGitHubProfile",
            afterState: JSON.stringify({
              username: candidate.username,
              addedSkills: candidate.suggestedSkills,
              selectedRepositoryCount: selectedRepositories.length,
              selectedRepositoryNames: selectedRepositories.map((repository) => repository.name),
              matchRefresh,
            }),
            riskLevel: "low",
          });
          return {
            profileUrl: candidate.profileUrl,
            addedSkills: candidate.suggestedSkills,
            selectedRepositories,
            matchRefresh,
          };
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeExternalConnectorErrorMessage(
              error,
              "GitHub profile import could not be completed. Verify connector consent and reauthorize before retrying."
            ),
          });
        }
      }),

    discoverCloudDocuments: protectedProcedure
      .input(z.object({ provider: z.enum(["google_drive", "dropbox"]) }))
      .mutation(async ({ ctx, input }) => {
        const { discoverCloudResumeDocuments } = await import("./cloudDocumentDiscovery");
        const { createAuditEvent } = await import("./db");
        try {
          const documents = await discoverCloudResumeDocuments(ctx.user.id, input.provider);
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "user",
            entityId: ctx.user.id,
            action: "cloud_resume_documents_discovered",
            actor: "user",
            source: "profile.discoverCloudDocuments",
            afterState: JSON.stringify({ provider: input.provider, documentCount: documents.length }),
            riskLevel: "low",
          });
          return { provider: input.provider, documents };
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeExternalConnectorErrorMessage(
              error,
              "Cloud document discovery could not be completed. Verify connector consent and reauthorize before retrying."
            ),
          });
        }
      }),

    importCloudResume: protectedProcedure
      .input(z.object({
        provider: z.enum(["google_drive", "dropbox"]),
        sourceId: z.string().trim().min(1).max(1000),
        name: z.string().trim().min(1).max(500),
        mimeType: z.string().trim().min(1).max(255),
        size: z.number().int().min(0).max(10 * 1024 * 1024).nullable(),
        modifiedAt: z.string().datetime().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { downloadCloudResumeDocument } = await import("./cloudDocumentDiscovery");
        const { parseResumeFromFile, resumeToProfileData } = await import("./resumeParser");
        const { createAuditEvent, upsertUserProfile } = await import("./db");
        const { RESUME_MIME_TYPES, validateUploadedFile } = await import("./uploadValidation");
        try {
          const document = await downloadCloudResumeDocument(ctx.user.id, input);
          const validation = validateUploadedFile({
            data: document.data,
            fileName: document.fileName,
            mimeType: document.mimeType,
            allowedMimeTypes: RESUME_MIME_TYPES,
          });
          const parsed = await parseResumeFromFile(document.data, document.mimeType);
          const profileData = resumeToProfileData(parsed);
          const resume = await uploadResume(
            ctx.user.id,
            document.data,
            validation.fileName,
            document.mimeType
          );
          await upsertUserProfile({
            userId: ctx.user.id,
            resumeUrl: resume.fileUrl,
            resumeFileKey: resume.fileKey,
            ...profileData,
          });
          const matchRefresh = await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
            userId: ctx.user.id,
            source: "profile.importCloudResume",
          });
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "user",
            entityId: ctx.user.id,
            action: "cloud_resume_imported",
            actor: "user",
            source: "profile.importCloudResume",
            afterState: JSON.stringify({
              provider: input.provider,
              resumeId: resume.id,
              resumeVersion: resume.version,
              matchRefresh,
            }),
            riskLevel: "medium",
          });
          return { success: true, parsed, profileData, resume, matchRefresh };
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeExternalConnectorErrorMessage(
              error,
              "Cloud resume import could not be completed. Verify the selected document and connector consent before retrying."
            ),
          });
        }
      }),

    // Work Experience
    getWorkExperiences: protectedProcedure.query(async ({ ctx }) => {
      const { getWorkExperiences } = await import("./db");
      return await getWorkExperiences(ctx.user.id);
    }),
    addWorkExperience: protectedProcedure
      .input(z.object({
        jobTitle: z.string().trim().min(1).max(255),
        company: z.string().trim().min(1).max(255),
        location: z.string().trim().max(255).optional(),
        startDate: validDate,
        endDate: validDate.optional(),
        isCurrent: z.number().int().min(0).max(1).optional(),
        description: z.string().trim().max(5000).optional(),
        achievements: z.string().trim().max(5000).optional(),
        skills: z.string().trim().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createWorkExperience } = await import("./db");
        const workExperience = await createWorkExperience({ userId: ctx.user.id, ...input });
        const matchRefresh = await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
          userId: ctx.user.id,
          source: "profile.addWorkExperience",
        });
        return { workExperience, matchRefresh };
      }),
    updateWorkExperience: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        jobTitle: z.string().trim().min(1).max(255).optional(),
        company: z.string().trim().min(1).max(255).optional(),
        location: z.string().trim().max(255).optional(),
        startDate: validDate.optional(),
        endDate: validDate.optional(),
        isCurrent: z.number().int().min(0).max(1).optional(),
        description: z.string().trim().max(5000).optional(),
        achievements: z.string().trim().max(5000).optional(),
        skills: z.string().trim().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const { updateWorkExperience } = await import("./db");
        const workExperience = await updateWorkExperience(id, ctx.user.id, data);
        const matchRefresh = await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
          userId: ctx.user.id,
          source: "profile.updateWorkExperience",
        });
        return { workExperience, matchRefresh };
      }),
    deleteWorkExperience: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { deleteWorkExperience } = await import("./db");
        const workExperience = await deleteWorkExperience(input.id, ctx.user.id);
        const matchRefresh = await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
          userId: ctx.user.id,
          source: "profile.deleteWorkExperience",
        });
        return { workExperience, matchRefresh };
      }),

    // Education
    getEducation: protectedProcedure.query(async ({ ctx }) => {
      const { getEducationEntries } = await import("./db");
      return await getEducationEntries(ctx.user.id);
    }),
    addEducation: protectedProcedure
      .input(z.object({
        degree: z.string().trim().min(1).max(255),
        fieldOfStudy: z.string().trim().max(255).optional(),
        institution: z.string().trim().min(1).max(255),
        location: z.string().trim().max(255).optional(),
        startDate: validDate.optional(),
        endDate: validDate.optional(),
        isCurrent: z.number().int().min(0).max(1).optional(),
        gpa: z.string().trim().max(20).optional(),
        achievements: z.string().trim().max(5000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createEducationEntry } = await import("./db");
        return await createEducationEntry({ userId: ctx.user.id, ...input });
      }),
    updateEducation: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        degree: z.string().trim().min(1).max(255).optional(),
        fieldOfStudy: z.string().trim().max(255).optional(),
        institution: z.string().trim().min(1).max(255).optional(),
        location: z.string().trim().max(255).optional(),
        startDate: validDate.optional(),
        endDate: validDate.optional(),
        isCurrent: z.number().int().min(0).max(1).optional(),
        gpa: z.string().trim().max(20).optional(),
        achievements: z.string().trim().max(5000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const { updateEducationEntry } = await import("./db");
        return await updateEducationEntry(id, ctx.user.id, data);
      }),
    deleteEducation: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { deleteEducationEntry } = await import("./db");
        return await deleteEducationEntry(input.id, ctx.user.id);
      }),

    // Skills
    getSkills: protectedProcedure.query(async ({ ctx }) => {
      const { getUserSkills } = await import("./db");
      return await getUserSkills(ctx.user.id);
    }),
    addSkill: protectedProcedure
      .input(z.object({
        skillName: z.string().trim().min(1).max(100),
        category: z.string().trim().max(100).optional(),
        proficiency: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
        yearsOfExperience: z.number().int().min(0).max(80).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createUserSkill } = await import("./db");
        const result = await createUserSkill({ userId: ctx.user.id, ...input });
        await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
          userId: ctx.user.id,
          source: "profile.addSkill",
        });
        return result;
      }),
    updateSkill: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        skillName: z.string().trim().min(1).max(100).optional(),
        category: z.string().trim().max(100).optional(),
        proficiency: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
        yearsOfExperience: z.number().int().min(0).max(80).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const { updateUserSkill } = await import("./db");
        const result = await updateUserSkill(id, ctx.user.id, data);
        await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
          userId: ctx.user.id,
          source: "profile.updateSkill",
        });
        return result;
      }),
    deleteSkill: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { deleteUserSkill } = await import("./db");
        const result = await deleteUserSkill(input.id, ctx.user.id);
        await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
          userId: ctx.user.id,
          source: "profile.deleteSkill",
        });
        return result;
      }),

    // Projects
    getProjects: protectedProcedure.query(async ({ ctx }) => {
      const { getUserProjects } = await import("./db");
      return await getUserProjects(ctx.user.id);
    }),
    addProject: protectedProcedure
      .input(z.object({
        title: z.string().trim().min(1).max(255),
        description: z.string().trim().max(5000).optional(),
        url: safeProjectUrl.optional(),
        technologies: z.string().trim().max(2000).optional(),
        startDate: validDate.optional(),
        endDate: validDate.optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createUserProject } = await import("./db");
        return await createUserProject({ userId: ctx.user.id, ...input });
      }),
    updateProject: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        title: z.string().trim().min(1).max(255).optional(),
        description: z.string().trim().max(5000).optional(),
        url: safeProjectUrl.nullable().optional(),
        technologies: z.string().trim().max(2000).optional(),
        startDate: validDate.optional(),
        endDate: validDate.optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const { updateUserProject } = await import("./db");
        return await updateUserProject(id, ctx.user.id, data);
      }),
    deleteProject: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { deleteUserProject } = await import("./db");
        return await deleteUserProject(input.id, ctx.user.id);
      }),
  }),

  // Applications
  applications: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getUserApplicationPage } = await import("./db");
      return (await getUserApplicationPage(ctx.user.id, { limit: 100 })).items;
    }),
    listPage: protectedProcedure
      .input(z.object({
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.object({
          createdAt: z.date(),
          id: z.number().int().positive(),
        }).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const { getUserApplicationPage } = await import("./db");
        return await getUserApplicationPage(ctx.user.id, input);
      }),
    listAcceptedOffers: protectedProcedure
      .input(z.object({ applicationId: z.number().int().positive().optional() }).strict())
      .query(async ({ ctx, input }) => {
        const { getUserAcceptedApplications } = await import("./db");
        return await getUserAcceptedApplications(ctx.user.id, {
          limit: 100,
          includeApplicationId: input.applicationId,
        });
      }),
    getSummary: protectedProcedure.query(async ({ ctx }) => {
      const { getUserApplicationSummary } = await import("./db");
      return await getUserApplicationSummary(ctx.user.id);
    }),
    getById: protectedProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const { getUserApplicationById } = await import("./db");
        return await getUserApplicationById(ctx.user.id, input.applicationId);
    }),
    create: protectedProcedure
      .input(
        z.object({
          jobId: z.number().int().positive(),
          coverLetter: z.string().max(50_000).optional(),
          customResume: boundedResumeText.optional(),
          notes: z.string().max(10_000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        const {
          createApplication,
          createApplicationMaterial,
          createApplicationAttempt,
          createAuditEvent,
          createAdminReviewItem,
          createApplicationApproval,
          getApplicationLedgerArtifacts,
          getJobById,
          getCanonicalJobId,
          getUserProfile,
          getUserSkills,
          getWorkExperiences,
          getPendingUserApplicationForJob,
        } = await import("./db");
        const canonicalJobId = await getCanonicalJobId(input.jobId);
        if (canonicalJobId === null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
        }
        input = { ...input, jobId: canonicalJobId };
        const job = await getJobById(input.jobId);
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
        }
        assertJobCurrentForPreparation(job);
        const activeResume = await getActiveResume(ctx.user.id);
        if (!activeResume) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "An active versioned resume is required before Hire.AI can prepare an application.",
          });
        }
        const {
          applicationPreparationBlockMessage,
          getApplicationPreparationSafety,
        } = await import("./applicationPreparationSafety");
        const preparationSafety = await getApplicationPreparationSafety(ctx.user.id);
        if (!preparationSafety.allowed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: applicationPreparationBlockMessage(preparationSafety),
          });
        }
        const [profile, skills, workExperiences] = await Promise.all([
          getUserProfile(ctx.user.id),
          getUserSkills(ctx.user.id),
          getWorkExperiences(ctx.user.id),
        ]);
        const profileForMaterial = resolveProfileCandidateEvidence(profile, skills, workExperiences);
        const { buildReviewApplicationMaterial } = await import("./applicationMaterialDraft");
        const existingApplication = await getPendingUserApplicationForJob(ctx.user.id, input.jobId);
        const existingArtifacts = existingApplication
          ? await getApplicationLedgerArtifacts(existingApplication.id, ctx.user.id).catch(() => null)
          : null;
        const material = existingArtifacts?.material
          ? null
          : buildReviewApplicationMaterial(profileForMaterial, job, input.coverLetter);
        const application = await createApplication({
          userId: ctx.user.id,
          jobId: input.jobId,
          coverLetter: material?.coverLetter,
          customResume: input.customResume,
          notes: input.notes || "Application prepared and queued for review.",
          status: "pending",
        });
        const applicationId = Number(application.insertId);
        const artifacts = existingArtifacts ?? (application.existing === true
          ? await getApplicationLedgerArtifacts(applicationId, ctx.user.id).catch(() => null)
          : null);
        const hasPreparedApplication = artifacts?.attempts.some((attempt) =>
          attempt.attemptType === "prepare" &&
          ["prepared", "review_required"].includes(attempt.status || "prepared")
        ) === true;
        if (application.existing === true && hasPreparedApplication) {
          return { success: true, applicationRecordId: applicationId, existing: true };
        }
        if (material) {
          await createApplicationMaterial({
            applicationId,
            resumeId: activeResume.id,
            coverLetter: material.coverLetter,
            customResume: input.customResume,
            customAnswers: material.customAnswers,
            claimsMade: material.claimsMade,
            sourceProfileSnapshot: profileSnapshotForApplication(ctx.user, profileForMaterial),
          });
        }
        await createApplicationAttempt({
          applicationId,
          userId: ctx.user.id,
          jobId: input.jobId,
          platformId: job.platformId,
          attemptType: "prepare",
          status: "review_required",
          finishedAt: new Date(),
          confirmationText: "Application materials were prepared and queued for user review.",
          retryCount: 0,
        });
        await createAuditEvent({
          userId: ctx.user.id,
          entityType: "application",
          entityId: applicationId,
          action: "application_prepared",
          actor: "user",
          source: "applications.create",
          afterState: JSON.stringify({
            jobId: input.jobId,
            status: "pending",
            reviewRequired: true,
            resume: { id: activeResume.id, version: activeResume.version },
            materialSource: material?.materialSource ?? "existing_application_material",
            userProvidedCoverLetter: material?.userProvidedCoverLetter ?? null,
          }),
          riskLevel: "medium",
        });
        await createAdminReviewItem({
          userId: ctx.user.id,
          entityType: "application",
          entityId: applicationId,
          category: "application_review",
          priority: "medium",
          title: "Application prepared for review",
          description: input.notes || "Application materials were prepared and require review before external submission.",
        });
        await createApplicationApproval({
          userId: ctx.user.id,
          applicationId,
          entityType: "application",
          entityId: applicationId,
          approvalType: "application_submission",
          status: "pending",
          riskLevel: "high",
          requestedBy: "system",
          title: "Approve external application submission",
          description: input.notes || "Prepared application materials require explicit approval before external submission is confirmed.",
          payload: JSON.stringify({
            jobId: input.jobId,
            source: "applications.create",
            status: "pending",
            resumeId: activeResume.id,
            resumeVersion: activeResume.version,
            materialSource: material?.materialSource ?? "existing_application_material",
            userProvidedCoverLetter: material?.userProvidedCoverLetter ?? null,
          }),
        });
        return { success: true, applicationRecordId: applicationId };
      }),
    decide: protectedProcedure
      .input(z.object({
        jobId: z.number().int().positive(),
        decision: z.enum(["apply", "save", "ignore", "review", "manual_apply"]),
        decisionReason: z.string().trim().min(1).max(5000),
        matchScore: z.number().int().min(0).max(100).optional(),
        riskLevel: z.enum(["low", "medium", "high"]).optional(),
        reviewRequired: z.boolean().optional(),
        reviewReason: z.string().trim().max(5000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const {
          createApplication,
          createApplicationDecision,
          createApplicationMaterial,
          createApplicationAttempt,
          createAuditEvent,
          createAdminReviewItem,
          createApplicationApproval,
          getApplicationLedgerArtifacts,
          getJobById,
          getCanonicalJobId,
          getPendingUserApplicationForJob,
          getUserProfile,
          getUserSkills,
          getWorkExperiences,
          listUserApplicationApprovalsForApplication,
          resolveApplicationApproval,
          updateApplicationStatus,
        } = await import("./db");
        const canonicalJobId = await getCanonicalJobId(input.jobId);
        if (canonicalJobId === null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
        }
        input = { ...input, jobId: canonicalJobId };
        const job = await getJobById(input.jobId);
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
        }

        const createsPreparedApplication = ["apply", "review", "manual_apply"].includes(input.decision);
        if (createsPreparedApplication) {
          assertJobSearchTermsAccepted(ctx.user);
          assertJobCurrentForPreparation(job);
        }
        const preparationSafety = createsPreparedApplication
          ? await (await import("./applicationPreparationSafety")).getApplicationPreparationSafety(ctx.user.id)
          : null;

        if (preparationSafety?.blockers.some((blocker) => blocker.key === "resume")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "An active versioned resume is required before Hire.AI can queue an application for review.",
          });
        }

        const reviewRequired = input.reviewRequired ?? input.decision !== "ignore";
        const result = await createApplicationDecision({
          userId: ctx.user.id,
          jobId: input.jobId,
          decision: input.decision,
          decisionReason: input.decisionReason,
          matchScore: input.matchScore,
          riskLevel: input.riskLevel || (reviewRequired ? "medium" : "low"),
          reviewRequired: reviewRequired ? 1 : 0,
          reviewReason: input.reviewReason,
          decidedBy: "user",
        });
        await createAuditEvent({
          userId: ctx.user.id,
          entityType: "job",
          entityId: input.jobId,
          action: "application_decision_recorded",
          actor: "user",
          source: "applications.decide",
          afterState: JSON.stringify({
            decision: input.decision,
            matchScore: input.matchScore ?? null,
            riskLevel: input.riskLevel || (reviewRequired ? "medium" : "low"),
            reviewRequired,
            reviewReason: input.reviewReason || null,
          }),
          riskLevel: input.riskLevel === "high" ? "high" : reviewRequired ? "medium" : "low",
        });

        if (createsPreparedApplication && preparationSafety && !preparationSafety.allowed) {
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "job",
            entityId: input.jobId,
            action: "application_preparation_blocked_profile_readiness",
            actor: "system",
            source: "applications.decide",
            afterState: JSON.stringify({
              decisionId: Number(result.insertId),
              decision: input.decision,
              readinessScore: preparationSafety.readinessScore,
              blockers: preparationSafety.blockers,
              externalSubmissionPerformed: false,
            }),
            riskLevel: "high",
          });
          return {
            success: true,
            decisionId: Number(result.insertId),
            applicationRecordId: null,
            existing: result.existing === true,
            preparationBlocked: true,
            blockers: preparationSafety.blockers,
          };
        }

        const activeResume = createsPreparedApplication
          ? await getActiveResume(ctx.user.id)
          : null;
        if (createsPreparedApplication && !activeResume) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "An active versioned resume is required before Hire.AI can queue an application for review.",
          });
        }
        const profile = createsPreparedApplication
          ? await getUserProfile(ctx.user.id)
          : null;
        const profileForMaterial = profile
          ? resolveProfileCandidateEvidence(
            profile,
            await getUserSkills(ctx.user.id),
            await getWorkExperiences(ctx.user.id)
          )
          : null;
        const { buildReviewApplicationMaterial } = await import("./applicationMaterialDraft");
        const existingPreparedApplication = createsPreparedApplication
          ? await getPendingUserApplicationForJob(ctx.user.id, input.jobId)
          : null;
        const existingPreparedArtifacts = existingPreparedApplication
          ? await getApplicationLedgerArtifacts(existingPreparedApplication.id, ctx.user.id).catch(() => null)
          : null;
        const material = createsPreparedApplication && !existingPreparedArtifacts?.material
          ? buildReviewApplicationMaterial(profileForMaterial, job)
          : null;

        let applicationRecordId: number | null = null;
        if (input.decision === "apply" || input.decision === "review" || input.decision === "manual_apply") {
          const application = await createApplication({
            userId: ctx.user.id,
            jobId: input.jobId,
            status: "pending",
            coverLetter: material?.coverLetter,
            notes: [
              `User decision: ${input.decision}.`,
              input.decisionReason,
              input.reviewReason ? `Review reason: ${input.reviewReason}` : "",
            ].filter(Boolean).join(" "),
            isAutoApplied: 0,
          });
          applicationRecordId = Number(application.insertId);
          const artifacts = existingPreparedArtifacts ?? (application.existing === true
            ? await getApplicationLedgerArtifacts(applicationRecordId, ctx.user.id).catch(() => null)
            : null);
          const hasQueuedDecisionAttempt = artifacts?.attempts.some((attempt) =>
            attempt.attemptType === "prepare" &&
            ["prepared", "review_required"].includes(attempt.status || "prepared") &&
            (attempt.confirmationText || "").includes("Application queued from")
          ) === true;
          const shouldCreateQueuedArtifacts = application.existing !== true || !hasQueuedDecisionAttempt;
          if (material) {
            await createApplicationMaterial({
              applicationId: applicationRecordId,
              resumeId: activeResume!.id,
              coverLetter: material.coverLetter,
              customAnswers: material.customAnswers,
              claimsMade: material.claimsMade,
              sourceProfileSnapshot: profileSnapshotForApplication(ctx.user, profileForMaterial),
            });
          }
          if (shouldCreateQueuedArtifacts) {
            await createApplicationAttempt({
              applicationId: applicationRecordId,
              userId: ctx.user.id,
              jobId: input.jobId,
              platformId: job.platformId,
              attemptType: "prepare",
              status: "review_required",
              finishedAt: new Date(),
              confirmationText: [
                `Application queued from ${input.decision} decision.`,
                input.reviewReason ? `Review reason: ${input.reviewReason}` : input.decisionReason,
              ].filter(Boolean).join(" "),
              retryCount: 0,
            });
            await createAuditEvent({
              userId: ctx.user.id,
              entityType: "application",
              entityId: applicationRecordId,
              action: "application_queued_for_review",
              actor: "user",
              source: "applications.decide",
              afterState: JSON.stringify({
                jobId: input.jobId,
                decision: input.decision,
                status: "pending",
                reviewRequired: true,
                resume: { id: activeResume!.id, version: activeResume!.version },
                materialSource: material?.materialSource ?? null,
              }),
              riskLevel: input.riskLevel === "high" ? "high" : "medium",
            });
          }
          if (input.riskLevel === "high" || input.decision === "manual_apply" || reviewRequired) {
            await createAdminReviewItem({
              userId: ctx.user.id,
              entityType: "application",
              entityId: applicationRecordId,
              category: "application_review",
              priority: input.riskLevel === "high" ? "high" : "medium",
              title: input.riskLevel === "high" ? "High-risk application needs review" : "Application needs review",
              description: [
                `Decision: ${input.decision}.`,
                input.decisionReason,
                input.reviewReason ? `Review reason: ${input.reviewReason}` : "",
              ].filter(Boolean).join(" "),
            });
            await createApplicationApproval({
              userId: ctx.user.id,
              applicationId: applicationRecordId,
              entityType: "application",
              entityId: applicationRecordId,
              approvalType: "application_submission",
              status: "pending",
              riskLevel: input.riskLevel === "high" || input.decision === "manual_apply" ? "high" : "medium",
              requestedBy: "system",
              title: input.decision === "manual_apply"
                ? "Approve manual application handoff"
                : "Approve external application submission",
              description: [
                `Decision: ${input.decision}.`,
                input.decisionReason,
                input.reviewReason ? `Review reason: ${input.reviewReason}` : "",
              ].filter(Boolean).join(" "),
              payload: JSON.stringify({
                jobId: input.jobId,
                decision: input.decision,
                matchScore: input.matchScore ?? null,
                source: "applications.decide",
                resumeId: activeResume!.id,
                resumeVersion: activeResume!.version,
                materialSource: material?.materialSource ?? null,
              }),
            });
          }
        }

        if (input.decision === "save") {
          await saveJob({
            userId: ctx.user.id,
            jobId: input.jobId,
            notes: input.decisionReason,
            priority: input.riskLevel === "low" ? "medium" : "high",
          });
        }

        if (input.decision === "save" || input.decision === "ignore") {
          const preparedApplication = await getPendingUserApplicationForJob(ctx.user.id, input.jobId);

          if (preparedApplication) {
            applicationRecordId = preparedApplication.id;
            const applicationApprovals = await listUserApplicationApprovalsForApplication(
              ctx.user.id,
              preparedApplication.id
            );
            const submissionApproval = applicationApprovals.find((approval) =>
              approval.status === "pending" &&
              approval.approvalType === "application_submission" &&
              (
                approval.applicationId === preparedApplication.id ||
                (approval.entityType === "application" && approval.entityId === preparedApplication.id)
              )
            );
            let cancelledApprovalId: number | null = null;
            let cancelledAttemptId: number | null = null;

            if (submissionApproval) {
              const {
                getApplicationSubmissionGateAttemptStatus,
                getApplicationSubmissionGateAttemptText,
              } = await import("./applicationApprovalResolution");
              const decisionNote = input.decision === "save"
                ? "Saved from the review queue; prepared submission gate cancelled until the job is re-queued."
                : "Ignored from the review queue; prepared submission gate cancelled.";
              const resolved = await resolveApplicationApproval(
                submissionApproval.id,
                ctx.user.id,
                "cancelled",
                decisionNote,
                "user"
              );
              cancelledApprovalId = resolved.approval.id;
              const cancelledAttempt = await createApplicationAttempt({
                applicationId: preparedApplication.id,
                userId: ctx.user.id,
                jobId: preparedApplication.jobId,
                platformId: job.platformId,
                attemptType: "external_handoff",
                status: getApplicationSubmissionGateAttemptStatus("cancelled"),
                startedAt: new Date(),
                finishedAt: new Date(),
                confirmationText: getApplicationSubmissionGateAttemptText(
                  resolved.approval,
                  "cancelled",
                  decisionNote
                ),
                retryCount: 0,
              });
              cancelledAttemptId = Number(cancelledAttempt.insertId);
            }

            await updateApplicationStatus(preparedApplication.id, "withdrawn", ctx.user.id);
            await createAuditEvent({
              userId: ctx.user.id,
              entityType: "application",
              entityId: preparedApplication.id,
              action: "application_review_closed",
              actor: "user",
              source: "applications.decide",
              afterState: JSON.stringify({
                jobId: input.jobId,
                decision: input.decision,
                status: "withdrawn",
                cancelledApprovalId,
                cancelledAttemptId,
              }),
              riskLevel: input.decision === "ignore" ? "medium" : "low",
            });
          }
        }

        return {
          success: true,
          decisionId: Number(result.insertId),
          applicationRecordId,
          existing: result.existing === true,
        };
      }),
    listDecisions: protectedProcedure
      .input(z.object({
        jobIds: z.array(z.number().int().positive()).max(250),
      }))
      .query(async ({ ctx, input }) => {
        const { getUserApplicationDecisionsForJobs } = await import("./db");
        return await getUserApplicationDecisionsForJobs(ctx.user.id, input.jobIds);
      }),
    getOperatingLedger: protectedProcedure.query(async ({ ctx }) => {
      const { getUserOperatingLedger } = await import("./applicationCampaigns");
      return await getUserOperatingLedger(ctx.user.id, {
        includeAdminReviews: ctx.user.role === "admin",
        persistCampaign: false,
      });
    }),
    getInboxResponseCandidatePage: protectedProcedure
      .input(z.object({ limit: boundedPageSize.optional().default(25) }).optional())
      .query(async ({ ctx, input }) => {
        const { getPendingInboxResponseCandidatePage } = await import("./db");
        return await getPendingInboxResponseCandidatePage(ctx.user.id, input?.limit ?? 25);
      }),
    setCampaignStatus: protectedProcedure
      .input(z.object({ status: z.enum(["active", "paused"]) }))
      .mutation(async ({ ctx, input }) => {
        const { getUserOperatingLedger } = await import("./applicationCampaigns");
        const { createAuditEvent, updateApplicationCampaignStatus } = await import("./db");

        const ledger = await getUserOperatingLedger(ctx.user.id, {
          includeAdminReviews: ctx.user.role === "admin",
        });
        const previousStatus = ledger.campaign.status;
        const campaign = await updateApplicationCampaignStatus(ctx.user.id, input.status);
        if (previousStatus !== campaign.status) {
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "user",
            entityId: ctx.user.id,
            action: "application_campaign_status_changed",
            actor: "user",
            source: "applications.setCampaignStatus",
            beforeState: JSON.stringify({ campaignId: campaign.id, status: previousStatus }),
            afterState: JSON.stringify({ campaignId: campaign.id, status: campaign.status }),
            riskLevel: "medium",
          });
        }

        return { success: true, campaign };
      }),
    listInterviewNotifications: protectedProcedure
      .input(z.object({ limit: boundedPageSize.optional().default(25) }).optional())
      .query(async ({ ctx, input }) => {
        const { listUnreadInterviewNotifications } = await import("./db");
        return await listUnreadInterviewNotifications(ctx.user.id, input?.limit ?? 25);
      }),
    markInterviewNotificationRead: protectedProcedure
      .input(z.object({ notificationId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { markInterviewNotificationRead, createAuditEvent } = await import("./db");
        const result = await markInterviewNotificationRead(input.notificationId, ctx.user.id);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Interview notification not found." });
        }
        if (result.changed) {
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "application",
            entityId: result.notification.applicationId,
            action: "interview_notification_read",
            actor: "user",
            source: "applications.markInterviewNotificationRead",
            afterState: JSON.stringify({
              notificationId: result.notification.id,
              employerResponseId: result.notification.employerResponseId,
            }),
            riskLevel: "low",
          });
        }
        return { success: true, changed: result.changed, notification: result.notification };
      }),
    getLedgerArtifacts: protectedProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const { getApplicationLedgerArtifactWindow } = await import("./db");
        try {
          return await getApplicationLedgerArtifactWindow(input.applicationId, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to load application ledger.";
          throw new TRPCError({
            code: message === "Application not found." ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message,
          });
        }
      }),
    generateInterviewPreparation: protectedProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await generateInterviewPreparationForApplication(input.applicationId, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to generate interview preparation.";
          throw new TRPCError({
            code: message.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST",
            message,
          });
        }
      }),
    getEmployerResponses: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        limit: boundedPageSize.optional().default(25),
      }))
      .query(async ({ ctx, input }) => {
        const { getRecentEmployerResponses } = await import("./db");
        try {
          return await getRecentEmployerResponses(input.applicationId, ctx.user.id, input.limit);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to load employer responses.";
          throw new TRPCError({
            code: message === "Application not found." ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message,
          });
        }
      }),
    listApprovals: protectedProcedure
      .input(z.object({
        applicationIds: z.array(z.number().int().positive()).max(250),
      }))
      .query(async ({ ctx, input }) => {
        const { listUserApplicationApprovalsForApplications } = await import("./db");
        return await listUserApplicationApprovalsForApplications(ctx.user.id, input.applicationIds);
      }),
    resolveApproval: protectedProcedure
      .input(z.object({
        approvalId: z.number().int().positive(),
        status: z.enum(["approved", "rejected", "cancelled"]),
        decisionNote: z.string().trim().max(5000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        const {
          resolveApplicationApproval,
          createAuditEvent,
          createApplicationAttempt,
          getJobById,
          getUserApplicationApprovalById,
          getUserApplicationById,
        } = await import("./db");
        const {
          getApplicationSubmissionGateAttemptStatus,
          getApplicationSubmissionGateAttemptText,
          shouldRecordApplicationSubmissionGateAttempt,
        } = await import("./applicationApprovalResolution");
        try {
          const approval = await getUserApplicationApprovalById(ctx.user.id, input.approvalId);
          if (
            input.status === "approved" &&
            approval?.approvalType === "application_submission" &&
            approval.applicationId != null &&
            approval.status === "pending"
          ) {
            const application = await getUserApplicationById(ctx.user.id, approval.applicationId);
            const job = application ? await getJobById(application.jobId) : null;
            if (!application || !job || !isJobCurrentForAutonomousProcessing(job)) {
              const cancelled = await resolveApplicationApproval(
                approval.id,
                ctx.user.id,
                "cancelled",
                "The job listing is no longer active, so its external handoff approval was cancelled.",
                undefined
              );
              let handoffAttemptId: number | null = null;
              if (application) {
                const attempt = await createApplicationAttempt({
                  applicationId: application.id,
                  userId: ctx.user.id,
                  jobId: application.jobId,
                  platformId: job?.platformId,
                  attemptType: "external_handoff",
                  status: getApplicationSubmissionGateAttemptStatus("cancelled"),
                  startedAt: new Date(),
                  finishedAt: new Date(),
                  confirmationText: getApplicationSubmissionGateAttemptText(
                    cancelled.approval,
                    "cancelled",
                    cancelled.approval.decisionNote
                  ),
                  retryCount: 0,
                });
                handoffAttemptId = Number(attempt.insertId);
              }
              await createAuditEvent({
                userId: ctx.user.id,
                entityType: "application",
                entityId: approval.applicationId,
                action: "application_submission_approval_cancelled_stale_job",
                actor: "system",
                source: "applications.resolveApproval",
                approvalId: approval.id,
                afterState: JSON.stringify({
                  jobId: application?.jobId ?? null,
                  requestedStatus: input.status,
                  approvalStatus: "cancelled",
                  handoffAttemptId,
                  externalSubmissionPerformed: false,
                }),
                riskLevel: "high",
              });
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "This job is no longer active. The external application handoff approval was cancelled.",
              });
            }
            const { getAutonomousEvidenceContext } = await import("./autonomousEvidence");
            const evidenceContext = await getAutonomousEvidenceContext(ctx.user.id);
            const blockingGates = evidenceContext.evidenceGates.filter((gate) =>
              gate.blocks.includes("external_application_submission")
            );
            if (blockingGates.length > 0) {
              await createAuditEvent({
                userId: ctx.user.id,
                entityType: "application",
                entityId: approval.applicationId,
                action: "application_submission_approval_blocked_evidence",
                actor: "user",
                source: "applications.resolveApproval",
                approvalId: approval.id,
                afterState: JSON.stringify({
                  requestedStatus: input.status,
                  decisionNote: input.decisionNote ?? null,
                  blockingGates: blockingGates.map((gate) => ({
                    id: gate.id,
                    label: gate.label,
                    detail: gate.detail,
                    severity: gate.severity,
                  })),
                  externalSubmissionPerformed: false,
                }),
                riskLevel: "high",
              });
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "Resolve the profile evidence gates before approving an external application handoff.",
              });
            }
          }
          const result = await resolveApplicationApproval(
            input.approvalId,
            ctx.user.id,
            input.status,
            input.decisionNote,
            "user"
          );
          let approvalAttemptId: number | null = null;
          let approvalAttemptWarning: string | null = null;
          if (shouldRecordApplicationSubmissionGateAttempt(result.approval)) {
            const applicationId = result.approval.applicationId as number;
            const application = await getUserApplicationById(ctx.user.id, applicationId);
            if (application) {
              const job = await getJobById(application.jobId);
              const attempt = await createApplicationAttempt({
                applicationId,
                userId: ctx.user.id,
                jobId: application.jobId,
                platformId: job?.platformId,
                attemptType: "external_handoff",
                status: getApplicationSubmissionGateAttemptStatus(input.status),
                startedAt: new Date(),
                finishedAt: new Date(),
                confirmationText: getApplicationSubmissionGateAttemptText(
                  result.approval,
                  input.status,
                  input.decisionNote
                ),
                retryCount: 0,
              });
              approvalAttemptId = Number(attempt.insertId);
            } else {
              approvalAttemptWarning = "Linked application was not found; approval was resolved without a handoff attempt.";
            }
          }
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: result.approval.applicationId ? "application" : "user",
            entityId: result.approval.applicationId ?? ctx.user.id,
            action: "approval_resolved",
            actor: "user",
            source: "applications.resolveApproval",
            approvalId: input.approvalId,
            afterState: JSON.stringify({
              status: input.status,
              approvalType: result.approval.approvalType,
              entityType: result.approval.entityType,
              entityId: result.approval.entityId,
              decisionNote: input.decisionNote ?? null,
              handoffAttemptId: approvalAttemptId,
              warning: approvalAttemptWarning,
            }),
            riskLevel: result.approval.riskLevel,
          });
          return { success: true };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          const message = error instanceof Error ? error.message : "Unable to resolve approval.";
          throw new TRPCError({
            code: message === "Approval not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),
    updateStatus: protectedProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          status: z.literal("withdrawn"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        try {
          const result = await withdrawApplication(input.applicationId, ctx.user.id);
          const { createAuditEvent } = await import("./db");
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "application",
            entityId: input.applicationId,
            action: "application_status_updated",
            actor: "user",
            source: "applications.updateStatus",
            afterState: JSON.stringify({
              status: input.status,
              cancelledApprovalIds: result.cancelledApprovalIds,
              cancelledSubmissionApprovalIds: result.cancelledSubmissionApprovalIds,
            }),
            riskLevel: input.status === "withdrawn" ? "medium" : "low",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to update application.";
          throw new TRPCError({
            code: message === "Application not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
        return { success: true };
      }),
    confirmOfferAcceptance: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        confirmed: z.literal(true),
        acceptanceNote: z.string().trim().min(8).max(5000),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        const { createAuditEvent } = await import("./db");

        try {
          const result = await acceptOfferApplication(input.applicationId, ctx.user.id);
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "application",
            entityId: input.applicationId,
            action: "offer_acceptance_confirmed",
            actor: "user",
            source: "applications.confirmOfferAcceptance",
            beforeState: JSON.stringify({ status: "offer" }),
            afterState: JSON.stringify({
              status: "accepted",
              confirmed: input.confirmed,
              acceptanceNote: input.acceptanceNote,
              cancelledFollowUpApprovalIds: result.cancelledFollowUpApprovalIds,
              cancelledInterviewIds: result.cancelledInterviewIds,
            }),
            riskLevel: "high",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to confirm offer acceptance.";
          throw new TRPCError({
            code: message === "Application not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }

        return { success: true };
      }),
    declineOffer: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        confirmed: z.literal(true),
        declineNote: z.string().trim().min(8).max(5000),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        const { createAuditEvent, getUserApplicationById } = await import("./db");
        const application = await getUserApplicationById(ctx.user.id, input.applicationId);
        if (!application) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
        }
        if (application.status !== "offer") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Only a recorded offer can be declined.",
          });
        }

        try {
          const result = await withdrawApplication(input.applicationId, ctx.user.id, {
            cancelOfferAttribution: true,
            dismissOfferAttributionReviews: true,
          });
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "application",
            entityId: input.applicationId,
            action: "offer_declined",
            actor: "user",
            source: "applications.declineOffer",
            beforeState: JSON.stringify({ status: "offer" }),
            afterState: JSON.stringify({
              status: "withdrawn",
              confirmed: input.confirmed,
              declineNote: input.declineNote,
              cancelledOfferAttributionApprovalIds: result.cancelledOfferAttributionApprovalIds,
              dismissedOfferAttributionReviewIds: result.dismissedOfferAttributionReviewIds,
              externalCommunicationSent: false,
            }),
            riskLevel: "high",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to decline offer.";
          throw new TRPCError({
            code: message === "Application not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }

        return { success: true };
      }),
    confirmSubmission: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        source: z.enum(["manual", "employer_portal", "email_confirmation", "ats_confirmation"]),
        evidence: z.string().trim().min(8).max(5000),
        confirmationUrl: safeHttpUrl.optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        try {
          return await confirmApplicationSubmission(input, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to confirm submission.";
          throw new TRPCError({
            code: message === "Application not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),
    recordResponse: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        responseType: z.enum(["viewed", "rejection", "interview_invite", "offer", "employer_question", "other"]),
        source: z.enum(["email", "employer_portal", "linkedin", "phone", "other"]),
        sourceReference: z.string().trim().min(3).max(320).optional(),
        summary: z.string().trim().min(8).max(5000),
        receivedAt: z.string().datetime().transform((s) => new Date(s)).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        try {
          return await recordEmployerResponse(input, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to record employer response.";
          throw new TRPCError({
            code: message === "Application not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),
    discoverInboxResponses: protectedProcedure
      .input(z.object({ provider: z.enum(["gmail", "outlook"]) }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        const { discoverInboxResponseCandidates } = await import("./inboxResponseDiscovery");
        const { createAuditEvent, upsertInboxResponseCandidate } = await import("./db");
        try {
          const candidates = await discoverInboxResponseCandidates(ctx.user.id, input.provider);
          const persisted = await Promise.all(candidates.map((candidate) =>
            upsertInboxResponseCandidate({
              userId: ctx.user.id,
              applicationId: candidate.applicationId,
              provider: candidate.provider,
              messageId: candidate.messageId,
              sender: candidate.sender,
              subject: candidate.subject,
              preview: candidate.preview,
              receivedAt: new Date(candidate.receivedAt),
              suggestedResponseType: candidate.suggestedResponseType,
              confidence: candidate.confidence,
            })
          ));
          const newCandidateCount = persisted.filter((item) => !item.existing).length;
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "user",
            entityId: ctx.user.id,
            action: "inbox_response_candidates_discovered",
            actor: "user",
            source: "applications.discoverInboxResponses",
            afterState: JSON.stringify({ provider: input.provider, candidateCount: newCandidateCount, externalWritePerformed: false }),
            riskLevel: "low",
          });
          return { provider: input.provider, candidates: persisted.map((item) => item.candidate) };
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeExternalConnectorErrorMessage(
              error,
              "Inbox response discovery could not be completed. Verify connector consent and reauthorize before retrying."
            ),
          });
        }
      }),
    dismissInboxResponseCandidate: protectedProcedure
      .input(z.object({ candidateId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { createAuditEvent, getInboxResponseCandidate, resolveInboxResponseCandidate } = await import("./db");
        const existing = await getInboxResponseCandidate(input.candidateId, ctx.user.id);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Inbox response candidate not found." });
        }
        if (existing.status !== "pending") {
          return { candidate: existing, existing: true };
        }
        const candidate = await resolveInboxResponseCandidate({
          id: input.candidateId,
          userId: ctx.user.id,
          status: "dismissed",
        });
        if (!candidate) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Inbox response candidate not found." });
        }
        await createAuditEvent({
          userId: ctx.user.id,
          entityType: "application",
          entityId: candidate.applicationId,
          action: "inbox_response_candidate_dismissed",
          actor: "user",
          source: "applications.dismissInboxResponseCandidate",
          afterState: JSON.stringify({ candidateId: candidate.id, provider: candidate.provider, messageId: candidate.messageId }),
          riskLevel: "low",
        });
        return { candidate, existing: false };
      }),
    ingestInboxResponse: protectedProcedure
      .input(z.object({
        candidateId: z.number().int().positive(),
        responseType: z.enum(["viewed", "rejection", "interview_invite", "offer", "employer_question", "other"]),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        const {
          createAuditEvent,
          findEmployerResponseBySourceReference,
          getUserConnectorAccount,
          getInboxResponseCandidate,
          resolveInboxResponseCandidate,
        } = await import("./db");
        const candidate = await getInboxResponseCandidate(input.candidateId, ctx.user.id);
        if (!candidate) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Inbox response candidate not found." });
        }
        if (candidate.status === "dismissed") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A dismissed inbox response candidate cannot be confirmed. Run discovery again if the message needs review.",
          });
        }
        const account = await getUserConnectorAccount(ctx.user.id, candidate.provider);
        const requiredScope = candidate.provider === "gmail"
          ? "email.messages.read_recruiting"
          : "mail.messages.read_recruiting";
        let scopes: string[] = [];
        try {
          const parsed = account?.consentScopes ? JSON.parse(account.consentScopes) : [];
          scopes = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
        } catch {
          scopes = [];
        }
        if (
          account?.status !== "connected" ||
          !scopes.includes(requiredScope) ||
          isConnectorAuthorizationStale(account.lastVerifiedAt)
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `${candidate.provider === "gmail" ? "Gmail" : "Outlook"} must be currently verified with recruiting-message read consent before inbox responses can be ingested.`,
          });
        }

        try {
          const sourceReference = `${candidate.provider}:${candidate.messageId}`;
          if (candidate.status === "confirmed") {
            const existingResponse = await findEmployerResponseBySourceReference({
              userId: ctx.user.id,
              source: "email",
              sourceReference,
            });
            if (!existingResponse) {
              throw new Error("The confirmed inbox candidate has no recorded response evidence. Run discovery again before retrying.");
            }
            return {
              success: true,
              existing: true,
              responseId: existingResponse.id,
              status: existingResponse.statusAfter,
              provider: candidate.provider,
              candidateId: candidate.id,
            };
          }
          const summary = [candidate.subject, candidate.preview]
            .map((value) => value.trim())
            .filter(Boolean)
            .join(". ")
            .slice(0, 5000);
          const result = await recordEmployerResponse({
            applicationId: candidate.applicationId,
            responseType: input.responseType,
            source: "email",
            sourceReference,
            summary: summary.length >= 8 ? summary : "Application-linked inbox message confirmed by the candidate.",
            receivedAt: candidate.receivedAt,
          }, ctx.user.id);
          if (!result.existing) {
            await createAuditEvent({
              userId: ctx.user.id,
              entityType: "application",
              entityId: candidate.applicationId,
              action: "inbox_response_ingested",
              actor: "system",
              source: "applications.ingestInboxResponse",
              afterState: JSON.stringify({
                candidateId: candidate.id,
                provider: candidate.provider,
                messageId: candidate.messageId,
                responseId: result.responseId,
                existing: false,
                responseType: input.responseType,
              }),
              riskLevel: input.responseType === "offer" ? "high" : input.responseType === "interview_invite" ? "medium" : "low",
            });
          }
          const resolved = await resolveInboxResponseCandidate({
            id: candidate.id,
            userId: ctx.user.id,
            status: "confirmed",
          });
          if (!resolved || resolved.status !== "confirmed") {
            throw new Error("Inbox response candidate changed before confirmation. Refresh the review queue.");
          }
          return { ...result, provider: candidate.provider, candidateId: candidate.id };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to ingest inbox response.";
          throw new TRPCError({
            code: message === "Application not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),

    // Application Notes
    addNote: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        noteType: z.enum(["general", "interview", "followup", "research", "feedback"]),
        content: z.string().trim().min(1).max(10_000),
      }))
      .mutation(async ({ ctx, input }) => {
        return await addApplicationNote(input, ctx.user.id);
      }),

    getNotes: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        limit: boundedPageSize.optional().default(25),
      }))
      .query(async ({ ctx, input }) => {
        return await getRecentApplicationNotes(input.applicationId, ctx.user.id, input.limit);
      }),

    updateNote: protectedProcedure
      .input(z.object({
        noteId: z.number().int().positive(),
        content: z.string().trim().min(1).max(10_000),
      }))
      .mutation(async ({ ctx, input }) => {
        return await updateApplicationNote(input.noteId, input.content, ctx.user.id);
      }),

    deleteNote: protectedProcedure
      .input(z.object({ noteId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        return await deleteApplicationNote(input.noteId, ctx.user.id);
      }),

    // Interview Scheduling
    scheduleInterview: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        interviewType: z.enum(["phone", "video", "onsite", "technical", "behavioral", "panel"]),
        scheduledAt: z.string().datetime().transform((s) => new Date(s)),
        duration: z.number().int().min(5).max(480).optional(),
        location: z.string().trim().max(500).optional(),
        meetingLink: safeHttpUrl.optional(),
        interviewerName: z.string().trim().max(255).optional(),
        interviewerTitle: z.string().trim().max(255).optional(),
        notes: z.string().max(10_000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        try {
          return await scheduleInterview(input, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to schedule interview.";
          throw new TRPCError({
            code: message === "Application not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),

    getInterviewPage: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        historyLimit: z.number().int().min(1).max(50).default(10),
        cursor: z.object({
          scheduledAt: z.date(),
          id: z.number().int().positive(),
        }).optional(),
      }))
      .query(async ({ ctx, input }) => {
        return await getInterviewSchedulePage(input.applicationId, ctx.user.id, input);
      }),

    getUpcomingInterviews: protectedProcedure
      .query(async ({ ctx }) => {
        return await getUpcomingInterviews(ctx.user.id);
      }),

    updateInterviewStatus: protectedProcedure
      .input(z.object({
        interviewId: z.number().int().positive(),
        status: z.enum(["scheduled", "completed", "cancelled", "rescheduled"]),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        try {
          return await updateInterviewStatus(input.interviewId, input.status, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to update interview.";
          throw new TRPCError({
            code: message === "Interview not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),

    recordInterviewOutcome: protectedProcedure
      .input(z.object({
        interviewId: z.number().int().positive(),
        outcome: z.enum(["next_round", "offer", "rejection", "no_response", "other"]),
        source: z.enum(["email", "employer_portal", "linkedin", "phone", "other"]),
        sourceReference: z.string().trim().min(3).max(320).optional(),
        summary: z.string().trim().min(8).max(5000),
        receivedAt: z.string().datetime().transform((s) => new Date(s)).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        try {
          return await recordInterviewOutcome(input, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to record interview outcome.";
          throw new TRPCError({
            code: message === "Interview not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),

    rescheduleInterview: protectedProcedure
      .input(z.object({
        interviewId: z.number().int().positive(),
        newDate: z.string().datetime().transform((s) => new Date(s)),
      }))
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        try {
          return await rescheduleInterview(input.interviewId, input.newDate, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to reschedule interview.";
          throw new TRPCError({
            code: message === "Interview not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),

    // Follow-ups
    createFollowUp: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        message: z.string().trim().min(1).max(MAX_FOLLOW_UP_MESSAGE_CHARS),
        purpose: z.enum(["routine_follow_up", "employer_reply"]).optional(),
        sourceResponseId: z.number().int().positive().optional(),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        try {
          return await createFollowUp(input, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to save follow-up.";
          throw new TRPCError({ code: "CONFLICT", message });
        }
      }),

    getFollowUpPage: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        limit: z.number().int().min(1).max(50).default(10),
        cursor: z.object({
          createdAt: z.date(),
          id: z.number().int().positive(),
        }).optional(),
      }))
      .query(async ({ ctx, input }) => {
        return await getFollowUpPage(input.applicationId, ctx.user.id, input);
      }),

    markFollowUpSent: protectedProcedure
      .input(z.object({
        followUpId: z.number().int().positive(),
        deliveryConfirmation: z.string().trim().min(8).max(1000),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        try {
          return await markFollowUpSent(input.followUpId, ctx.user.id, input.deliveryConfirmation);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to update follow-up.";
          throw new TRPCError({
            code: message === "Follow-up not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),

    sendFollowUp: protectedProcedure
      .input(z.object({
        followUpId: z.number().int().positive(),
        provider: z.enum(["gmail", "outlook"]),
        recipient: z.string().trim().min(3).max(320),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        const { sendApprovedFollowUp } = await import("./followUpMailDelivery");
        try {
          return await sendApprovedFollowUp({ ...input, userId: ctx.user.id });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to send follow-up.";
          throw new TRPCError({ code: "PRECONDITION_FAILED", message });
        }
      }),

    markFollowUpResponse: protectedProcedure
      .input(z.object({ followUpId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await markFollowUpResponseReceived(input.followUpId, ctx.user.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to update follow-up.";
          throw new TRPCError({
            code: message === "Follow-up not found." ? "NOT_FOUND" : "CONFLICT",
            message,
          });
        }
      }),

    generateFollowUpEmail: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        type: z.enum(["initial", "reminder", "thank_you", "status_check"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const email = await generateFollowUpEmail(input.applicationId, input.type, ctx.user.id);
        return { email };
      }),

    generateEmployerReplyEmail: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        responseId: z.number().int().positive().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await generateEmployerReplyEmail(input.applicationId, ctx.user.id, input.responseId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to generate employer reply.";
          throw new TRPCError({
            code: message === "Application not found." || message === "Employer response not found."
              ? "NOT_FOUND"
              : "CONFLICT",
            message,
          });
        }
      }),
  }),

  // AI Matching
  matching: router({
    calculateMatch: protectedProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { getUserProfile, getUserSkills, getWorkExperiences, getJobById, getCanonicalJobId } = await import("./db");
        const { calculateJobMatch } = await import("./aiMatching");
        const { createJobMatch } = await import("./db");

        const [profile, skills, workExperiences] = await Promise.all([
          getUserProfile(ctx.user.id),
          getUserSkills(ctx.user.id),
          getWorkExperiences(ctx.user.id),
        ]);
        if (!profile) {
          throw new Error("User profile not found. Please complete your profile first.");
        }
        const profileForMatching = resolveProfileCandidateEvidence(profile, skills, workExperiences);

        const canonicalJobId = await getCanonicalJobId(input.jobId);
        if (canonicalJobId === null) throw new Error("Job not found");
        input = { ...input, jobId: canonicalJobId };
        const job = await getJobById(input.jobId);
        if (!job) {
          throw new Error("Job not found");
        }
        assertJobCurrentForPreparation(job);

        const match = await calculateJobMatch(profileForMatching, job);

        // Save the match to database
        await createJobMatch({
          userId: ctx.user.id,
          jobId: input.jobId,
          matchScore: match.matchScore,
          matchReasons: match.matchReasons,
          skillsMatch: match.skillsMatch,
          experienceMatch: match.experienceMatch,
          locationMatch: match.locationMatch,
          salaryMatch: match.salaryMatch,
        });

        return match;
      }),
    getMatchesForJobs: protectedProcedure
      .input(z.object({
        jobIds: z.array(z.number().int().positive()).max(250),
      }))
      .query(async ({ ctx, input }) => {
        const { getUserJobMatchesForJobs } = await import("./db");
        return await getUserJobMatchesForJobs(ctx.user.id, input.jobIds);
      }),
  }),

  // AI-Powered Features
  ai: router({
    generateCoverLetter: protectedProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { getUserProfile, getUserSkills, getWorkExperiences, getJobById } = await import("./db");
        const { generateCoverLetter } = await import("./aiMatching");

        const [profile, skills, workExperiences] = await Promise.all([
          getUserProfile(ctx.user.id),
          getUserSkills(ctx.user.id),
          getWorkExperiences(ctx.user.id),
        ]);
        if (!profile) {
          throw new Error("User profile not found");
        }

        const job = await getJobById(input.jobId);
        if (!job) {
          throw new Error("Job not found");
        }

        const coverLetter = await generateCoverLetter(
          resolveProfileCandidateEvidence(profile, skills, workExperiences),
          job
        );
        return { coverLetter };
      }),
    identifyDecisionMakers: protectedProcedure
      .input(z.object({ company: boundedShortText, jobTitle: boundedShortText }))
      .mutation(async ({ input }) => {
        const { identifyDecisionMakers } = await import("./aiMatching");
        return await identifyDecisionMakers(input.company, input.jobTitle);
      }),
    generateInterviewPrep: protectedProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        return await generateInterviewPreparationForApplication(input.applicationId, ctx.user.id);
      }),
  }),

  // Resume Management
  resume: router({
    upload: protectedProcedure
      .input(
        z.object({
          fileKey: z.string().trim().min(1).max(1000),
          fileUrl: safeHttpUrl,
          fileName: boundedFileName,
          fileType: boundedMimeType,
        })
      )
      .mutation(async () => {
        // A URL/key pair alone cannot be verified or linked to a resume ledger record.
        // Keep the legacy route registered, but require callers to use a versioned upload.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Resume metadata-only uploads are no longer supported. Upload resume bytes with resume.uploadWithHistory or import the file with resume.parseFile.",
        });
      }),
    parse: protectedProcedure
      .input(z.object({ resumeText: boundedResumeText }))
      .mutation(async ({ ctx, input }) => {
        const { parseResumeText, resumeToProfileData } = await import("./resumeParser");
        const { upsertUserProfile } = await import("./db");

        // Parse the resume text
        const parsed = await parseResumeText(input.resumeText);

        // Convert to profile format
        const profileData = resumeToProfileData(parsed);

        // Update user profile with parsed data
        await upsertUserProfile({
          userId: ctx.user.id,
          ...profileData,
        });
        const matchRefresh = await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
          userId: ctx.user.id,
          source: "resume.parse",
        });

        return { success: true, parsed, profileData, matchRefresh };
      }),

    // Parse resume from file (base64 encoded PDF/DOCX)
    parseFile: protectedProcedure
      .input(z.object({
        fileData: boundedUploadBase64,
        mimeType: boundedMimeType,
        filename: boundedFileName,
      }))
      .mutation(async ({ input, ctx }) => {
        const { parseResumeFromFile, resumeToProfileData } = await import("./resumeParser");
        const { upsertUserProfile } = await import("./db");
        const { RESUME_MIME_TYPES, validateUploadedFile } = await import("./uploadValidation");
        
        // Decode base64 to buffer
        const buffer = Buffer.from(input.fileData, "base64");
        const validation = validateUploadedFile({
          data: buffer,
          fileName: input.filename,
          mimeType: input.mimeType,
          allowedMimeTypes: RESUME_MIME_TYPES,
        });
        
        // Parse the resume
        const parsed = await parseResumeFromFile(buffer, input.mimeType);
        
        // Convert to profile format
        const profileData = resumeToProfileData(parsed);
        
        // Store the parsed file through the versioned resume service so active profile metadata
        // and the resume used by application preparation always point to the same artifact.
        const resume = await uploadResume(
          ctx.user.id,
          buffer,
          validation.fileName,
          input.mimeType
        );

        // Update user profile with parsed data and file info
        await upsertUserProfile({
          userId: ctx.user.id,
          resumeUrl: resume.fileUrl,
          resumeFileKey: resume.fileKey,
          ...profileData,
        });
        const matchRefresh = await (await import("./profileMatchLedger")).refreshProfileMatchLedger({
          userId: ctx.user.id,
          source: "resume.parseFile",
        });
        
        return {
          success: true,
          parsed,
          profileData,
          resume,
          fileUrl: resume.fileUrl,
          fileKey: resume.fileKey,
          matchRefresh,
        };
      }),

    // Upload resume with version history
    uploadWithHistory: protectedProcedure
      .input(z.object({
        fileData: boundedUploadBase64,
        fileName: boundedFileName,
        mimeType: boundedMimeType.optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.fileData, "base64");
        const resume = await uploadResume(ctx.user.id, buffer, input.fileName, input.mimeType);
        const { upsertUserProfile } = await import("./db");
        await upsertUserProfile({
          userId: ctx.user.id,
          resumeUrl: resume.fileUrl,
          resumeFileKey: resume.fileKey,
        });
        return resume;
      }),

    // Get active resume
    getActive: protectedProcedure
      .query(async ({ ctx }) => getActiveResume(ctx.user.id)),

    // Get a bounded version-history page
    getVersionPage: protectedProcedure
      .input(z.object({
        limit: boundedPageSize.optional().default(25),
        cursor: z.object({
          version: z.number().int().positive(),
          id: z.number().int().positive(),
        }).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const { getResumeVersionPage } = await import("./resumeStorage");
        return await getResumeVersionPage(ctx.user.id, input);
      }),

    // Set active version
    setActiveVersion: protectedProcedure
      .input(z.object({ version: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const success = await setActiveVersion(ctx.user.id, input.version);
        if (success) {
          const resume = await getActiveResume(ctx.user.id);
          const { upsertUserProfile } = await import("./db");
          await upsertUserProfile({
            userId: ctx.user.id,
            resumeUrl: resume?.fileUrl ?? null,
            resumeFileKey: resume?.fileKey ?? null,
          });
        }
        return { success };
      }),

    // Delete a version
    deleteVersion: protectedProcedure
      .input(z.object({ version: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const success = await deleteResumeVersion(ctx.user.id, input.version);
        if (success) {
          const resume = await getActiveResume(ctx.user.id);
          const { upsertUserProfile } = await import("./db");
          await upsertUserProfile({
            userId: ctx.user.id,
            resumeUrl: resume?.fileUrl ?? null,
            resumeFileKey: resume?.fileKey ?? null,
          });
        }
        return { success };
      }),

    // Get resume stats
    getStats: protectedProcedure
      .query(async ({ ctx }) => getResumeStats(ctx.user.id)),

    // Get download URL
    getDownloadUrl: protectedProcedure
      .input(z.object({ version: z.number().int().positive().optional() }))
      .query(async ({ ctx, input }) => {
        const url = await getResumeDownloadUrl(ctx.user.id, input.version);
        return { url };
      }),
  }),

  // Job Scraping (Admin only)
  scraping: router({
    listScrapers: adminProcedure.query(async () => {
      const { getSupportedPlatforms } = await import("./scrapers/index");
      return getSupportedPlatforms();
    }),
    scrapePlatform: adminProcedure
      .input(z.object({
        platform: boundedShortText,
        keywords: boundedFilterText.optional(),
        location: boundedFilterText.optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }))
      .mutation(async ({ input }) => {
        const { getScraperManager } = await import("./scrapers/scraperManager");
        const manager = await getScraperManager();
        const result = await manager.scrapePlatform(input.platform, {
          keywords: input.keywords,
          location: input.location,
          limit: input.limit,
        });
        const saveResult = await manager.saveJobs(result.jobs);
        return { ...result, saved: saveResult.saved, duplicates: saveResult.duplicates };
      }),
    scrapeAll: adminProcedure
      .input(z.object({
        keywords: boundedFilterText.optional(),
        location: boundedFilterText.optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }).optional())
      .mutation(async ({ input }) => {
        const { getScraperManager } = await import("./scrapers/scraperManager");
        const manager = await getScraperManager();
        return await manager.runScrapingCycle(input);
      }),
    runScrape: adminProcedure
      .input(
        z.object({
          platform: boundedShortText.optional(),
          keywords: boundedFilterText.optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { getScraperManager } = await import("./scrapers/scraperManager");
        const manager = await getScraperManager();

        if (input.platform) {
          // Scrape specific platform
          const result = await manager.scrapePlatform(input.platform, {
            keywords: input.keywords,
            limit: input.limit,
          });

          // Save jobs
          const saveResult = await manager.saveJobs(result.jobs);

          return {
            platform: input.platform,
            scraped: result.jobs.length,
            saved: saveResult.saved,
            duplicates: saveResult.duplicates,
            errors: result.errors,
          };
        } else {
          // Scrape all platforms
          const result = await manager.runScrapingCycle({
            keywords: input.keywords,
            limit: input.limit,
          });

          return result;
        }
      }),
    status: adminProcedure.query(async () => {
      const { getScraperManager } = await import("./scrapers/scraperManager");
      const { getScraperAdapterMetadata, getSupportedPlatforms } = await import("./scrapers/index");
      const { getScheduler } = await import("./scrapers/scheduler");
      const { getAllJobPlatforms } = await import("./db");
      const manager = await getScraperManager();
      const supportedPlatforms = getSupportedPlatforms();
      const freshAfter = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const scheduler = getScheduler();
      const schedulerStatus = scheduler.getStatus();
      const configuredPlatforms = await getAllJobPlatforms();
      const configuredSupportedPlatforms = configuredPlatforms
        .filter((platform) => supportedPlatforms.includes(platform.name))
      const initializedPlatformNames = new Set(manager.getInitializedPlatforms());
      const platforms = configuredSupportedPlatforms
        .filter((platform) => platform.isActive === 1)
        .map((platform) => ({
          id: platform.id,
          name: platform.name,
          category: platform.category,
          tier: platform.tier,
          isActive: platform.isActive === 1,
          adapter: getScraperAdapterMetadata(platform.name),
          lastScraped: platform.lastScraped,
          lastScrapeAttemptedAt: platform.lastScrapeAttemptedAt,
          lastScrapeStatus: platform.lastScrapeStatus,
          lastScrapeJobCount: platform.lastScrapeJobCount,
          lastScrapeError: platform.lastScrapeError,
          readiness: initializedPlatformNames.has(platform.name) ? "ready" : "unavailable",
          freshness: !platform.lastScraped
            ? "awaiting_first_scan"
            : platform.lastScraped >= freshAfter
              ? "fresh"
              : "stale",
          initializationError: manager.getInitializationError(platform.name),
        }));
      const inactiveConfiguredSources = configuredSupportedPlatforms.filter((platform) => platform.isActive !== 1);
      const unconfiguredSources = supportedPlatforms.filter(
        (platformName) => !configuredPlatforms.some((platform) => platform.name === platformName)
      );
      const unsupportedConfiguredSources = configuredPlatforms
        .filter((platform) => !supportedPlatforms.includes(platform.name))
        .map((platform) => platform.name);
      const readySources = platforms.filter((platform) => platform.readiness === "ready");
      const freshReadySources = readySources.filter((platform) => platform.freshness === "fresh");
      const configuredDedicatedAdapterSources = platforms.filter((platform) => platform.adapter.kind === "dedicated").length;
      const configuredGenericRssAdapterSources = platforms.filter((platform) => platform.adapter.kind === "generic_rss").length;
      const configuredGenericHtmlAdapterSources = platforms.filter((platform) => platform.adapter.kind === "generic_html").length;
      const zeroListingSources = platforms.filter((platform) =>
        platform.lastScrapeStatus === "success" && platform.lastScrapeJobCount === 0
      ).length;
      const hasFreshLatestAttempt = (platform: typeof platforms[number]) => {
        const attemptedAt = platform.lastScrapeAttemptedAt ?? platform.lastScraped;
        return attemptedAt instanceof Date && attemptedAt >= freshAfter;
      };
      const freshZeroListingSources = platforms.filter((platform) =>
        hasFreshLatestAttempt(platform) &&
        platform.lastScrapeStatus === "success" &&
        platform.lastScrapeJobCount === 0
      ).length;
      const freshFailedLatestSources = platforms.filter((platform) =>
        hasFreshLatestAttempt(platform) && platform.lastScrapeStatus === "failed"
      ).length;
      const freshPartialLatestSources = platforms.filter((platform) =>
        hasFreshLatestAttempt(platform) && platform.lastScrapeStatus === "partial"
      ).length;
      const freshSourceIssues = freshZeroListingSources + freshFailedLatestSources + freshPartialLatestSources;

      return {
        initialized: true,
        availableScrapers: readySources.length,
        registeredScrapers: supportedPlatforms.length,
        supportedPlatforms,
        platforms,
        coverage: {
          registeredSources: supportedPlatforms.length,
          configuredActiveSources: platforms.length,
          configuredDedicatedAdapterSources,
          configuredGenericRssAdapterSources,
          configuredGenericHtmlAdapterSources,
          zeroListingSources,
          freshZeroListingSources,
          freshFailedLatestSources,
          freshPartialLatestSources,
          freshSourceIssues,
          readySources: readySources.length,
          freshReadySources: freshReadySources.length,
          staleReadySources: readySources.filter((platform) => platform.freshness === "stale").length,
          awaitingFirstScanReadySources: readySources.filter((platform) => platform.freshness === "awaiting_first_scan").length,
          unavailableConfiguredSources: platforms.filter((platform) => platform.readiness === "unavailable").length,
          unconfiguredSources: unconfiguredSources.length,
          inactiveConfiguredSources: inactiveConfiguredSources.length,
          unsupportedConfiguredSources,
        },
        scheduler: schedulerStatus,
        executionPolicy: manager.getExecutionPolicy(),
        message: `${readySources.length} configured source${readySources.length === 1 ? " is" : "s are"} ready for discovery. ${configuredDedicatedAdapterSources} use source-specific parsers and ${configuredGenericRssAdapterSources + configuredGenericHtmlAdapterSources} use generic extraction. ${freshSourceIssues} source scan${freshSourceIssues === 1 ? " needs" : "s need"} attention based on evidence from the last 24 hours; ${zeroListingSources} latest recorded source scan${zeroListingSources === 1 ? " returned" : "s returned"} no listings. Inspect source health before relying on coverage. ${unconfiguredSources.length} registered source${unconfiguredSources.length === 1 ? " is" : "s are"} not configured.`,
      };
    }),

    // Start the scheduler
    startScheduler: adminProcedure
      .input(z.object({
        intervalMinutes: z.number().min(5).max(1440).optional(),
        maxJobsPerRun: z.number().min(10).max(1000).optional(),
        // `null` deliberately enables every ready source. An empty array is
        // ambiguous and must not silently broaden an autonomous scan.
        enabledPlatforms: z.array(z.string().trim().min(1).max(255)).min(1).max(100).nullable().optional(),
      }).optional())
      .mutation(async ({ input }) => {
        const { getScheduler } = await import("./scrapers/scheduler");
        const { getScraperManager } = await import("./scrapers/scraperManager");
        const manager = await getScraperManager();
        const readyPlatforms = new Set(manager.getInitializedPlatforms());
        if (readyPlatforms.size === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No configured, ready scraper sources are available to schedule.",
          });
        }
        const currentScheduler = getScheduler();
        const requestedPlatforms = input?.enabledPlatforms === undefined
          ? currentScheduler.getStatus().enabledPlatforms
          : input.enabledPlatforms;
        const unsupportedPlatforms = requestedPlatforms?.filter(
          (platformName) => !readyPlatforms.has(platformName)
        ) ?? [];
        if (unsupportedPlatforms.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No configured, ready scraper is available for: ${unsupportedPlatforms.join(", ")}`,
          });
        }
        // The scheduler merges partial updates. Omitting a field must retain the
        // current operator-approved configuration, especially the source allowlist.
        const scheduler = input ? getScheduler(input) : currentScheduler;
        
        scheduler.start();
        return { success: true, message: "Scheduler started", scheduler: scheduler.getStatus() };
      }),

    // Stop the scheduler
    stopScheduler: adminProcedure.mutation(async () => {
      const { getScheduler } = await import("./scrapers/scheduler");
      const scheduler = getScheduler();
      await scheduler.stop();
      return { success: true, message: "Scheduler stopped", scheduler: scheduler.getStatus() };
    }),

    // Run scraping manually
    runNow: adminProcedure.mutation(async () => {
      const { getScheduler } = await import("./scrapers/scheduler");
      const scheduler = getScheduler();
      const result = await scheduler.runScraping();
      return {
        success: result !== "skipped" && result !== "failed",
        message: result === "skipped"
          ? "Scraping is already running on another server instance"
          : result === "failed"
            ? "Scraping run could not complete"
            : result === "joined"
              ? "Active scraping run completed"
              : "Scraping run completed",
        scheduler: scheduler.getStatus(),
      };
    }),
  }),

  // Diversity & Inclusion Support
  diversity: router({
    analyzeCompanyDI: protectedProcedure
      .input(z.object({
        company: boundedShortText,
        userDIProfile: z.object({
          categories: boundedAiList,
          accommodationsNeeded: boundedAiList,
          preferredWorkStyle: z.enum(["remote", "hybrid", "onsite", "flexible"]),
          accessibilityRequirements: boundedAiList,
          disclosurePreference: z.enum(["always", "when_relevant", "never"]),
        }).optional(),
      }))
      .mutation(async ({ input }) => {
        const { analyzeCompanyDI } = await import("./diversitySupport");
        return await analyzeCompanyDI(input.company, input.userDIProfile as any);
      }),

    analyzeVisaSponsorship: protectedProcedure
      .input(z.object({
        company: boundedShortText,
        jobTitle: boundedShortText,
        visaProfile: z.object({
          currentStatus: boundedShortText,
          needsSponsorship: z.boolean(),
          sponsorshipType: boundedAiList.optional(),
          country: boundedShortText,
          optStemEligible: z.boolean().optional(),
        }),
      }))
      .mutation(async ({ input }) => {
        const { analyzeVisaSponsorship } = await import("./diversitySupport");
        return await analyzeVisaSponsorship(input.company, input.jobTitle, input.visaProfile as any);
      }),

    getAccommodationRecommendations: protectedProcedure
      .input(z.object({
        category: boundedShortText,
        specificNeeds: boundedAiList,
      }))
      .mutation(async ({ input }) => {
        const { generateAccommodationRecommendations } = await import("./diversitySupport");
        return await generateAccommodationRecommendations(input.category as any, input.specificNeeds);
      }),

    getDIPlatforms: publicProcedure
      .input(z.object({
        categories: boundedAiList,
      }))
      .query(async ({ input }) => {
        const { getDIPlatforms } = await import("./diversitySupport");
        return getDIPlatforms(input.categories as any);
      }),

    analyzeRelocation: protectedProcedure
      .input(z.object({
        fromLocation: boundedShortText,
        toLocation: boundedShortText,
        salary: z.number().finite().nonnegative().max(1_000_000_000),
        familySize: z.number().int().min(1).max(50),
      }))
      .mutation(async ({ input }) => {
        const { analyzeRelocation } = await import("./diversitySupport");
        return await analyzeRelocation(
          input.fromLocation,
          input.toLocation,
          input.salary,
          input.familySize
        );
      }),
  }),

  // Career Intelligence
  career: router({
    analyzeSalary: protectedProcedure
      .input(z.object({
        jobTitle: boundedShortText,
        company: boundedShortText,
        location: boundedShortText,
        yearsExperience: z.number().finite().min(0).max(100),
        skills: boundedAiList,
        currentSalary: z.number().finite().nonnegative().max(1_000_000_000).optional(),
        offeredSalary: z.number().finite().nonnegative().max(1_000_000_000).optional(),
      }))
      .mutation(async ({ input }) => {
        const { analyzeSalary } = await import("./careerIntelligence");
        return await analyzeSalary(
          input.jobTitle,
          input.company,
          input.location,
          input.yearsExperience,
          input.skills,
          input.currentSalary,
          input.offeredSalary
        );
      }),

    analyzeCompanyCulture: protectedProcedure
      .input(z.object({
        company: boundedShortText,
        jobTitle: boundedShortText,
        jobDescription: boundedNarrativeText,
        userPreferences: z.object({
          workStyle: boundedShortText.optional(),
          values: boundedAiList.optional(),
          priorities: boundedAiList.optional(),
        }).optional(),
      }))
      .mutation(async ({ input }) => {
        const { analyzeCompanyCulture } = await import("./careerIntelligence");
        return await analyzeCompanyCulture(
          input.company,
          input.jobTitle,
          input.jobDescription,
          input.userPreferences
        );
      }),

    generateNetworkingStrategy: protectedProcedure
      .input(z.object({
        targetCompany: boundedShortText,
        targetRole: boundedShortText,
        userBackground: boundedNarrativeText,
        existingConnections: boundedAiList.optional(),
      }))
      .mutation(async ({ input }) => {
        const { generateNetworkingStrategy } = await import("./careerIntelligence");
        return await generateNetworkingStrategy(
          input.targetCompany,
          input.targetRole,
          input.userBackground,
          input.existingConnections
        );
      }),

    generateCareerPlan: protectedProcedure
      .input(z.object({
        currentRole: boundedShortText,
        targetRole: boundedShortText,
        yearsExperience: z.number().finite().min(0).max(100),
        skills: boundedAiList,
        interests: boundedAiList,
        constraints: boundedAiList.optional(),
      }))
      .mutation(async ({ input }) => {
        const { generateCareerPlan } = await import("./careerIntelligence");
        return await generateCareerPlan(
          input.currentRole,
          input.targetRole,
          input.yearsExperience,
          input.skills,
          input.interests,
          input.constraints
        );
      }),

    analyzeSkillGap: protectedProcedure
      .input(z.object({
        jobRequirements: boundedNarrativeText,
        userSkills: boundedAiList,
        userExperience: boundedNarrativeText,
      }))
      .mutation(async ({ input }) => {
        const { analyzeSkillGap } = await import("./careerIntelligence");
        return await analyzeSkillGap(
          input.jobRequirements,
          input.userSkills,
          input.userExperience
        );
      }),
  }),

  // Social Connections
  social: router({
    validateUrl: publicProcedure
      .input(z.object({
        url: z.string().trim().min(1).max(1000),
        type: z.enum(["linkedin", "github", "portfolio", "facebook", "twitter"]),
      }))
      .query(async ({ input }) => {
        const {
          validateFacebookUrl,
          validateGitHubUrl,
          validateLinkedInUrl,
          validatePortfolioUrl,
          validateTwitterUrl,
        } = await import("./socialConnections");
        
        let isValid = false;
        switch (input.type) {
          case "linkedin":
            isValid = validateLinkedInUrl(input.url);
            break;
          case "github":
            isValid = validateGitHubUrl(input.url);
            break;
          case "portfolio":
            isValid = validatePortfolioUrl(input.url);
            break;
          case "facebook":
            isValid = validateFacebookUrl(input.url);
            break;
          case "twitter":
            isValid = validateTwitterUrl(input.url);
            break;
        }
        
        return { isValid, type: input.type, url: input.url };
      }),

    connect: protectedProcedure
      .input(z.object({
        linkedinUrl: safeHttpUrl.optional(),
        githubUrl: safeHttpUrl.optional(),
        portfolioUrl: safeHttpUrl.optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { validateLinkedInUrl, validateGitHubUrl, validatePortfolioUrl } = await import("./socialConnections");
        const { upsertUserProfile } = await import("./db");

        const invalidConnection =
          (input.linkedinUrl && !validateLinkedInUrl(input.linkedinUrl)) ||
          (input.githubUrl && !validateGitHubUrl(input.githubUrl)) ||
          (input.portfolioUrl && !validatePortfolioUrl(input.portfolioUrl));
        if (invalidConnection) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "One or more social profile URLs are invalid.",
          });
        }

        await upsertUserProfile({
          userId: ctx.user.id,
          linkedinUrl: input.linkedinUrl,
          githubUrl: input.githubUrl,
          portfolioUrl: input.portfolioUrl,
        });
        
        return { success: true };
      }),
    disconnect: protectedProcedure
      .input(z.object({
        type: z.enum(["linkedin", "github", "portfolio"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getUserProfile, upsertUserProfile } = await import("./db");
        const profile = await getUserProfile(ctx.user.id);
        await upsertUserProfile({
          userId: ctx.user.id,
          linkedinUrl: input.type === "linkedin" ? null : profile?.linkedinUrl,
          githubUrl: input.type === "github" ? null : profile?.githubUrl,
          portfolioUrl: input.type === "portfolio" ? null : profile?.portfolioUrl,
        });
        return { success: true };
      }),
    getConnections: protectedProcedure.query(async ({ ctx }) => {
      const { getUserProfile, listPublicSocialProfiles } = await import("./db");
      const profile = await getUserProfile(ctx.user.id);
      const publicProfiles = await listPublicSocialProfiles(ctx.user.id);
      const publicProfileUrl = (platform: "facebook" | "twitter") =>
        publicProfiles.find((item) => item.platform === platform)?.profileUrl || null;
      return [
        { type: "linkedin", url: profile?.linkedinUrl || null, connected: Boolean(profile?.linkedinUrl) },
        { type: "github", url: profile?.githubUrl || null, connected: Boolean(profile?.githubUrl) },
        { type: "portfolio", url: profile?.portfolioUrl || null, connected: Boolean(profile?.portfolioUrl) },
        { type: "facebook", url: publicProfileUrl("facebook"), connected: Boolean(publicProfileUrl("facebook")) },
        { type: "twitter", url: publicProfileUrl("twitter"), connected: Boolean(publicProfileUrl("twitter")) },
      ];
    }),

    getPublicProfiles: protectedProcedure.query(async ({ ctx }) => {
      const { listPublicSocialProfiles } = await import("./db");
      return await listPublicSocialProfiles(ctx.user.id);
    }),

    updatePublicProfiles: protectedProcedure
      .input(z.object({
        facebookUrl: safeHttpUrl.nullable().optional(),
        twitterUrl: safeHttpUrl.nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { validateFacebookUrl, validateTwitterUrl } = await import("./socialConnections");
        const { createAuditEvent, listPublicSocialProfiles, setPublicSocialProfile } = await import("./db");
        if (
          (input.facebookUrl && !validateFacebookUrl(input.facebookUrl)) ||
          (input.twitterUrl && !validateTwitterUrl(input.twitterUrl))
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Facebook and X/Twitter links must point to the named public platform.",
          });
        }

        await Promise.all([
          input.facebookUrl === undefined
            ? Promise.resolve()
            : setPublicSocialProfile({ userId: ctx.user.id, platform: "facebook", profileUrl: input.facebookUrl }),
          input.twitterUrl === undefined
            ? Promise.resolve()
            : setPublicSocialProfile({ userId: ctx.user.id, platform: "twitter", profileUrl: input.twitterUrl }),
        ]);
        if (input.facebookUrl !== undefined || input.twitterUrl !== undefined) {
          await createAuditEvent({
            userId: ctx.user.id,
            entityType: "user",
            entityId: ctx.user.id,
            action: "public_social_profiles_updated",
            actor: "user",
            source: "social.updatePublicProfiles",
            afterState: JSON.stringify({
              facebookConnected: input.facebookUrl === undefined ? undefined : Boolean(input.facebookUrl),
              twitterConnected: input.twitterUrl === undefined ? undefined : Boolean(input.twitterUrl),
              externalReadPerformed: false,
            }),
            riskLevel: "low",
          });
        }
        return { success: true, profiles: await listPublicSocialProfiles(ctx.user.id) };
      }),

    analyzeLinkedIn: protectedProcedure
      .input(z.object({ profileText: socialProfileText }))
      .mutation(async ({ input }) => {
        const { analyzeLinkedInProfile } = await import("./socialConnections");
        return await analyzeLinkedInProfile(input.profileText);
      }),

    analyzeGitHub: protectedProcedure
      .input(z.object({ profileText: socialProfileText }))
      .mutation(async ({ input }) => {
        const { analyzeGitHubProfile } = await import("./socialConnections");
        return await analyzeGitHubProfile(input.profileText);
      }),

    analyzePortfolio: protectedProcedure
      .input(z.object({ portfolioText: socialProfileText }))
      .mutation(async ({ input }) => {
        const { analyzePortfolio } = await import("./socialConnections");
        return await analyzePortfolio(input.portfolioText);
      }),
  }),

  // Automated Application
  automation: router({
    detectATS: publicProcedure
      .input(z.object({ url: z.string().trim().min(1).max(1000) }))
      .query(async ({ input }) => {
        const { isAutomationSupported } = await import("./applicationAutomation");
        const support = isAutomationSupported(input.url);

        return support;
      }),
    getATSSupport: publicProcedure.query(async () => {
      return {
        submissionSupported: [],
        preparationSupported: [],
        materialPreparationSupported: true,
        guarded: ["greenhouse", "lever", "workday", "taleo", "smartrecruiters"],
        manualReviewRequired: ["unknown"],
        notes: "Hire.AI can prepare resume-linked application material in its ledger, but it does not open, fill, upload to, or submit any employer portal form. Employer handoff and confirmation remain manual.",
      };
    }),
    plan: protectedProcedure
      .input(z.object({
        mode: z.enum(["review_first", "auto_apply"]).optional(),
        minMatchScore: z.number().min(0).max(100).optional(),
        dailyApplicationLimit: z.number().min(1).max(25).optional(),
        remoteOnly: z.boolean().optional(),
        requireHumanReview: z.boolean().optional(),
        allowUnsupportedATS: z.boolean().optional(),
        createFollowUps: z.boolean().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const { getUserAutonomousPlanPreview } = await import("./applicationCampaigns");
        return await getUserAutonomousPlanPreview(ctx.user.id, input || {});
      }),
    run: protectedProcedure
      .input(z.object({
        mode: z.enum(["review_first", "auto_apply"]).optional(),
        minMatchScore: z.number().min(0).max(100).optional(),
        dailyApplicationLimit: z.number().min(1).max(25).optional(),
        remoteOnly: z.boolean().optional(),
        requireHumanReview: z.boolean().optional(),
        allowUnsupportedATS: z.boolean().optional(),
        createFollowUps: z.boolean().optional(),
      }).optional())
      .mutation(async ({ ctx, input }) => {
        const { runAutonomousForUser } = await import("./autonomousService");
        return await runAutonomousForUser(ctx.user.id, input || {});
      }),
    schedulerStatus: protectedProcedure.query(async ({ ctx }) => {
      const { getAutonomousScheduler } = await import("./autonomousScheduler");
      const { getAutonomousRunState, getUserProfile } = await import("./db");
      const {
        getNextAutonomousRunAt,
        parseAutonomousPreferences,
      } = await import("./autonomousOrchestrator");
      const scheduler = getAutonomousScheduler();
      const status = scheduler.getStatus();
      const userStatus = scheduler.getUserStatus(ctx.user.id);
      const persistedRunState = await getAutonomousRunState(ctx.user.id);
      const persistedSummary = persistedRunState?.lastStatus === "completed"
        ? persistedRunState.lastRunSummary
        : null;
      const persistedRunAt = persistedRunState?.lastStatus === "completed"
        ? persistedRunState.lastCompletedAt || persistedRunState.lastStartedAt
        : persistedRunState?.lastStartedAt || null;
      const profile = await getUserProfile(ctx.user.id);
      const preferences = parseAutonomousPreferences(profile?.preferences);
      const userEnabled = preferences.autonomousEnabled === true;
      const scanFrequency = preferences.scanFrequency || "daily";
      const nextEligibleAt = userEnabled && persistedRunState?.lastStatus !== "running"
        ? getNextAutonomousRunAt(persistedRunState?.lastCompletedAt, scanFrequency)
        : null;
      return {
        isStarted: status.isStarted,
        isRunning: status.isRunning,
        userEnabled,
        scanFrequency,
        lastCycleAt: persistedRunAt || userStatus?.lastRunAt || null,
        lastStatus: persistedRunState?.lastStatus || null,
        lastError: persistedRunState?.lastError || null,
        lastOutcomeDetail: persistedRunState?.lastOutcomeDetail || null,
        nextCycleAt: status.nextCycleAt,
        nextEligibleAt,
        isDue: Boolean(nextEligibleAt && nextEligibleAt.getTime() <= Date.now()),
        usersRun: persistedRunState?.lastStatus === "completed" || (!persistedRunState && userStatus) ? 1 : 0,
        jobsQueued: (persistedSummary
          ? persistedSummary.queuedApplicationRecords + persistedSummary.queuedReviewRecords + persistedSummary.queuedManualRecords
          : undefined) ?? userStatus?.jobsQueued ?? 0,
        followUpDraftsQueued: persistedSummary?.queuedFollowUps ?? userStatus?.followUpDraftsQueued ?? 0,
        duplicateFollowUpsSkipped: persistedSummary?.skippedDuplicateFollowUps ?? userStatus?.duplicateFollowUpsSkipped ?? 0,
        resumeEvidenceBlockedActions: persistedSummary?.skippedResumeEvidenceActions ?? userStatus?.resumeEvidenceBlockedActions ?? 0,
        profileReadinessBlockedActions: persistedSummary?.skippedProfileReadinessActions ?? userStatus?.profileReadinessBlockedActions ?? 0,
        evidenceGatedActions: persistedSummary?.skippedEvidenceGatedActions ?? userStatus?.evidenceGatedActions ?? 0,
        staleJobActionsSkipped: persistedSummary?.skippedStaleJobActions ?? 0,
        emptySourceActionsSkipped: persistedSummary?.skippedEmptySourceActions ?? userStatus?.emptySourceActionsSkipped ?? 0,
        userDecisionLockedJobs: persistedSummary?.userDecisionLockedJobs ?? userStatus?.userDecisionLockedJobs ?? 0,
        inboxProvidersScanned: persistedSummary?.inboxProvidersScanned ?? userStatus?.inboxProvidersScanned ?? 0,
        inboxReauthorizationRequired: persistedSummary?.inboxReauthorizationRequired ?? userStatus?.inboxReauthorizationRequired ?? 0,
        inboxCandidatesDiscovered: persistedSummary?.inboxCandidatesDiscovered ?? userStatus?.inboxCandidatesDiscovered ?? 0,
        inboxMonitoringFailures: persistedSummary?.inboxMonitoringFailures ?? userStatus?.inboxMonitoringFailures ?? 0,
        failedActions: persistedSummary?.failedActions ?? userStatus?.failedActions ?? 0,
        errorCount: persistedRunState?.lastStatus === "failed" ? 1 : userStatus?.errorCount || 0,
      };
    }),
    applyToJob: protectedProcedure
      .input(
        z.object({
          jobId: z.number().int().positive(),
          coverLetter: z.string().trim().max(50_000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        assertJobSearchTermsAccepted(ctx.user);
        const {
          getJobById,
          getUserProfile,
          getUserSkills,
          getWorkExperiences,
          createApplication,
          createApplicationMaterial,
          createApplicationAttempt,
          createAuditEvent,
          createAdminReviewItem,
          createApplicationApproval,
          getCanonicalJobId,
          getApplicationLedgerArtifacts,
          getPendingUserApplicationForJob,
        } = await import("./db");
        const {
          applyToJob,
          getPortalPreparationLedgerState,
          prepareApplicationData,
          validateApplicationData,
        } = await import(
          "./applicationAutomation"
        );
        const { buildReviewApplicationMaterial } = await import("./applicationMaterialDraft");

        // Get job details
        const canonicalJobId = await getCanonicalJobId(input.jobId);
        if (canonicalJobId === null) throw new Error("Job not found");
        input = { ...input, jobId: canonicalJobId };
        const job = await getJobById(input.jobId);
        if (!job) {
          throw new Error("Job not found");
        }
        assertJobCurrentForPreparation(job);

        if (!job.applicationUrl) {
          throw new Error("Job does not have an application URL");
        }

        // Get user profile
        const [profile, skills, workExperiences] = await Promise.all([
          getUserProfile(ctx.user.id),
          getUserSkills(ctx.user.id),
          getWorkExperiences(ctx.user.id),
        ]);
        if (!profile) {
          throw new Error("User profile not found. Please complete your profile first.");
        }

        // The versioned resume record is the source of truth for prepared application
        // material. Profile URL fields alone cannot prove that a resumable upload exists.
        const activeResume = await getActiveResume(ctx.user.id);
        if (!activeResume) {
          throw new Error("An active versioned resume is required before Hire.AI can prepare an application. Upload or select a resume on your profile first.");
        }
        const {
          applicationPreparationBlockMessage,
          getApplicationPreparationSafety,
        } = await import("./applicationPreparationSafety");
        const preparationSafety = await getApplicationPreparationSafety(ctx.user.id);
        if (!preparationSafety.allowed) {
          throw new Error(applicationPreparationBlockMessage(preparationSafety));
        }
        const profileForApplication = {
          ...resolveProfileCandidateEvidence(profile, skills, workExperiences),
          resumeUrl: activeResume.fileUrl,
          resumeFileKey: activeResume.fileKey,
        };
        const existingApplication = await getPendingUserApplicationForJob(ctx.user.id, input.jobId);
        const existingArtifacts = existingApplication
          ? await getApplicationLedgerArtifacts(existingApplication.id, ctx.user.id).catch(() => null)
          : null;
        const material = existingArtifacts?.material
          ? null
          : buildReviewApplicationMaterial(profileForApplication, job, input.coverLetter);
        const coverLetter = material?.coverLetter ?? existingArtifacts?.material?.coverLetter ?? undefined;

        // Prepare application data
        const applicationData = prepareApplicationData(ctx.user, profileForApplication, coverLetter);
        if (!applicationData) {
          throw new Error("Unable to prepare application data. Please ensure your profile is complete.");
        }

        // Validate application data
        const validation = validateApplicationData(applicationData);
        if (!validation.valid) {
          throw new Error(`Invalid application data: ${validation.errors.join(", ")}`);
        }

        // Prepare material for a controlled employer-portal handoff.
        const result = await applyToJob(job.applicationUrl, applicationData);
        const ledgerState = getPortalPreparationLedgerState(result);

        // Portal preparation cannot claim an external submission. Only
        // applications.confirmSubmission writes the applied state with evidence.
        const applicationRecord = await createApplication({
          userId: ctx.user.id,
          jobId: input.jobId,
          status: ledgerState.status,
          appliedDate: undefined,
          coverLetter: material?.coverLetter,
          notes: result.message,
          isAutoApplied: ledgerState.isAutoApplied,
        });
        const applicationRecordId = Number(applicationRecord.insertId);
        const artifacts = existingArtifacts ?? (applicationRecord.existing === true
          ? await getApplicationLedgerArtifacts(applicationRecordId, ctx.user.id).catch(() => null)
          : null);
        if (material && !artifacts?.material) {
          await createApplicationMaterial({
            applicationId: applicationRecordId,
            resumeId: activeResume.id,
            coverLetter: material.coverLetter,
            customAnswers: material.customAnswers,
            claimsMade: material.claimsMade,
            sourceProfileSnapshot: profileSnapshotForApplication(ctx.user, profileForApplication),
          });
        }
        await createApplicationAttempt({
          applicationId: applicationRecordId,
          userId: ctx.user.id,
          jobId: input.jobId,
          platformId: job.platformId,
          attemptType: "prepare",
          status: ledgerState.attemptStatus,
          startedAt: new Date(),
          finishedAt: new Date(),
          errorMessage: result.error,
          confirmationText: result.message,
          retryCount: 0,
        });
        await createAuditEvent({
          userId: ctx.user.id,
          entityType: "application",
          entityId: applicationRecordId,
          action: ledgerState.auditAction,
          actor: "system",
          source: "automation.applyToJob",
          afterState: JSON.stringify({
            jobId: input.jobId,
            atsType: result.atsType,
            prepared: result.prepared,
            submissionAttempted: result.submissionAttempted,
            reviewRequired: result.reviewRequired,
            externalSubmissionPerformed: ledgerState.externalSubmissionPerformed,
            status: ledgerState.status,
            resume: {
              id: activeResume.id,
              version: activeResume.version,
              fileName: activeResume.fileName,
              fileKey: activeResume.fileKey,
            },
            materialSource: material?.materialSource ?? "existing_application_material",
            userProvidedCoverLetter: material?.userProvidedCoverLetter ?? null,
          }),
          riskLevel: result.reviewRequired ? "medium" : "low",
        });
        await createAdminReviewItem({
          userId: ctx.user.id,
          entityType: "application",
          entityId: applicationRecordId,
          category: "application_review",
          priority: result.reviewRequired ? "high" : "medium",
          title: "Automation prepared application for review",
          description: result.message,
        });
        await createApplicationApproval({
          userId: ctx.user.id,
          applicationId: applicationRecordId,
          entityType: "application",
          entityId: applicationRecordId,
          approvalType: "application_submission",
          status: "pending",
          riskLevel: result.reviewRequired ? "high" : "medium",
          requestedBy: "system",
          title: "Approve automation-prepared submission",
          description: result.message,
          payload: JSON.stringify({
            jobId: input.jobId,
            atsType: result.atsType,
            prepared: result.prepared,
            submissionAttempted: result.submissionAttempted,
            resumeId: activeResume.id,
            resumeVersion: activeResume.version,
            materialSource: material?.materialSource ?? "existing_application_material",
            userProvidedCoverLetter: material?.userProvidedCoverLetter ?? null,
            source: "automation.applyToJob",
          }),
        });

        return {
          ...result,
          applicationRecordId,
          applicationUrl: job.applicationUrl,
        };
      }),
  }),

  // Job Normalization
  normalization: router({
    normalizeSalary: publicProcedure
      .input(z.object({ salary: z.string().max(500) }))
      .query(({ input }) => normalizeSalary(input.salary)),

    normalizeLocation: publicProcedure
      .input(z.object({ location: z.string().max(500) }))
      .query(({ input }) => normalizeLocation(input.location)),

    normalizeJobType: publicProcedure
      .input(z.object({ jobType: z.string().max(200) }))
      .query(({ input }) => normalizeJobType(input.jobType)),

    normalizeExperienceLevel: publicProcedure
      .input(z.object({ text: z.string().max(5000) }))
      .query(({ input }) => normalizeExperienceLevel(input.text)),

    extractSkills: publicProcedure
      .input(z.object({ description: z.string().max(50_000) }))
      .query(({ input }) => extractSkills(input.description)),

    extractBenefits: publicProcedure
      .input(z.object({ description: z.string().max(50_000) }))
      .query(({ input }) => extractBenefits(input.description)),

    checkDuplicate: protectedProcedure
      .input(z.object({
        text: z.string().trim().min(1).max(50_000),
        threshold: z.number().finite().min(0).max(1).optional(),
      }))
      .query(({ input }) => {
        const deduplicator = getDeduplicator();
        return deduplicator.isDuplicate(input.text, input.threshold || 0.85);
      }),

    addToCorpus: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        text: z.string().trim().min(1).max(50_000),
      }))
      .mutation(({ input }) => {
        const deduplicator = getDeduplicator();
        deduplicator.addDocument(input.id, input.text);
        return { success: true, stats: deduplicator.getStats() };
      }),
  }),

  // Job Alerts
  alerts: router({
    create: protectedProcedure
      .input(z.object({
        name: z.string().trim().min(1).max(255),
        keywords: z.string().max(5000).optional(),
        locations: z.string().max(5000).optional(),
        platforms: z.string().max(5000).optional(),
        minSalary: z.number().int().min(0).max(10_000_000).optional(),
        jobTypes: z.string().max(1000).optional(),
        frequency: z.enum(["instant", "daily", "weekly"]),
      }))
      .mutation(async ({ ctx, input }) => {
        return await createJobAlert({
          userId: ctx.user.id,
          ...input,
        });
      }),

    listPage: protectedProcedure
      .input(z.object({
        limit: boundedPageSize.optional().default(50),
        cursor: z.object({
          createdAt: z.date(),
          id: z.number().int().positive(),
        }).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const { getJobAlertPage } = await import("./applicationFeatures");
        return await getJobAlertPage(ctx.user.id, input);
      }),

    update: protectedProcedure
      .input(z.object({
        alertId: z.number().int().positive(),
        name: z.string().trim().min(1).max(255).optional(),
        keywords: z.string().max(5000).optional(),
        locations: z.string().max(5000).optional(),
        platforms: z.string().max(5000).optional(),
        minSalary: z.number().int().min(0).max(10_000_000).optional(),
        jobTypes: z.string().max(1000).optional(),
        frequency: z.enum(["instant", "daily", "weekly"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { alertId, ...updates } = input;
        return await updateJobAlert(ctx.user.id, alertId, updates);
      }),

    toggle: protectedProcedure
      .input(z.object({ alertId: z.number().int().positive(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        return await toggleJobAlert(ctx.user.id, input.alertId, input.isActive);
      }),

    delete: protectedProcedure
      .input(z.object({ alertId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        return await deleteJobAlert(ctx.user.id, input.alertId);
      }),
  }),

  // Interview Preparation
  interviewPrep: router({
    generateQuestions: protectedProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        return await generateInterviewQuestionsForApplication(input.applicationId, ctx.user.id);
      }),

    mockInterview: protectedProcedure
      .input(z.object({
        applicationId: z.number().int().positive(),
        userResponse: z.string().trim().min(1).max(10_000),
        questionIndex: z.number().int().min(0).max(100),
      }))
      .mutation(async ({ ctx, input }) => {
        return await conductMockInterviewForApplication(
          input.applicationId,
          input.userResponse,
          input.questionIndex,
          ctx.user.id
        );
      }),

    videoTips: protectedProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        return await getVideoInterviewTipsForApplication(input.applicationId, ctx.user.id);
      }),
  }),
  successFees: successFeesRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
