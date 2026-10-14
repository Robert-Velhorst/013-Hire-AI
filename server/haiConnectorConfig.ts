import { validateHaiConnectorUrl } from "../shared/haiConnectorEndpointPolicy.mjs";
export { validateHaiConnectorUrl } from "../shared/haiConnectorEndpointPolicy.mjs";

export type HaiConnectorConfig = {
  enabled: boolean;
  token: string;
  userId: number | null;
  endpointUrl: string;
  allowedOrigins?: string;
};

function readBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function parseHaiConnectorUserId(value: string | undefined) {
  const raw = value ?? "";
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function defaultHaiConnectorConfig(): HaiConnectorConfig {
  return {
    enabled: readBoolean(process.env.HAI_CONNECTOR_ENABLED),
    token: process.env.HAI_CONNECTOR_TOKEN ?? "",
    userId: parseHaiConnectorUserId(process.env.HAI_CONNECTOR_USER_ID),
    endpointUrl: process.env.HAI_CONNECTOR_URL ?? "",
    allowedOrigins: process.env.HAI_CONNECTOR_ALLOWED_ORIGINS ?? "",
  };
}

const HAI_TOKEN_PLACEHOLDERS = new Set([
  "replace-with-at-least-32-random-characters",
]);

export function validateHaiConnectorConfig(config: HaiConnectorConfig) {
  if (!config.enabled) return null;
  if (config.token.length < 32 || config.token.length > 4_096) {
    return "HAI_CONNECTOR_TOKEN must contain 32-4096 characters.";
  }
  if (/\s|[\u0000-\u001f\u007f]/.test(config.token)) {
    return "HAI_CONNECTOR_TOKEN must not contain whitespace or control characters.";
  }
  if (HAI_TOKEN_PLACEHOLDERS.has(config.token)) {
    return "HAI_CONNECTOR_TOKEN must not use a known placeholder.";
  }
  if (!Number.isSafeInteger(config.userId) || (config.userId ?? 0) <= 0) {
    return "HAI_CONNECTOR_USER_ID must be a positive integer.";
  }
  return validateHaiConnectorUrl(config.endpointUrl, config.allowedOrigins);
}

