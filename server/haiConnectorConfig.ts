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

function parseUserId(value: string | undefined) {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function defaultHaiConnectorConfig(): HaiConnectorConfig {
  return {
    enabled: readBoolean(process.env.HAI_CONNECTOR_ENABLED),
    token: process.env.HAI_CONNECTOR_TOKEN?.trim() ?? "",
    userId: parseUserId(process.env.HAI_CONNECTOR_USER_ID),
    endpointUrl: process.env.HAI_CONNECTOR_URL?.trim() ?? "",
  };
}

export function validateHaiConnectorUrl(value: string) {
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
  return null;
}

export function validateHaiConnectorConfig(config: HaiConnectorConfig) {
  if (!config.enabled) return null;
  if (config.token.length < 32 || /[\r\n]/.test(config.token)) {
    return "HAI_CONNECTOR_TOKEN must contain at least 32 non-newline characters.";
  }
  if (!config.userId) {
    return "HAI_CONNECTOR_USER_ID must be a positive integer.";
  }
  return validateHaiConnectorUrl(config.endpointUrl);
}
