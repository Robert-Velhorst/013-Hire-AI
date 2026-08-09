import { describe, expect, it } from "vitest";
import { getScraperAdapterMetadata, getSupportedPlatforms } from "./index";
import {
  getMissingReferencedRemoteJobPlatforms,
  getMissingScraperPlatformCatalog,
  getPlatformDiscoveryPolicy,
  getPlatformMinimumPollIntervalMs,
  isAutomatedDiscoveryPlatform,
  referencedRemoteJobPlatforms,
  scraperPlatformCatalog,
} from "./platformCatalog";
import { samplePlatforms } from "../sampleData";

describe("scraper platform catalog", () => {
  it("covers every registered scraper and every referenced remote-job source", () => {
    const catalogNames = scraperPlatformCatalog.map((platform) => platform.name);

    expect(catalogNames).toHaveLength(61);
    expect(new Set(catalogNames).size).toBe(catalogNames.length);
    expect(getSupportedPlatforms().every((name) => catalogNames.includes(name))).toBe(true);
    expect(getMissingReferencedRemoteJobPlatforms()).toEqual([]);
    expect(referencedRemoteJobPlatforms).toHaveLength(31);
    expect(scraperPlatformCatalog.every((platform) => platform.url.startsWith("https://"))).toBe(true);
  });

  it("keeps the database-free source configuration aligned with registered adapters", () => {
    expect(new Set(samplePlatforms.map((platform) => platform.name)))
      .toEqual(new Set(scraperPlatformCatalog.map((platform) => platform.name)));
    expect(new Set(samplePlatforms.map((platform) => platform.id)).size)
      .toBe(samplePlatforms.length);
  });

  it("returns only adapter sources that have not been configured yet", () => {
    const configured = ["RemoteOK", "FlexJobs", "Not a registered source"];
    const missing = getMissingScraperPlatformCatalog(configured);

    expect(missing.some((platform) => platform.name === "RemoteOK")).toBe(false);
    expect(missing.some((platform) => platform.name === "FlexJobs")).toBe(false);
    expect(missing).toHaveLength(scraperPlatformCatalog.length - 2);
  });

  it("reports dedicated and generic parser provenance for every registered source", () => {
    const adapters = getSupportedPlatforms().map((name) => ({ name, adapter: getScraperAdapterMetadata(name) }));

    expect(adapters.filter(({ adapter }) => adapter.kind === "dedicated")).toHaveLength(11);
    expect(adapters.filter(({ adapter }) => adapter.kind === "generic_rss").map(({ name }) => name))
      .toEqual(["NoDesk", "ProBlogger"]);
    expect(adapters.filter(({ adapter }) => adapter.kind === "generic_html")).toHaveLength(36);
    expect(adapters.every(({ adapter }) => adapter.label.endsWith("adapter"))).toBe(true);
    expect(adapters.filter(({ adapter }) => adapter.kind !== "dedicated")
      .every(({ adapter }) => adapter.detail.includes("coverage"))).toBe(true);
  });

  it("only permits unattended discovery for explicit public API or RSS adapters", () => {
    expect(isAutomatedDiscoveryPlatform("RemoteOK")).toBe(true);
    expect(isAutomatedDiscoveryPlatform("Remotive")).toBe(true);
    expect(isAutomatedDiscoveryPlatform("We Work Remotely")).toBe(true);
    expect(isAutomatedDiscoveryPlatform("Jobicy")).toBe(true);
    expect(getPlatformMinimumPollIntervalMs("Jobicy")).toBe(60 * 60 * 1000);
    expect(isAutomatedDiscoveryPlatform("LinkedIn Jobs")).toBe(false);
    expect(isAutomatedDiscoveryPlatform("Upwork")).toBe(false);
    expect(getPlatformDiscoveryPolicy("Stack Overflow Jobs")).toMatchObject({ mode: "unavailable" });
    expect(getPlatformDiscoveryPolicy("Wellfound").aliases).toContain("AngelList");
  });
});
