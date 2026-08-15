import { describe, expect, it } from "vitest";
import { detectATSType as detectApplicationATS } from "./applicationAutomation";
import { detectATSType as detectBrowserATS } from "./browserAutomation";
import { detectATSType as detectCompatibilityATS } from "./atsAutomation";

const classifiers = [detectApplicationATS, detectBrowserATS, detectCompatibilityATS];

describe("shared ATS destination classification", () => {
  it.each([
    ["https://boards.greenhouse.io/company/jobs/1", "greenhouse"],
    ["https://jobs.lever.co/company/1", "lever"],
    ["https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1", "workday"],
    ["https://company.myworkday.com/careers/job/1", "workday"],
    ["https://company.taleo.net/careersection/jobdetail.ftl", "taleo"],
    ["https://careers.icims.com/jobs/1", "icims"],
    ["https://jobs.smartrecruiters.com/Company/1", "smartrecruiters"],
    ["https://company.bamboohr.com/careers/1", "bamboohr"],
    ["https://jobs.jobvite.com/company/job/1", "jobvite"],
  ])("classifies %s consistently", (url, expected) => {
    for (const classify of classifiers) expect(classify(url)).toBe(expected);
  });

  it.each([
    "https://example.com/jobs/greenhouse.io/1",
    "https://example.com/apply?provider=workday.com",
    "https://greenhouse.io.example.com/jobs/1",
    "not a URL containing jobs.lever.co",
    "javascript:greenhouse.io",
  ])("does not classify an untrusted substring destination: %s", (url) => {
    for (const classify of classifiers) expect(classify(url)).toBe("unknown");
  });
});
