import { MAX_DOCUMENT_UPLOAD_BYTES } from "@shared/documentUploads";

export type DocumentUploadKind =
  "resume-parse" | "resume-history" | "hire-proof" | "verification";

export async function uploadDocument<T>(input: {
  file: File;
  kind: DocumentUploadKind;
  metadata: Record<string, unknown>;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}): Promise<T> {
  if (input.file.size <= 0 || input.file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    throw new Error("Choose a non-empty document of 10 MiB or less.");
  }

  let response: Response;
  try {
    response = await (
      input.fetchImplementation ?? globalThis.fetch.bind(globalThis)
    )(`/api/document-uploads/${input.kind}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/octet-stream",
        "x-hire-upload-metadata": JSON.stringify(input.metadata),
      },
      body: input.file,
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Document upload was cancelled.");
    }
    throw new Error(
      "The document could not be uploaded. Check your connection and retry."
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "The document upload failed.";
    throw new Error(message);
  }
  return payload as T;
}
