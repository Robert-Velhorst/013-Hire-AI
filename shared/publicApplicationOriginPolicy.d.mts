export function resolvePublicApplicationOrigin(input: {
  configuredUrl?: string;
  requestProtocol?: string;
  requestHost?: string | null;
  isProduction: boolean;
}): string;
