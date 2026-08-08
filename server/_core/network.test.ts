import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  displayHost,
  resolveAvailablePort,
  resolveBindHost,
  resolvePreferredPort,
} from "./network";

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("server network configuration", () => {
  it("defaults to loopback and validates explicit bind addresses and ports", () => {
    expect(resolveBindHost(undefined)).toBe("127.0.0.1");
    expect(resolveBindHost("0.0.0.0")).toBe("0.0.0.0");
    expect(() => resolveBindHost("example.com")).toThrow("HOST");
    expect(resolvePreferredPort(undefined)).toBe(3000);
    expect(resolvePreferredPort("3040")).toBe(3040);
    expect(() => resolvePreferredPort("70000")).toThrow("PORT");
    expect(displayHost("::1")).toBe("[::1]");
  });

  it("fails on a busy production port and permits bounded development fallback", async () => {
    const server = net.createServer();
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind.");

    await expect(resolveAvailablePort(address.port, "127.0.0.1", false)).rejects.toThrow("already in use");
    await expect(resolveAvailablePort(address.port, "127.0.0.1", true)).resolves.toBeGreaterThan(address.port);
  });
});
