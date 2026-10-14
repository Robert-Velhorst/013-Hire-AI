import { describe, expect, it, vi } from "vitest";
import { normalizeFollowUpRecipient, sendApprovedFollowUp, sendFollowUpProviderMessage } from "./followUpMailDelivery";

describe("approved follow-up mailbox delivery", () => {
  it("rejects recipient values that could create ambiguous or injected mail headers", () => {
    expect(normalizeFollowUpRecipient("recruiter@example.com")).toBe("recruiter@example.com");
    expect(() => normalizeFollowUpRecipient("recruiter@example.com\nBcc: other@example.com")).toThrow(/valid recipient/i);
    expect(() => normalizeFollowUpRecipient("not an email")).toThrow(/valid recipient/i);
  });

  it("sends a plain-text Gmail message with deterministic provider evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "gmail-message-7" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await sendFollowUpProviderMessage("gmail", "access-token", "recruiter@example.com", "Follow-up regarding Product Engineer at Example Co", "Hello,\n\nThank you for your time.", fetcher);

    expect(result).toMatchObject({ messageId: "gmail-message-7" });
    const request = fetcher.mock.calls[0];
    expect(request[0]).toContain("gmail.googleapis.com");
    expect(request[1]).toEqual(
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      })
    );
    const body = JSON.parse(String(request[1]?.body)) as { raw: string };
    expect(Buffer.from(body.raw, "base64url").toString("utf8")).toContain("To: recruiter@example.com");
    expect(Buffer.from(body.raw, "base64url").toString("utf8")).toContain("Content-Type: text/plain");
  });

  it("sends a sanitized PDF attachment through Gmail MIME without allowing header injection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "gmail-attachment-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await sendFollowUpProviderMessage("gmail", "access-token", "recruiter@example.com", "Role\r\nBcc: attacker@example.com", "Application attached.", fetcher, [
      {
        fileName: "../Robert\r\nBcc.pdf",
        mimeType: "application/pdf",
        data: Buffer.from("resume-bytes"),
      },
    ]);

    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as {
      raw: string;
    };
    const mime = Buffer.from(request.raw, "base64url").toString("utf8");
    expect(mime).toContain("Subject: Role Bcc: attacker@example.com");
    expect(mime).toContain('filename=".._Robert__Bcc.pdf"');
    expect(mime).toContain('Content-Type: application/pdf; name=".._Robert__Bcc.pdf"');
    expect(mime).not.toContain("\r\nBcc:");
    expect(mime).toContain(Buffer.from("resume-bytes").toString("base64"));
  });

  it("sends an Outlook file attachment with the original bytes encoded as base64", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const bytes = Buffer.from("resume-bytes");
    await sendFollowUpProviderMessage("outlook", "access-token", "recruiter@example.com", "Application", "Please find my resume attached.", fetcher, [
      { fileName: "resume.pdf", mimeType: "application/pdf", data: bytes },
    ]);

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as {
      message: {
        attachments: Array<{
          name: string;
          contentType: string;
          contentBytes: string;
        }>;
      };
    };
    expect(body.message.attachments).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "resume.pdf",
        contentType: "application/pdf",
        contentBytes: bytes.toString("base64"),
      },
    ]);
  });

  it("rejects unsafe attachment MIME types and oversized attachments before provider calls", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const base = ["gmail", "access-token", "recruiter@example.com", "Application", "Body", fetcher] as const;
    await expect(
      sendFollowUpProviderMessage(...base, [
        {
          fileName: "resume.pdf",
          mimeType: "application/pdf\r\nBcc: attacker@example.com",
          data: Buffer.from("bytes"),
        },
      ])
    ).rejects.toThrow(/supported resume document type/i);
    await expect(
      sendFollowUpProviderMessage(...base, [
        {
          fileName: "resume.pdf",
          mimeType: "application/pdf",
          data: new Uint8Array(Math.floor(2.5 * 1024 * 1024) + 1),
        },
      ])
    ).rejects.toThrow(/2.5 MiB/i);
    await expect(sendFollowUpProviderMessage("gmail", "access-token", "bad\r\nBcc: x@y.com", "Application", "Body", fetcher)).rejects.toThrow(/valid recipient/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses Outlook's documented send-mail acknowledgement without inventing a message ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));

    const result = await sendFollowUpProviderMessage("outlook", "access-token", "recruiter@example.com", "Follow-up", "Hello from Hire.AI", fetcher);

    expect(result).toMatchObject({
      messageId: null,
      confirmation: expect.stringContaining("Outlook accepted"),
    });
    expect(fetcher.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      })
    );
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as {
      message: { toRecipients: Array<{ emailAddress: { address: string } }> };
    };
    expect(body.message.toRecipients[0].emailAddress.address).toBe("recruiter@example.com");
  });

  it("does not treat a provider rejection as delivery evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 403,
        headers: { "www-authenticate": 'Bearer error="insufficient_scope"' },
      })
    );

    await expect(sendFollowUpProviderMessage("gmail", "access-token", "recruiter@example.com", "Follow-up", "Hello", fetcher)).rejects.toMatchObject({
      message: "Gmail rejected the follow-up delivery (403).",
      authorizationRejected: false,
    });
  });

  it("marks only an authoritative invalid-token provider rejection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 403,
        headers: { "www-authenticate": 'Bearer error="invalid_token"' },
      })
    );

    await expect(sendFollowUpProviderMessage("gmail", "access-token", "recruiter@example.com", "Follow-up", "Hello", fetcher)).rejects.toMatchObject({
      authorizationRejected: true,
    });
  });

  it("rejects oversized Gmail acknowledgements without treating them as delivery evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(1024 * 1024 + 1) },
      })
    );

    await expect(sendFollowUpProviderMessage("gmail", "access-token", "recruiter@example.com", "Follow-up", "Hello", fetcher)).rejects.toThrow(/1048576-byte limit/i);
  });

  it("fails closed before touching a provider when durable delivery state is unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      sendApprovedFollowUp(
        {
          followUpId: 1,
          userId: 1,
          provider: "gmail",
          recipient: "recruiter@example.com",
        },
        { fetcher }
      )
    ).rejects.toThrow(/durable database storage/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
