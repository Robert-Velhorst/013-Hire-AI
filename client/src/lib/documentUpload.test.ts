import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_DOCUMENT_UPLOAD_BASE64_LENGTH,
  extractBase64Payload,
  getVerificationUploadMimeType,
  isCanonicalBase64Payload,
  validateVerificationUpload,
  VERIFICATION_UPLOAD_ACCEPT,
} from "@shared/documentUploads";

describe("document upload contract", () => {
  it("accepts every format exposed by the file picker", () => {
    expect(VERIFICATION_UPLOAD_ACCEPT).toBe(
      ".pdf,.doc,.docx,.txt,.rtf,.jpg,.jpeg,.png"
    );
    expect(
      validateVerificationUpload({
        name: "proof.pdf",
        size: 1,
        type: "application/pdf",
      })
    ).toBeNull();
    expect(
      validateVerificationUpload({
        name: "proof.doc",
        size: 1,
        type: "application/msword",
      })
    ).toBeNull();
    expect(
      validateVerificationUpload({
        name: "proof.png",
        size: 1,
        type: "image/png",
      })
    ).toBeNull();
    expect(
      getVerificationUploadMimeType({ name: "proof.docx", type: "" })
    ).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("rejects empty, oversized, and unsupported files before encoding", () => {
    expect(
      validateVerificationUpload({
        name: "proof.pdf",
        size: 0,
        type: "application/pdf",
      })
    ).toContain("empty");
    expect(
      validateVerificationUpload({
        name: "proof.pdf",
        size: MAX_DOCUMENT_UPLOAD_BYTES + 1,
        type: "application/pdf",
      })
    ).toContain("10MB");
    expect(
      validateVerificationUpload({
        name: "proof.webp",
        size: 1,
        type: "image/webp",
      })
    ).toContain("Choose");
  });

  it("extracts only non-empty base64 data URL payloads", () => {
    expect(extractBase64Payload("data:application/pdf;base64,cHJvb2Y=")).toBe(
      "cHJvb2Y="
    );
    expect(extractBase64Payload("data:application/pdf,cHJvb2Y=")).toBe("");
    expect(extractBase64Payload("data:application/pdf;base64,")).toBe("");
  });

  it("accepts canonical base64 only within the exact encoded file budget", () => {
    expect(isCanonicalBase64Payload("cHJvb2Y=")).toBe(true);
    expect(isCanonicalBase64Payload("cHJvb2Y")).toBe(false);
    expect(isCanonicalBase64Payload("cHJv!2Y=")).toBe(false);
    expect(isCanonicalBase64Payload("Zm8=")).toBe(true);
    expect(isCanonicalBase64Payload("Zh==")).toBe(false);
    expect(MAX_DOCUMENT_UPLOAD_BASE64_LENGTH).toBe(
      4 * Math.ceil(MAX_DOCUMENT_UPLOAD_BYTES / 3)
    );
  });
});
