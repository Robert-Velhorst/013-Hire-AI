import { describe, expect, it } from "vitest";
import type { Job } from "../drizzle/schema";
import { getApplicationEmailEligibility, isEligibleEmailApplicationJob, isStaleApplicationEmailSending } from "./applicationEmailDelivery";
import { buildMultipartMailMessage, sendFollowUpProviderMessage } from "./followUpMailDelivery";

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id: 1,
    externalId: "remote-1",
    title: "Customer Support Specialist",
    company: "Example Co",
    description: "Fully remote role open worldwide.",
    requirements: null,
    responsibilities: null,
    benefits: null,
    location: "Worldwide remote",
    jobType: "full-time",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    skills: null,
    applicationUrl: null,
    applicationEmail: "jobs@example.test",
    applicationProcess: null,
    platformId: 1,
    sourceUrl: "https://jobs.example.test/remote-1",
    postedDate: now,
    expiryDate: null,
    isActive: 1,
    visaSponsorshipAvailable: 0,
    openHiringSupport: 0,
    diversityFriendly: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("application email delivery policy", () => {
  it("returns actionable availability reasons using the same policy as the send path", () => {
    expect(getApplicationEmailEligibility("pending", makeJob())).toEqual({ eligible: true, reason: null });
    expect(getApplicationEmailEligibility("applied", makeJob())).toMatchObject({ reason: "application_not_pending" });
    expect(getApplicationEmailEligibility("pending", makeJob({ applicationEmail: null }))).toMatchObject({ reason: "missing_application_email" });
    expect(getApplicationEmailEligibility("pending", makeJob({ applicationEmail: "not-an-email" }))).toMatchObject({ reason: "invalid_application_email" });
    expect(getApplicationEmailEligibility("pending", makeJob({ description: "Hybrid attendance required" }))).toMatchObject({ reason: "not_fully_remote" });
    expect(getApplicationEmailEligibility("pending", makeJob({ updatedAt: new Date("2025-01-01T00:00:00.000Z") }))).toMatchObject({ reason: "listing_not_current" });
    expect(getApplicationEmailEligibility("pending", null)).toMatchObject({ reason: "application_not_found" });
  });

  it("marks interrupted send reservations stale only after the recovery window", () => {
    const now = new Date("2026-10-15T12:00:00.000Z");

    expect(isStaleApplicationEmailSending(new Date(now.getTime() - 299_999), now)).toBe(false);
    expect(isStaleApplicationEmailSending(new Date(now.getTime() - 300_000), now)).toBe(true);
    expect(isStaleApplicationEmailSending(new Date(now.getTime() + 1), now)).toBe(false);
  });

  it("allows a current, explicitly remote listing without hybrid or office requirements", () => {
    expect(isEligibleEmailApplicationJob(makeJob())).toBe(true);
  });

  it("fails closed for hybrid, unclassified, inactive, and stale listings", () => {
    expect(isEligibleEmailApplicationJob(makeJob({ description: "Remote-friendly, but hybrid attendance is expected." }))).toBe(false);
    expect(isEligibleEmailApplicationJob(makeJob({ location: "Amsterdam", description: "A great role with flexible working." }))).toBe(false);
    expect(isEligibleEmailApplicationJob(makeJob({ isActive: 0 }))).toBe(false);
    expect(isEligibleEmailApplicationJob(makeJob({ updatedAt: new Date("2025-01-01T00:00:00.000Z") }))).toBe(false);
  });

  it("builds a multipart attachment without allowing header injection", () => {
    const mime = buildMultipartMailMessage(
      "jobs@example.test",
      "Application\r\nBcc: attacker@example.test",
      "Hello,\r\nPlease find my resume attached.",
      { fileName: "Robert Resume.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) },
      "hire-ai-test-boundary"
    );

    expect(mime).toContain("To: jobs@example.test\r\nSubject: Application Bcc: attacker@example.test");
    expect(mime).toContain("Content-Type: application/pdf;");
    expect(mime).toContain("JVBERg==");
    expect(mime).not.toContain("\r\nBcc: attacker@example.test");
    expect(mime).toContain("--hire-ai-test-boundary--");
  });

  it("sends resume attachments through Gmail MIME and Outlook Graph formats", async () => {
    const attachment = {
      fileName: "Resume.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([37, 80, 68, 70]),
    };
    let gmailInit: RequestInit | undefined;
    const gmailFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      gmailInit = init;
      return new Response(JSON.stringify({ id: "gmail-message-1" }), { status: 200 });
    }) as typeof fetch;
    await sendFollowUpProviderMessage("gmail", "access", "jobs@example.test", "Application", "Hello", gmailFetch, attachment);
    const gmailBody = JSON.parse(String(gmailInit?.body)) as { raw: string };
    const gmailMime = Buffer.from(gmailBody.raw, "base64url").toString("utf8");
    expect(gmailMime).toContain("Content-Disposition: attachment;");
    expect(gmailMime).toContain("JVBERg==");

    let outlookInit: RequestInit | undefined;
    const outlookFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      outlookInit = init;
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    await sendFollowUpProviderMessage("outlook", "access", "jobs@example.test", "Application", "Hello", outlookFetch, attachment);
    const outlookBody = JSON.parse(String(outlookInit?.body)) as {
      message: { attachments: Array<{ name: string; contentType: string; contentBytes: string }> };
    };
    expect(outlookBody.message.attachments[0]).toMatchObject({
      name: "Resume.pdf",
      contentType: "application/pdf",
      contentBytes: "JVBERg==",
    });
  });
});
