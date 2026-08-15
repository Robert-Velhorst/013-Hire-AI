import { randomBytes } from "node:crypto";

export function createRuntimeInstanceId(): string {
  return randomBytes(24).toString("base64url");
}
