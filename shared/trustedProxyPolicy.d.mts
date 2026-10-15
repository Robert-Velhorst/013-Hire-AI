export const DEFAULT_TRUSTED_PROXY_IPS: readonly string[];

export function resolveTrustedProxyPolicy(
  value: string | undefined,
  isProduction?: boolean
): { addresses: string[]; issue: string | null };

export function isTrustedProxyAddress(
  address: string,
  trustedProxyIps: readonly string[]
): boolean;
