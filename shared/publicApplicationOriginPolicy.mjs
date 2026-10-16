import { requireTrustedServiceBaseUrl } from "./trustedServiceOriginPolicy.mjs";

function normalizePublicOrigin(value) {
  const url = requireTrustedServiceBaseUrl(value);
  if (url.pathname !== "/") {
    throw new Error("Public application URL must be an origin without a path.");
  }
  return url.origin;
}

export function resolvePublicApplicationOrigin({
  configuredUrl,
  requestProtocol,
  requestHost,
  isProduction,
}) {
  if (configuredUrl?.trim()) {
    const origin = normalizePublicOrigin(configuredUrl.trim());
    if (isProduction && !origin.startsWith("https://")) {
      throw new Error("Production public application URL must use HTTPS.");
    }
    return origin;
  }

  if (isProduction) {
    throw new Error("HIRE_AI_PUBLIC_BASE_URL is required in production.");
  }
  if (!requestProtocol || !requestHost) {
    throw new Error("The local application origin is unavailable.");
  }
  return normalizePublicOrigin(`${requestProtocol}://${requestHost}`);
}
