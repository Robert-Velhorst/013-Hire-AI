export const MAX_DOCUMENT_UPLOAD_BYTES = 10 * 1024 * 1024;

export const VERIFICATION_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/rtf",
  "application/rtf",
  "image/jpeg",
  "image/png",
] as const;

export const VERIFICATION_UPLOAD_ACCEPT = ".pdf,.doc,.docx,.txt,.rtf,.jpg,.jpeg,.png";

const VERIFICATION_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  rtf: "application/rtf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function getVerificationUploadMimeType(file: { name: string; type: string }): string | null {
  if ((VERIFICATION_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? VERIFICATION_MIME_TYPE_BY_EXTENSION[extension] ?? null : null;
}

export function validateVerificationUpload(file: { name: string; size: number; type: string }): string | null {
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) return "File must be 10MB or smaller.";
  if (!getVerificationUploadMimeType(file)) {
    return "Choose a PDF, Word, text, RTF, JPG, or PNG file.";
  }
  return null;
}

export function extractBase64Payload(dataUrl: string): string {
  const separator = dataUrl.indexOf(",");
  if (separator < 0 || !dataUrl.slice(0, separator).endsWith(";base64")) return "";
  return dataUrl.slice(separator + 1);
}
