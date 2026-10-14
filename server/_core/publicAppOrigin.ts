const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function normalizePublicAppOrigin(value: string, production: boolean) {
  if (!value || value !== value.trim() || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const secure = url.protocol === "https:";
    const localDevelopment = !production
      && url.protocol === "http:"
      && LOOPBACK_HOSTS.has(hostname);
    if (
      (!secure && !localDevelopment)
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveOAuthCallbackUri(input: {
  publicAppOrigin: string;
  isProduction: boolean;
  requestProtocol: string;
  requestHost: string | undefined;
}) {
  if (input.publicAppOrigin) {
    const configuredOrigin = normalizePublicAppOrigin(
      input.publicAppOrigin,
      input.isProduction
    );
    if (!configuredOrigin) throw new Error("PUBLIC_APP_ORIGIN is invalid.");
    return `${configuredOrigin}/api/oauth/callback`;
  }
  if (input.isProduction) {
    throw new Error("PUBLIC_APP_ORIGIN is required in production.");
  }
  if (!input.requestHost) throw new Error("OAuth callback origin is invalid.");

  const requestOrigin = normalizePublicAppOrigin(
    `${input.requestProtocol}://${input.requestHost}`,
    false
  );
  if (!requestOrigin) throw new Error("OAuth callback origin is invalid.");
  return `${requestOrigin}/api/oauth/callback`;
}
