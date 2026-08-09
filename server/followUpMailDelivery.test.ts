import { describe, expect, it, vi } from "vitest";
import {
  normalizeFollowUpRecipient,
  sendApprovedFollowUp,
  sendFollowUpProviderMessage,
} from "./followUpMailDelivery";

describe("approved follow-up mailbox delivery", () => {
  it("rejects recipient values that could create ambiguous or injected mail headers", () => {
    expect(normalizeFollowUpRecipient("recruiter@example.com")).toBe("recruiter@example.com");
    expect(() => normalizeFollowUpRecipient("recruiter@example.com\nBcc: other@example.com")).toThrow(/valid recipient/i);
    expect(() => normalizeFollowUpRecipient("not an email")).toThrow(/valid recipient/i);
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
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));

    await expect(sendFollowUpProviderMessage(
      "gmail",
      "access-token",
      "recruiter@example.com",
      "Follow-up",
      "Hello",
      fetcher
    )).rejects.toThrow("Gmail rejected");
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
