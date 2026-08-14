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
  if (min && max) return `${formatSalaryAmount(min, currency, locale)} - ${formatSalaryAmount(max, currency, locale)}`;
  if (min) return `${formatSalaryAmount(min, currency, locale)}+`;
  return `${isDutch ? "Tot" : "Up to"} ${formatSalaryAmount(max!, currency, locale)}`;
}
