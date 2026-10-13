export function isAuthoritativeInvalidConnectorToken(
  response: Pick<Response, "status" | "headers">
) {
  if (response.status === 401) return true;
  if (response.status !== 403) return false;
  return /(?:^|,)\s*(?:Bearer\s+)?error\s*=\s*"?invalid_token"?\s*(?:,|$)/i.test(
    response.headers.get("www-authenticate") ?? ""
  );
}
