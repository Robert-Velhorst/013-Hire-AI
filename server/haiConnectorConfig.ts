import net from "node:net";

export type HaiConnectorConfig = {
  enabled: boolean;
  token: string;
  userId: number | null;
  endpointUrl: string;
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
  };
}

export function validateHaiConnectorUrl(value: string) {
  if (value !== value.trim()) {
    return "HAI_CONNECTOR_URL must not contain surrounding whitespace.";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "HAI_CONNECTOR_URL must be a valid local HTTP(S) URL.";
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return "HAI_CONNECTOR_URL must be a plain local HTTP(S) URL without credentials, query data, or fragments.";
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const parsedIp = net.isIP(hostname) ? hostname : null;
  const allowedName = ["localhost", "host.docker.internal", "gateway"].includes(hostname);
  const isPrivateIp = parsedIp
    ? /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(parsedIp)
    : false;
  if (!allowedName && !isPrivateIp) {
    return "HAI_CONNECTOR_URL must use localhost, a private-network address, host.docker.internal, or gateway.";
  }
  if (url.pathname !== "/api/hai/a2a") {
    return "HAI_CONNECTOR_URL must use the exact /api/hai/a2a endpoint path.";
  }
  return null;
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
  return validateHaiConnectorUrl(config.endpointUrl);
}
