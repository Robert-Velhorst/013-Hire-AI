import type { SupportedLocale } from "@shared/localization";
import { formatCalendarDate } from "./calendarDate";

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

export function formatBillingSalary(
  amount: number,
  currency: string,
  locale: SupportedLocale,
) {
  const normalizedCurrency = currency.trim().toUpperCase();
  try {
    return getCurrencyFormatter(locale, normalizedCurrency).format(amount);
  } catch {
    return `${normalizedCurrency} ${amount.toFixed(2)}`;
  }
}

export function getLocalCalendarDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatBillingDate(
  value: string | number | Date,
  locale: SupportedLocale,
) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale);
}

export function formatBillingCalendarDate(
  value: string | number | Date | null | undefined,
  locale: SupportedLocale,
) {
  return formatCalendarDate(value, locale);
}
