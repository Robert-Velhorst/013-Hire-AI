const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function requireOAuthServerUrl(
  value: string,
  allowedOrigins: string[],
  production: boolean
) {
  const url = requireTrustedServiceBaseUrl(value);
  const allowed = allowedOrigins.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("OAuth server allowlist contains an invalid origin.");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.href.includes("?") ||
      parsed.href.includes("#")
    ) {
      throw new Error("OAuth server allowlist entries must be canonical HTTPS origins.");
    }
    return parsed.origin;
  });

  if (production && url.protocol !== "https:") {
    throw new Error("OAuth server URL must use HTTPS in production.");
  }
  if (production && allowed.length === 0) {
    throw new Error("OAUTH_SERVER_ALLOWED_ORIGINS must be configured in production.");
  }
  if (allowed.length > 0 && !allowed.includes(url.origin)) {
    throw new Error("OAuth server URL origin is not in OAUTH_SERVER_ALLOWED_ORIGINS.");
  }
  return url;
}

export function requireMalwareScannerUrl(
  value: string,
  allowedOrigins: string[],
  production: boolean
) {
  const url = requireTrustedServiceBaseUrl(value);
  const allowed = allowedOrigins.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("Malware scanner allowlist contains an invalid origin.");
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const secureTransport = parsed.protocol === "https:";
    const loopbackDevelopment = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(hostname);
    if (
      (!secureTransport && !loopbackDevelopment) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.href.includes("?") ||
      parsed.href.includes("#")
    ) {
      throw new Error("Malware scanner allowlist entries must be HTTPS origins or loopback HTTP origins.");
    }
    return parsed.origin;
  });
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(hostname);

  if (production && url.protocol !== "https:" && !loopbackHttp) {
    throw new Error("Malware scanner URL must use HTTPS in production unless it is loopback.");
  }
  if (production && allowed.length === 0) {
    throw new Error("FILE_MALWARE_SCAN_ALLOWED_ORIGINS must be configured in production.");
  }
  if (allowed.length === 0 && !loopbackHttp) {
    throw new Error("FILE_MALWARE_SCAN_ALLOWED_ORIGINS must be configured for remote scanners.");
  }
  if (allowed.length > 0 && !allowed.includes(url.origin)) {
    throw new Error("Malware scanner URL origin is not in FILE_MALWARE_SCAN_ALLOWED_ORIGINS.");
  }
  return url;
}

export function requireTrustedServiceBaseUrl(value: string) {
  let url: URL;
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
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href.includes("?") ||
    url.href.includes("#")
  ) {
    throw new Error("Trusted service URL must not contain credentials, query parameters, or fragments.");
  }
  return url;
}

export function buildTrustedServiceUrl(baseUrl: string, relativePath: string) {
  const base = requireTrustedServiceBaseUrl(baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(relativePath.replace(/^\/+/, ""), base).toString();
}
