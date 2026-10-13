import { randomBytes } from "node:crypto";

export function createRuntimeInstanceId(): string {
  const launchId = process.env.HIRE_AI_RUNTIME_INSTANCE_ID;
  if (launchId !== undefined) {
    if (launchId.length < 32 || launchId.length > 128 || /[^A-Za-z0-9_-]/.test(launchId)) {
      throw new Error("Invalid runtime launch identity.");
    }
    return launchId;
  }
  return randomBytes(24).toString("base64url");
}
