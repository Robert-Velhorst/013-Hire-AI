import {
  requireAllowedServiceBaseUrl,
  requireTrustedServiceBaseUrl,
} from "@shared/trustedServiceOriginPolicy.mjs";

export { requireAllowedServiceBaseUrl, requireTrustedServiceBaseUrl };

export function buildTrustedServiceUrl(baseUrl: string, relativePath: string) {
  const base = requireTrustedServiceBaseUrl(baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(relativePath.replace(/^\/+/, ""), base).toString();
}
