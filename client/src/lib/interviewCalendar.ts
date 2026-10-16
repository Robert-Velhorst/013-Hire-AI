export type InterviewCalendarEvent = {
  id: number;
  company?: string | null;
  jobTitle?: string | null;
  interviewType: string;
  scheduledAt: string | Date;
  duration?: number | null;
  location?: string | null;
  meetingLink?: string | null;
  interviewerName?: string | null;
  interviewerTitle?: string | null;
};

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");
}

function formatUtcDate(value: Date) {
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function foldLine(line: string) {
  const encoder = new TextEncoder();
  const physicalLines: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (currentBytes + characterBytes > 75 && current.length > 0) {
      physicalLines.push(current);
      current = " ";
      currentBytes = 1;
    }
    current += character;
    currentBytes += characterBytes;
  }

  physicalLines.push(current);
  return physicalLines.join("\r\n");
}

function safeMeetingUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function createInterviewCalendarFile(
  event: InterviewCalendarEvent,
  now = new Date()
) {
  if (!Number.isSafeInteger(event.id) || event.id < 1) {
    throw new Error("Interview ID must be a positive integer.");
  }
  const start =
    event.scheduledAt instanceof Date
      ? event.scheduledAt
      : new Date(event.scheduledAt);
  if (!Number.isFinite(start.getTime()))
    throw new Error("Interview time is invalid.");
  if (!Number.isFinite(now.getTime()))
    throw new Error("Calendar timestamp is invalid.");

  const duration = event.duration ?? 60;
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
    throw new Error("Interview duration must be between 5 and 480 minutes.");
  }

  const company = event.company?.trim();
  const jobTitle = event.jobTitle?.trim();
  const interviewer = [event.interviewerName, event.interviewerTitle]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(", ");
  const description = [
    `Interview type: ${event.interviewType.trim() || "interview"}`,
    interviewer ? `Interviewer: ${interviewer}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const meetingUrl = safeMeetingUrl(event.meetingLink);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hire.AI//Interview Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:hire-ai-interview-${event.id}@hire.ai`,
    `DTSTAMP:${formatUtcDate(now)}`,
    `DTSTART:${formatUtcDate(start)}`,
    `DTEND:${formatUtcDate(new Date(start.getTime() + duration * 60_000))}`,
    `SUMMARY:${escapeText(["Interview", company, jobTitle].filter(Boolean).join(" - "))}`,
    `DESCRIPTION:${escapeText(description)}`,
    ...(event.location?.trim()
      ? [`LOCATION:${escapeText(event.location.trim())}`]
      : []),
    ...(meetingUrl ? [`URL:${meetingUrl}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return {
    filename: `hire-ai-interview-${formatUtcDate(start).slice(0, 8)}.ics`,
    content: `${lines.map(foldLine).join("\r\n")}\r\n`,
  };
}
