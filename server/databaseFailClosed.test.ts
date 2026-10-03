import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAllJobPlatforms } from "./db";

const state = vi.hoisted(() => ({ production: true, url: "" }));
vi.mock("./_core/env", () => ({
  ENV: {
    get isProduction() {
      return state.production;
    },
    get databaseUrl() {
      return state.url;
    },
  },
}));
vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => {
    throw new Error("private connection details");
  }),
}));

beforeEach(() => {
  state.production = true;
  state.url = "";
});
afterEach(() => vi.restoreAllMocks());

describe("database failure boundaries", () => {
  it("does not return sample platforms in production without a database", async () => {
    await expect(getAllJobPlatforms()).rejects.toThrow(
      "Production database is not configured"
    );
  });
  it.each([true, false])(
    "does not substitute sample records after explicit database initialization fails (production=%s)",
    async production => {
      state.production = production;
      state.url = "mysql://configured-but-invalid";
      await expect(getAllJobPlatforms()).rejects.toThrow(
        "Database connection initialization failed"
      );
    }
  );
  it("keeps database-free development available", async () => {
    state.production = false;
    expect((await getAllJobPlatforms()).length).toBeGreaterThan(0);
  });
});
