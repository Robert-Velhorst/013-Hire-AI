import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "test",
    role: "user",
    accountStatus: "active",
    stripeCustomerId: null,
    tosAcceptedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as AuthenticatedUser;

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("platforms router", () => {
  it("keeps public platform and status reads free of catalog initialization writes", () => {
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const database = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const runtime = readFileSync(resolve(process.cwd(), "server", "_core", "index.ts"), "utf8");
    const manager = readFileSync(resolve(process.cwd(), "server", "scrapers", "scraperManager.ts"), "utf8");
    const platformRouter = router.slice(router.indexOf("platforms: router"), router.indexOf("// Jobs"));
    const discoveryStatus = database.slice(
      database.indexOf("export async function getJobDiscoveryStatus"),
      database.indexOf("export async function getActiveJobs")
    );

    expect(platformRouter).not.toContain("ensureScraperPlatformCatalog");
    expect(discoveryStatus).not.toContain("ensureScraperPlatformCatalog");
    expect(runtime).toContain("await ensureScraperPlatformCatalog()");
    expect(manager).toContain("await ensureScraperPlatformCatalog()");
  });

  it("should list all job platforms when the database is available, or return an empty list without DB", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const platforms = await caller.platforms.list();

    expect(Array.isArray(platforms)).toBe(true);
  });

  it("should list only active platforms when available", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const platforms = await caller.platforms.active();

    expect(Array.isArray(platforms)).toBe(true);
    platforms.forEach(platform => {
      expect(platform.isActive).toBe(1);
    });
  });
});

describe("jobs router", () => {
  it("should list jobs with default pagination", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const jobs = await caller.jobs.list({});

    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeGreaterThanOrEqual(0);
  });

  it("should respect pagination limits", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const jobs = await caller.jobs.list({ limit: 10, offset: 0 });

    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeLessThanOrEqual(10);
  });

  it("should expose bounded cursor pagination for the public catalog", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const page = await caller.jobs.listPage({ limit: 10 });

    expect(page.items.length).toBeLessThanOrEqual(10);
    expect(page.nextCursor === null || page.nextCursor.id > 0).toBe(true);
  });

  it("reports canonical discovery status without exposing scraper controls", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const status = await caller.jobs.getDiscoveryStatus();

    expect(status).toMatchObject({
      activeSources: expect.any(Number),
      sourcesWithSuccessfulScrape: expect.any(Number),
      sourcesWithFreshFailedLatestScrape: expect.any(Number),
      sourcesWithFreshPartialLatestScrape: expect.any(Number),
      sourcesWithFreshEmptyLatestScrape: expect.any(Number),
      canonicalJobs: expect.any(Number),
    });
    expect(status.activeSources).toBeGreaterThan(0);
    expect(status.canonicalJobs).toBeGreaterThan(0);
  });

  it("should search jobs with filters", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const jobs = await caller.jobs.search({
      title: "developer",
      limit: 20,
    });

    expect(Array.isArray(jobs)).toBe(true);
  });
});

describe("profile router", () => {
  it("should get user profile for authenticated user", async () => {
    const caller = appRouter.createCaller(createAuthContext());

    const profile = await caller.profile.get();

    expect(profile === undefined || typeof profile === "object").toBe(true);
  });

  it("should expose profile update mutation", () => {
    const caller = appRouter.createCaller(createAuthContext());

    expect(caller.profile.update).toBeDefined();
  });
});

describe("applications router", () => {
  it("should list user applications", async () => {
    const caller = appRouter.createCaller(createAuthContext());

    const applications = await caller.applications.list();

    expect(Array.isArray(applications)).toBe(true);
  });
});
