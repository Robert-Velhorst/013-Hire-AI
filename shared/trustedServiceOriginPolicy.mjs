const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function requireTrustedServiceBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Trusted service URL is invalid.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const secureTransport = url.protocol === "https:";
  const loopbackDevelopment = url.protocol === "http:" && LOOPBACK_HOSTS.has(hostname);
  if (!secureTransport && !loopbackDevelopment) {
    throw new Error("Trusted service URL must use HTTPS or loopback HTTP.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Trusted service URL must not contain credentials, query parameters, or fragments.");
  }
  return url;
}

export function parseTrustedServiceOrigins(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const origins = [];
  for (const entry of value.split(",")) {
    const url = requireTrustedServiceBaseUrl(entry.trim());
    if (url.pathname !== "/") {
      throw new Error("Trusted service allowlist entries must be origins without paths.");
    }
    origins.push(url.origin);
  }
  return [...new Set(origins)];
}

export function requireAllowedServiceBaseUrl(value, allowedOrigins) {
  const url = requireTrustedServiceBaseUrl(value);
  const allowed = parseTrustedServiceOrigins(allowedOrigins);
  if (!allowed.includes(url.origin)) {
    throw new Error("Trusted service URL origin is not in its explicit allowlist.");
  }
  return url;
}
