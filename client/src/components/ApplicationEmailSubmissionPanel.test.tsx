import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationEmailSubmissionPanel } from "./ApplicationEmailSubmissionPanel";

const state = vi.hoisted(() => ({
  submission: null as unknown,
  eligibility: { eligible: true, reason: null } as unknown,
  approvals: [] as unknown[],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({ locale: "en" }),
}));

vi.mock("sonner", () => ({
  toast: { error: () => undefined, success: () => undefined },
}));

vi.mock("@/lib/trpc", () => {
  const invalidate = async () => undefined;
  const mutation = {
    isPending: false,
    mutate: () => undefined,
    mutateAsync: async () => undefined,
  };
  const mutationRoute = { useMutation: () => mutation };
  return {
    trpc: {
      useUtils: () => ({
        applications: {
          getEmailSubmission: { invalidate },
          getEmailSubmissionEligibility: { invalidate },
          getSummary: { invalidate },
          listApprovals: { invalidate },
          listPage: { invalidate },
        },
      }),
      applications: {
        getEmailSubmission: {
          useQuery: () => ({
            data: state.submission,
            isError: false,
            isLoading: false,
            refetch: async () => undefined,
          }),
        },
        getEmailSubmissionEligibility: {
          useQuery: () => ({
            data: state.eligibility,
            isError: false,
            isLoading: false,
            refetch: async () => undefined,
          }),
        },
        listApprovals: {
          useQuery: () => ({
            data: state.approvals,
            isError: false,
            refetch: async () => undefined,
          }),
        },
        prepareEmailSubmission: mutationRoute,
        requestEmailSubmissionApproval: mutationRoute,
        resolveEmailSubmissionApproval: mutationRoute,
        sendEmailSubmission: mutationRoute,
        updateEmailSubmissionDraft: mutationRoute,
      },
    },
  };
});

afterEach(() => {
  state.submission = null;
  state.eligibility = { eligible: true, reason: null };
  state.approvals = [];
});

describe("ApplicationEmailSubmissionPanel", () => {
  it("shows persisted sent history for an application that is no longer pending", () => {
    state.submission = {
      id: 21,
      applicationId: 7,
      provider: "gmail",
      status: "sent",
      recipient: "jobs@example.test",
      subject: "Application",
      message: "Synthetic application message",
      resumeFileName: "resume.pdf",
      resumeSize: 1024,
      attemptCount: 1,
      providerMessageId: "synthetic-message-id",
      failureMessage: null,
      approvedAt: new Date("2026-10-15T12:00:00Z"),
      sentAt: new Date("2026-10-15T12:01:00Z"),
      updatedAt: new Date("2026-10-15T12:01:00Z"),
    };

    const markup = renderToStaticMarkup(
      createElement(ApplicationEmailSubmissionPanel, {
        applicationId: 7,
        applicationStatus: "applied",
      })
    );

    expect(markup).toContain("Accepted by provider");
    expect(markup).toContain("read-only and cannot be sent again");
    expect(markup).not.toContain("Send approved email now");
  });

  it("hides email controls for a closed application with no delivery history", () => {
    const markup = renderToStaticMarkup(
      createElement(ApplicationEmailSubmissionPanel, {
        applicationId: 8,
        applicationStatus: "rejected",
      })
    );

    expect(markup).toBe("");
  });

  it("keeps preparation available for a pending application without a delivery", () => {
    const markup = renderToStaticMarkup(
      createElement(ApplicationEmailSubmissionPanel, {
        applicationId: 9,
        applicationStatus: "pending",
      })
    );

    expect(markup).toContain("Prepare email");
  });

  it("explains when the backend blocks email submission for a non-remote listing", () => {
    state.eligibility = { eligible: false, reason: "not_fully_remote" };

    const markup = renderToStaticMarkup(
      createElement(ApplicationEmailSubmissionPanel, {
        applicationId: 10,
        applicationStatus: "pending",
      })
    );

    expect(markup).toContain("does not clearly confirm a fully remote role");
    expect(markup).not.toContain("Prepare email");
  });
});
