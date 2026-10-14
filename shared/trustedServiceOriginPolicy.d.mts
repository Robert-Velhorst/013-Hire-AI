export function requireTrustedServiceBaseUrl(value: string): URL;
export function parseTrustedServiceOrigins(value: string | undefined): string[];
export function requireAllowedServiceBaseUrl(value: string, allowedOrigins: string | undefined): URL;
