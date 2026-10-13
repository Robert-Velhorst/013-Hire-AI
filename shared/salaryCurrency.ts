export const DEFAULT_SALARY_CURRENCY = "USD";

export function normalizeSalaryCurrency(value?: string | null, fallback?: string | null): string | null {
  const currency = value?.trim().toUpperCase();
  if (currency && isKnownSalaryCurrency(currency)) return currency;
  const fallbackCurrency = fallback?.trim().toUpperCase();
  return fallbackCurrency && isKnownSalaryCurrency(fallbackCurrency) ? fallbackCurrency : null;
}

export function isKnownSalaryCurrency(value: string): boolean {
  if (!/^[A-Z]{3}$/.test(value) || value === "XXX") return false;
  try {
    const displayName = new Intl.DisplayNames(["en"], { type: "currency" }).of(value);
    return Boolean(displayName && displayName.toUpperCase() !== value);
  } catch {
    return false;
  }
}

export function areSalaryCurrenciesComparable(
  jobCurrency?: string | null,
  profileCurrency?: string | null
) {
  const normalizedJobCurrency = normalizeSalaryCurrency(jobCurrency);
  const normalizedProfileCurrency = normalizeSalaryCurrency(profileCurrency);
  return Boolean(normalizedJobCurrency && normalizedProfileCurrency && normalizedJobCurrency === normalizedProfileCurrency);
}
