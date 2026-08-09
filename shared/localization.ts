export const SUPPORTED_LOCALES = ["en", "nl"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export function resolveSupportedLocale(value: unknown): SupportedLocale {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const normalized = value.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(normalized as SupportedLocale)
    ? (normalized as SupportedLocale)
    : DEFAULT_LOCALE;
}

export const localeLabels: Record<SupportedLocale, string> = {
  en: "English",
  nl: "Nederlands",
};
