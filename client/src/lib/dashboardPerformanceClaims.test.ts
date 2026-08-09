import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("dashboard performance claims", () => {
  it("anchors outcome labels to operating-ledger evidence instead of benchmarks or hype", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "client", "src", "pages", "Dashboard.tsx"), "utf8");

    expect(dashboard).toContain("getApplicationPerformanceSummary");
    expect(dashboard).toContain("Ledger-derived rates from confirmed submissions");
    expect(dashboard).not.toContain("Above average employer engagement");
    expect(dashboard).not.toContain("Strong interview invitation rate");
    expect(dashboard).not.toContain("Great progress!");
  });

  it("loads the dashboard from one bounded operating snapshot", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "client", "src", "pages", "Dashboard.tsx"), "utf8");

    expect(dashboard.match(/\.useQuery\(/g)).toHaveLength(1);
    expect(dashboard).toContain("trpc.applications.getOperatingLedger.useQuery");
    expect(dashboard).not.toContain("trpc.applications.list.useQuery");
    expect(dashboard).not.toContain("trpc.automation.plan.useQuery");
    expect(dashboard).not.toContain("trpc.jobs.list.useQuery");
    expect(dashboard).not.toContain("trpc.successFees.getMyFees.useQuery");
  });

  it("batch-loads application evidence once for operating-ledger projections", () => {
    const campaigns = readFileSync(
      resolve(process.cwd(), "server", "applicationCampaigns.ts"),
      "utf8"
    );

    expect(campaigns).toContain("loadOperatingApplicationEvidence");
    expect(campaigns).toContain("getUserEmployerResponsesForApplications");
    expect(campaigns).toContain("getUserInterviewSchedulesForApplications");
    expect(campaigns).toContain("getUserFollowUpsForApplications");
    expect(campaigns).toContain("getUpcomingInterviewPreparationPage");
    expect(campaigns).toContain("getInterviewSchedulingPage(userId, 5)");
    expect(campaigns).toContain("getEmployerResponseReplyPage(userId, 5)");
    expect(campaigns).toContain("getFollowUpDeliveryOperatingQueues(userId, 5)");
    expect(campaigns).toContain("getInterviewOutcomePage(userId, 5)");
    expect(campaigns).not.toContain("listInterviewPreparationsForUser");
    expect(campaigns).toContain("getUserOfferAttributionReviews(userId, {");
    expect(campaigns).toContain("getUserAdminReviewPage(userId");
    expect(campaigns).not.toContain("listUserAdminReviewItems(userId");
    expect(campaigns).not.toContain("listAdminReviewItems(\"all\")");
    expect(campaigns).not.toMatch(/\bgetEmployerResponses\(/);
    expect(campaigns).not.toMatch(/\bgetInterviewSchedules\(/);
    expect(campaigns).not.toMatch(/\bgetFollowUps\(/);
    expect(campaigns).not.toMatch(/\bgetInterviewPreparationForJob\(/);
  });

  it("keeps application lifecycle approval reads scoped to one application", () => {
    const features = readFileSync(
      resolve(process.cwd(), "server", "applicationFeatures.ts"),
      "utf8"
    );

    expect(features).toContain("listUserApplicationApprovalsForApplication");
    expect(features).not.toContain("listUserApplicationApprovals(userId, \"all\")");
  });

  it("builds admin review evidence from exact owned records", () => {
    const database = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const evidenceFunction = database.slice(
      database.indexOf("export async function getAdminReviewEvidenceSnapshot"),
      database.indexOf("export async function resolveAdminReviewItem")
    );

    expect(evidenceFunction).toContain("getUserApplicationById");
    expect(evidenceFunction).toContain("getUserApplicationDecisionForJob");
    expect(evidenceFunction).toContain("listUserApplicationApprovalsForApplication");
    expect(evidenceFunction).not.toContain("getUserApplications(");
    expect(evidenceFunction).not.toContain("getUserApplicationDecisions(");
  });

  it("uses exact owned records for single-application lifecycle mutations", () => {
    const features = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const approvalResolution = router.slice(
      router.indexOf("resolveApproval: protectedProcedure"),
      router.indexOf("updateStatus: protectedProcedure")
    );
    const offerDecline = router.slice(
      router.indexOf("declineOffer: protectedProcedure"),
      router.indexOf("confirmSubmission: protectedProcedure")
    );

    expect(features).toContain("getUserApplicationById(userId, input.applicationId)");
    expect(features).toContain("getUserApplicationById(userId, applicationId)");
    expect(features).not.toContain("(await getUserApplications(userId)).find");
    expect(features).not.toContain("const userApplications = await getUserApplications(userId)");
    expect(approvalResolution).toContain("getUserApplicationApprovalById");
    expect(approvalResolution).toContain("getUserApplicationById");
    expect(approvalResolution).not.toContain("listUserApplicationApprovals");
    expect(approvalResolution).not.toContain("getUserApplications");
    expect(offerDecline).toContain("getUserApplicationById");
    expect(offerDecline).not.toContain("getUserApplications");
    expect(router.match(/getPendingUserApplicationForJob\(ctx\.user\.id, input\.jobId\)/g))
      .toHaveLength(4);
    expect(router).not.toContain("(await getUserApplications(ctx.user.id)).find");
    expect(router).toContain("listUserApplicationApprovalsForApplication");
  });

  it("resolves employer reply targets through one exact ownership-scoped query", () => {
    const features = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");
    const replyTarget = features.slice(
      features.indexOf("async function getEmployerResponseForReply"),
      features.indexOf("function getFollowUpDraftMetadata")
    );

    expect(replyTarget).toContain("getEmployerResponseReplyTarget(applicationId, userId, responseId)");
    expect(replyTarget).not.toContain("getEmployerResponses(");
  });

  it("loads interview preparation context through one bounded owned query", () => {
    const features = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");
    const interviewContext = features.slice(
      features.indexOf("export async function getOwnedUpcomingInterviewContext"),
      features.indexOf("export async function generateInterviewPreparationForApplication")
    );

    expect(interviewContext).toContain(".innerJoin(interviewSchedules");
    expect(interviewContext).toContain("eq(applications.userId, userId)");
    expect(interviewContext).toContain(".limit(1)");
    expect(interviewContext).not.toContain("getInterviewSchedules(");
  });

  it("batch-loads autonomous follow-up evidence once per run", () => {
    const autonomousService = readFileSync(
      resolve(process.cwd(), "server", "autonomousService.ts"),
      "utf8"
    );

    expect(autonomousService).toContain("getUserEmployerResponsesForApplications");
    expect(autonomousService).toContain("getUserInterviewSchedulesForApplications");
    expect(autonomousService).toContain("getUserFollowUpsForApplications");
    expect(autonomousService).not.toMatch(/\bgetEmployerResponses\(/);
    expect(autonomousService).not.toMatch(/\bgetInterviewSchedules\(/);
    expect(autonomousService).not.toMatch(/\bgetFollowUps\(/);
  });

  it("keeps dashboard and autonomous application history bounded", () => {
    const campaigns = readFileSync(
      resolve(process.cwd(), "server", "applicationCampaigns.ts"),
      "utf8"
    );
    const autonomousService = readFileSync(
      resolve(process.cwd(), "server", "autonomousService.ts"),
      "utf8"
    );

    expect(campaigns).toContain("getUserOperatingApplicationWindow(userId)");
    expect(campaigns).toContain("getUserApplicationsForJobs(");
    expect(campaigns).toContain("getUserApplicationSummary(userId)");
    expect(campaigns).toContain("getUserOperatingApplicationApprovals(");
    expect(campaigns).toContain("getUserReviewDecisionPage(userId)");
    expect(campaigns).not.toContain("getUserApplications(userId)");
    expect(campaigns).not.toContain("listUserApplicationApprovals(userId, \"all\")");
    expect(campaigns).not.toContain("getUserApplicationDecisions(userId)");
    expect(autonomousService).toContain("getUserOperatingApplicationWindow(userId)");
    expect(autonomousService).toContain("countUserAutonomousPreparationsSince");
    expect(autonomousService).toContain("getUserApplicationDecisionsForJobs(");
    expect(autonomousService).not.toContain("getUserApplications(userId)");
    expect(autonomousService).not.toContain("getUserApplicationDecisions(userId)");
  });
});
