import net from "node:net";

const allowedBindHosts = new Set(["127.0.0.1", "0.0.0.0", "::1", "::"]);

export function resolveBindHost(value: string | undefined) {
  const host = value?.trim() || "127.0.0.1";
  if (!allowedBindHosts.has(host)) {
    throw new Error("HOST must be 127.0.0.1, 0.0.0.0, ::1, or ::.");
  }
  return host;
}

export function resolvePreferredPort(value: string | undefined) {
  const port = Number.parseInt(value?.trim() || "3000", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

export function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

export async function resolveAvailablePort(
  preferredPort: number,
  host: string,
  allowFallback: boolean
) {
  if (await isPortAvailable(preferredPort, host)) return preferredPort;
  if (!allowFallback) {
    throw new Error(`Port ${preferredPort} is already in use on ${host}.`);
  }
  for (let port = preferredPort + 1; port < preferredPort + 20 && port <= 65535; port++) {
    if (await isPortAvailable(port, host)) return port;
  }
  throw new Error(`No available port found from ${preferredPort} through ${Math.min(preferredPort + 19, 65535)} on ${host}.`);
}

export function displayHost(host: string) {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}
