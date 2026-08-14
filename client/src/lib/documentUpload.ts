import { extractBase64Payload } from "@shared/documentUploads";

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.onabort = () => reject(new Error("Reading the selected file was cancelled."));
    reader.onload = () => {
      const payload = typeof reader.result === "string" ? extractBase64Payload(reader.result) : "";
      if (!payload) {
        reject(new Error("The selected file could not be encoded."));
        return;
      }
      resolve(payload);
    };
    reader.readAsDataURL(file);
  });
}
