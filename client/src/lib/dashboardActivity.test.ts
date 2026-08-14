import { describe, expect, it } from "vitest";
import { formatDashboardActivityTarget } from "./dashboardActivity";

describe("formatDashboardActivityTarget", () => {
  it("uses the application job and employer instead of exposing an opaque identifier", () => {
    expect(formatDashboardActivityTarget({
      title: "Senior Full Stack Developer",
      company: "TechFlow Inc",
    })).toBe("Senior Full Stack Developer at TechFlow Inc");
  });

  it("keeps activity understandable when a job has been archived or only partially retained", () => {
    expect(formatDashboardActivityTarget({ title: "Backend Engineer" })).toBe("Backend Engineer");
    expect(formatDashboardActivityTarget({ company: "Remote Co" })).toBe("Remote Co");
    expect(formatDashboardActivityTarget()).toBe("Job details unavailable");
  });

  it("localizes the relationship and fallback for Dutch accounts", () => {
    expect(formatDashboardActivityTarget({ title: "Ontwikkelaar", company: "Acme" }, "nl-NL"))
      .toBe("Ontwikkelaar bij Acme");
    expect(formatDashboardActivityTarget(null, "nl-NL")).toBe("Vacaturegegevens niet beschikbaar");
  });
});
