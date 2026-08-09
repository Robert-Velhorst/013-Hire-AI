const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Trusted service URL must not contain credentials, query parameters, or fragments.");
  }
  return url;
}

export function buildTrustedServiceUrl(baseUrl: string, relativePath: string) {
  const base = requireTrustedServiceBaseUrl(baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(relativePath.replace(/^\/+/, ""), base).toString();
}
