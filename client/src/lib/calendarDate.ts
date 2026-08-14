function asValidDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function calendarDateForInput(value: string | number | Date | null | undefined): string {
  const date = asValidDate(value);
  if (!date) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatCalendarDate(
  value: string | number | Date | null | undefined,
  locale?: string,
): string {
  const date = asValidDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).format(date);
}

export function calendarYear(value: string | number | Date | null | undefined): string {
  const date = asValidDate(value);
  return date ? String(date.getUTCFullYear()) : "";
}
