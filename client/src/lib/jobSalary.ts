import { normalizeSalaryCurrency } from "@shared/salaryCurrency";

function formatSalaryAmount(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "code",
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatJobSalary(
  min?: number | null,
  max?: number | null,
  salaryCurrency?: string | null,
  locale = "en-US",
) {
  const isDutch = locale.toLowerCase().startsWith("nl");
  if (!min && !max) return isDutch ? "Niet opgegeven" : "Not specified";

  const currency = normalizeSalaryCurrency(salaryCurrency);
  const formatAmount = (amount: number) => currency
    ? formatSalaryAmount(amount, currency, locale)
    : new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 0 }).format(amount);
  const currencyNote = currency ? "" : ` (${isDutch ? "valuta niet vermeld" : "currency not specified"})`;
  if (min && max) return `${formatAmount(min)} - ${formatAmount(max)}${currencyNote}`;
  if (min) return `${formatAmount(min)}+${currencyNote}`;
  return `${isDutch ? "Tot" : "Up to"} ${formatAmount(max!)}${currencyNote}`;
}
