import type { SupportedLocale } from "@shared/localization";

const MAX_CACHED_FORMATTERS = 32;
const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(locale: SupportedLocale, currency: string) {
  const key = `${locale}:${currency}`;
  const cached = currencyFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  });
  if (currencyFormatters.size >= MAX_CACHED_FORMATTERS) {
    const oldestKey = currencyFormatters.keys().next().value;
    if (oldestKey) currencyFormatters.delete(oldestKey);
  }
  currencyFormatters.set(key, formatter);
  return formatter;
}

export function formatBillingCurrency(
  cents: number,
  currency: string,
  locale: SupportedLocale,
) {
  const normalizedCurrency = currency.trim().toUpperCase();
  try {
    return getCurrencyFormatter(locale, normalizedCurrency).format(cents / 100);
  } catch {
    return `${normalizedCurrency} ${(cents / 100).toFixed(2)}`;
  }
}
