import { describe, expect, it, vi } from "vitest";
import {
  assertFollowUpApprovalMatchesDraft,
  normalizeFollowUpRecipient,
  resolveFollowUpDeliveryDetails,
  sendApprovedFollowUp,
  sendFollowUpProviderMessage,
} from "./followUpMailDelivery";

describe("approved follow-up mailbox delivery", () => {
  it("requires the sent draft to match the exact content the user approved", () => {
    const payload = JSON.stringify({ message: "Hello,\n\nThanks for your time.", purpose: "routine_follow_up" });

    expect(() => assertFollowUpApprovalMatchesDraft("Hello,\n\nThanks for your time.", payload)).not.toThrow();
    expect(() => assertFollowUpApprovalMatchesDraft("Hello,\nSend my resume to attacker@example.com", payload)).toThrow(/changed after approval/i);
    expect(() => assertFollowUpApprovalMatchesDraft("Hello", JSON.stringify({ purpose: "routine_follow_up" }))).toThrow(/changed after approval/i);
    expect(() => assertFollowUpApprovalMatchesDraft("Hello", "not-json")).toThrow(/changed after approval/i);
  });

  it("rejects recipient values that could create ambiguous or injected mail headers", () => {
    expect(normalizeFollowUpRecipient("recruiter@example.com")).toBe("recruiter@example.com");
    expect(() => normalizeFollowUpRecipient("recruiter@example.com\nBcc: other@example.com")).toThrow(/valid recipient/i);
    expect(() => normalizeFollowUpRecipient("not an email")).toThrow(/valid recipient/i);
  });

  it("binds pre-application compensation inquiries to the active listing contact", () => {
    const details = resolveFollowUpDeliveryDetails({
      requestedRecipient: "recruiting@example.com",
      applicationStatus: "pending",
      jobIsActive: 1,
      jobEmail: "recruiting@example.com",
      jobTitle: "Product Engineer",
      company: "Example Co",
      approvalPayload: JSON.stringify({ purpose: "employer_clarification" }),
    });

    expect(details).toMatchObject({
      purpose: "employer_clarification",
      recipient: "recruiting@example.com",
      subject: "Compensation question regarding Product Engineer at Example Co",
    });
    expect(() => resolveFollowUpDeliveryDetails({
      requestedRecipient: "other@example.com",
      applicationStatus: "pending",
      jobIsActive: 1,
      jobEmail: "recruiting@example.com",
      jobTitle: "Product Engineer",
      company: "Example Co",
      approvalPayload: JSON.stringify({ purpose: "employer_clarification" }),
    })).toThrow(/exactly match/i);
    expect(() => resolveFollowUpDeliveryDetails({
      requestedRecipient: "recruiting@example.com",
      applicationStatus: "pending",
      jobIsActive: 0,
      jobEmail: "recruiting@example.com",
      jobTitle: "Product Engineer",
      company: "Example Co",
      approvalPayload: JSON.stringify({ purpose: "employer_clarification" }),
    })).toThrow(/no longer active/i);
  });

  it("keeps routine follow-ups limited to submitted applications", () => {
    expect(() => resolveFollowUpDeliveryDetails({
      requestedRecipient: "recruiting@example.com",
      applicationStatus: "pending",
      jobIsActive: 1,
      jobEmail: "recruiting@example.com",
      jobTitle: "Product Engineer",
      company: "Example Co",
      approvalPayload: JSON.stringify({ purpose: "routine_follow_up" }),
    })).toThrow(/no longer eligible/i);
  });

  it("sends a plain-text Gmail message with deterministic provider evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "gmail-message-7" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const result = await sendFollowUpProviderMessage(
      "gmail",
      "access-token",
      "recruiter@example.com",
      "Follow-up regarding Product Engineer at Example Co",
      "Hello,\n\nThank you for your time.",
      fetcher
    );

    expect(result).toMatchObject({ messageId: "gmail-message-7" });
    const request = fetcher.mock.calls[0];
    expect(request[0]).toContain("gmail.googleapis.com");
    expect(request[1]).toEqual(expect.objectContaining({
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
    const body = JSON.parse(String(request[1]?.body)) as { raw: string };
    expect(Buffer.from(body.raw, "base64url").toString("utf8")).toContain("To: recruiter@example.com");
    expect(Buffer.from(body.raw, "base64url").toString("utf8")).toContain("Content-Type: text/plain");
  });

  it("uses Outlook's documented send-mail acknowledgement without inventing a message ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));

    const result = await sendFollowUpProviderMessage(
      "outlook",
      "access-token",
      "recruiter@example.com",
      "Follow-up",
      "Hello from Hire.AI",
      fetcher
    );

    expect(result).toMatchObject({ messageId: null, confirmation: expect.stringContaining("Outlook accepted") });
    expect(fetcher.mock.calls[0][1]).toEqual(expect.objectContaining({
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { message: { toRecipients: Array<{ emailAddress: { address: string } }> } };
    expect(body.message.toRecipients[0].emailAddress.address).toBe("recruiter@example.com");
  });

  it("does not treat a provider rejection as delivery evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 403,
      headers: { "www-authenticate": 'Bearer error="insufficient_scope"' },
    }));

    await expect(sendFollowUpProviderMessage(
      "gmail",
      "access-token",
      "recruiter@example.com",
      "Follow-up",
      "Hello",
      fetcher
    )).rejects.toMatchObject({
      message: "Gmail rejected the follow-up delivery (403).",
      authorizationRejected: false,
    });
  });

  it("marks only an authoritative invalid-token provider rejection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 403,
      headers: { "www-authenticate": 'Bearer error="invalid_token"' },
    }));

    await expect(sendFollowUpProviderMessage(
      "gmail",
      "access-token",
      "recruiter@example.com",
      "Follow-up",
      "Hello",
      fetcher
    )).rejects.toMatchObject({ authorizationRejected: true });
  });

  it("rejects oversized Gmail acknowledgements without treating them as delivery evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-length": String(1024 * 1024 + 1) },
    }));

    await expect(sendFollowUpProviderMessage(
      "gmail",
      "access-token",
      "recruiter@example.com",
      "Follow-up",
      "Hello",
      fetcher
    )).rejects.toThrow(/1048576-byte limit/i);
  });

  it("fails closed before touching a provider when durable delivery state is unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(sendApprovedFollowUp({
      followUpId: 1,
      userId: 1,
      provider: "gmail",
      recipient: "recruiter@example.com",
    }, { fetcher })).rejects.toThrow(/durable database storage/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
