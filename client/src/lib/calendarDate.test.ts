import { describe, expect, it } from "vitest";
import { calendarDateForInput, calendarYear, formatCalendarDate } from "./calendarDate";

describe("calendar date presentation", () => {
  it("preserves the stored day independently of the runtime timezone", () => {
    const dateOnly = "2026-01-02T00:00:00.000Z";
    expect(calendarDateForInput(dateOnly)).toBe("2026-01-02");
    expect(formatCalendarDate(dateOnly, "en-US")).toBe("1/2/2026");
    expect(formatCalendarDate(dateOnly, "nl-NL")).toBe("2-1-2026");
    expect(calendarYear(dateOnly)).toBe("2026");
  });

  it("does not turn missing or invalid dates into epoch dates", () => {
    expect(calendarDateForInput(null)).toBe("");
    expect(formatCalendarDate(undefined, "en-US")).toBe("");
    expect(calendarYear("not-a-date")).toBe("");
  });
});
