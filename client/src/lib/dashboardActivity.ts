export interface DashboardActivityJob {
  title?: string | null;
  company?: string | null;
}

export function formatDashboardActivityTarget(
  job?: DashboardActivityJob | null,
  locale = "en",
): string {
  const title = job?.title?.trim() || "";
  const company = job?.company?.trim() || "";
  const isDutch = locale.toLowerCase().startsWith("nl");

  if (title && company) return `${title} ${isDutch ? "bij" : "at"} ${company}`;
  return title || company || (isDutch ? "Vacaturegegevens niet beschikbaar" : "Job details unavailable");
}
