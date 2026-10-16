import { describe, expect, it } from "vitest";
import { createInterviewCalendarFile } from "./interviewCalendar";

describe("createInterviewCalendarFile", () => {
  const timestamp = new Date("2026-10-20T09:30:00.000Z");

  it("builds a stable UTC calendar event and omits private preparation notes", () => {
    const event = {
      id: 42,
      company: "Example, Inc.",
      jobTitle: "Senior Engineer",
      interviewType: "video",
      scheduledAt: timestamp,
      duration: 45,
      meetingLink: "https://meet.example.test/room",
      interviewerName: "Alex",
      interviewerTitle: "Recruiter",
      notes: "Private salary negotiation strategy",
    };
    const result = createInterviewCalendarFile(
      event,
      new Date("2026-10-15T08:00:00.000Z")
    );

    expect(result.filename).toBe("hire-ai-interview-20261020.ics");
    expect(result.content).toContain("UID:hire-ai-interview-42@hire.ai\r\n");
    expect(result.content).toContain("DTSTART:20261020T093000Z\r\n");
    expect(result.content).toContain("DTEND:20261020T101500Z\r\n");
    expect(result.content).toContain(
      "SUMMARY:Interview - Example\\, Inc. - Senior Engineer\r\n"
    );
    expect(result.content).toContain("URL:https://meet.example.test/room\r\n");
    expect(result.content).toContain("Interviewer: Alex\\, Recruiter");
    expect(result.content).not.toContain("Private salary negotiation strategy");
    expect(result.content).toMatch(/END:VCALENDAR\r\n$/);
  });

  it("escapes injected line breaks and ignores non-http meeting URLs", () => {
    const result = createInterviewCalendarFile(
      {
        id: 7,
        interviewType: "video\r\nATTENDEE:mailto:attacker@example.test",
        scheduledAt: timestamp,
        location: "Room; 2, west\nORGANIZER:mailto:attacker@example.test",
        meetingLink: "javascript:alert(1)",
      },
      new Date("2026-10-15T08:00:00.000Z")
    );

    expect(result.content).toContain(
      "DESCRIPTION:Interview type: video\\nATTENDEE:mailto:attacker@example.test\r\n"
    );
    expect(result.content).toContain(
      "LOCATION:Room\\; 2\\, west\\nORGANIZER:mailto:attacker@example.test\r\n"
    );
    expect(result.content).not.toContain("\r\nATTENDEE:");
    expect(result.content).not.toContain("\r\nORGANIZER:");
    expect(result.content).not.toContain("URL:");
  });

  it("folds UTF-8 lines at the RFC 5545 octet limit", () => {
    const result = createInterviewCalendarFile(
      {
        id: 9,
        company: "Å".repeat(60),
        jobTitle: "Engineer",
        interviewType: "panel",
        scheduledAt: timestamp,
      },
      new Date("2026-10-15T08:00:00.000Z")
    );

    for (const line of result.content.split("\r\n").filter(Boolean)) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("rejects invalid event identifiers, times, and durations", () => {
    const event = { id: 1, interviewType: "video", scheduledAt: timestamp };
    expect(() => createInterviewCalendarFile({ ...event, id: 0 })).toThrow(
      /positive integer/
    );
    expect(() =>
      createInterviewCalendarFile({ ...event, scheduledAt: "invalid" })
    ).toThrow(/time is invalid/);
    expect(() =>
      createInterviewCalendarFile({ ...event, duration: 4 })
    ).toThrow(/between 5 and 480/);
  });
});
