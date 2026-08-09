import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  limit: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: mocks.getDb,
}));

import {
  createJobAlert,
  deleteJobAlert,
  getJobAlerts,
  processJobAlerts,
  toggleJobAlert,
  updateJobAlert,
} from "./applicationFeatures";

describe("job alert processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a matching alert refresh without sending an external notification", async () => {
    const alert = {
      id: 412,
      userId: 82,
      name: "Remote TypeScript roles",
      keywords: "TypeScript, React",
      locations: "Remote",
      platforms: "Remote OK",
      minSalary: 100000,
      jobTypes: "full-time",
      frequency: "daily",
      lastTriggered: null,
    };
    mocks.select
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([alert]) }) })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([{
          id: 1,
          title: "TypeScript Engineer",
          description: "Build React applications",
          location: "Remote worldwide",
          platformId: 7,
          salaryMax: 150000,
          jobType: "full-time",
          isActive: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]) }) }) }),
      })
      .mockReturnValueOnce({ from: () => Promise.resolve([{ id: 7, name: "Remote OK" }]) });
    mocks.update.mockReturnValue({ set: () => ({ where: mocks.where.mockResolvedValue(undefined) }) });
    mocks.getDb.mockResolvedValue({ select: mocks.select, update: mocks.update });

    await expect(processJobAlerts()).resolves.toEqual({ processed: 1, externalNotifications: 0 });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.where).toHaveBeenCalledTimes(1);
  });

  it("does not mark an alert as refreshed when active jobs miss its criteria", async () => {
    const alert = {
      id: 413,
      userId: 82,
      name: "Senior Go roles",
      keywords: "Go",
      locations: "Europe",
      platforms: "We Work Remotely",
      minSalary: 120000,
      jobTypes: "contract",
      frequency: "daily",
      lastTriggered: null,
    };
    mocks.select
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([alert]) }) })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([{
          id: 2,
          title: "Go Engineer",
          location: "Remote, Europe",
          platformId: 3,
          salaryMax: 160000,
          jobType: "full-time",
          isActive: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]) }) }) }),
      })
      .mockReturnValueOnce({ from: () => Promise.resolve([{ id: 3, name: "We Work Remotely" }]) });
    mocks.getDb.mockResolvedValue({ select: mocks.select, update: mocks.update });

    await expect(processJobAlerts()).resolves.toEqual({ processed: 0, externalNotifications: 0 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not load jobs or platforms when no alert is due", async () => {
    mocks.select.mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([]) }),
    });
    mocks.getDb.mockResolvedValue({ select: mocks.select, update: mocks.update });

    await expect(processJobAlerts()).resolves.toEqual({ processed: 0, externalNotifications: 0 });
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("pages current jobs until a due alert finds a match", async () => {
    const alert = {
      id: 414,
      userId: 82,
      name: "Late page role",
      keywords: "Rust",
      frequency: "daily",
      lastTriggered: null,
    };
    const firstPage = Array.from({ length: 250 }, (_, index) => ({
      id: index + 1,
      title: "TypeScript Engineer",
      isActive: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const page = (rows: unknown[]) => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }),
    });
    mocks.select
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([alert]) }) })
      .mockReturnValueOnce(page(firstPage))
      .mockReturnValueOnce({ from: () => Promise.resolve([]) })
      .mockReturnValueOnce(page([{
        id: 251,
        title: "Rust Engineer",
        isActive: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]));
    mocks.update.mockReturnValue({ set: () => ({ where: mocks.where.mockResolvedValue(undefined) }) });
    mocks.getDb.mockResolvedValue({ select: mocks.select, update: mocks.update });

    await expect(processJobAlerts()).resolves.toEqual({ processed: 1, externalNotifications: 0 });
    expect(mocks.select).toHaveBeenCalledTimes(4);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("keeps a user-scoped alert ledger available without a configured database", async () => {
    const userId = 91234;
    mocks.getDb.mockResolvedValue(null);

    const { id } = await createJobAlert({
      userId,
      name: "Current remote TypeScript roles",
      keywords: "TypeScript",
      locations: "Remote",
      frequency: "daily",
    });

    await updateJobAlert(userId, id, { name: "Current remote TypeScript and React roles", keywords: "TypeScript, React" });
    await toggleJobAlert(userId, id, false);
    expect(await getJobAlerts(userId)).toEqual([
      expect.objectContaining({
        id,
        name: "Current remote TypeScript and React roles",
        keywords: "TypeScript, React",
        isActive: 0,
      }),
    ]);

    await deleteJobAlert(userId, id);
    expect(await getJobAlerts(userId)).toEqual([]);
  });

  it("refreshes a local alert from current canonical sample jobs without external notification", async () => {
    const userId = 91235;
    mocks.getDb.mockResolvedValue(null);
    const { id } = await createJobAlert({
      userId,
      name: "Remote TypeScript",
      keywords: "TypeScript",
      locations: "Remote",
      frequency: "daily",
    });

    await expect(processJobAlerts()).resolves.toEqual({ processed: 1, externalNotifications: 0 });
    expect(await getJobAlerts(userId)).toEqual([
      expect.objectContaining({ id, lastTriggered: expect.any(Date) }),
    ]);
  });
});
