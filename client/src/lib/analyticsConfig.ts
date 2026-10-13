export function resolveAnalyticsScriptUrl(
  endpoint: string | undefined,
  approvedOrigin: string | undefined
): string | undefined {
  if (!endpoint?.trim() || !approvedOrigin?.trim()) return undefined;

  try {
    const endpointUrl = new URL(endpoint.trim());
    const approvedUrl = new URL(approvedOrigin.trim());
    const isOriginOnly =
      approvedUrl.pathname === "/" && !approvedUrl.search && !approvedUrl.hash;

    if (
      endpointUrl.protocol !== "https:" ||
      approvedUrl.protocol !== "https:" ||
      endpointUrl.username ||
      endpointUrl.password ||
      approvedUrl.username ||
      approvedUrl.password ||
      !isOriginOnly ||
      endpointUrl.origin !== approvedUrl.origin
    ) {
      return undefined;
    }

    return new URL("/umami", approvedUrl.origin).toString();
  } catch {
    return undefined;
  }
}
