import net from "node:net";

const LOCAL_ENDPOINT_NAMES = new Set([
  "localhost",
  "host.docker.internal",
  "gateway",
  "app",
]);

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [first, second] = address.split(".").map(Number);
    return first === 10
      || first === 127
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }
  if (version === 6) {
    if (address.toLowerCase() === "::1") return true;
    const firstSegment = address.split(":", 1)[0].toLowerCase();
    return /^f[cd][0-9a-f]{2}$/.test(firstSegment);
  }
  return false;
}

function parseAllowedOrigins(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const origins = [];
  for (const entry of value.split(",")) {
    let url;
    try {
      url = new URL(entry.trim());
    } catch {
      return null;
    }
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) return null;
    origins.push(url.origin);
  }
  return [...new Set(origins)];
}

export function validateHaiConnectorUrl(value, allowedOriginsValue = "") {
  if (value !== value.trim()) {
    return "HAI_CONNECTOR_URL must not contain surrounding whitespace.";
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return "HAI_CONNECTOR_URL must be a valid local or allowlisted HTTPS URL.";
  }

  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    return "HAI_CONNECTOR_URL must not contain credentials, query data, or fragments.";
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowedName = LOCAL_ENDPOINT_NAMES.has(hostname);
  const localEndpoint = allowedName || isPrivateAddress(hostname);
  if (!localEndpoint && url.protocol !== "https:") {
    return "Public HAI connector endpoints must use HTTPS.";
  }
  if (!localEndpoint) {
    const allowedOrigins = parseAllowedOrigins(allowedOriginsValue);
    if (!allowedOrigins) {
      return "HAI_CONNECTOR_ALLOWED_ORIGINS must contain only HTTPS origins without paths or credentials.";
    }
    if (!allowedOrigins.includes(url.origin)) {
      return "Public HAI connector endpoint origin is not explicitly allowlisted.";
    }
  }
  if (url.pathname !== "/api/hai/a2a") {
    return "HAI_CONNECTOR_URL must use the exact /api/hai/a2a endpoint path.";
  }
  return null;
}

