const REDIRECT_BASE = "https://hire-ai.invalid";

export function getSafeRedirectPath(value: unknown, fallback: string) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const target = new URL(value, REDIRECT_BASE);
    if (target.origin !== REDIRECT_BASE) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
