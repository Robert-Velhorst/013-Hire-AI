import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL;
const serverHost = "127.0.0.1";

function validateDatabaseTarget(value) {
  if (!value) throw new Error("Set DATABASE_URL to a dedicated local hire_ai_e2e MySQL database.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid local MySQL URL for hire_ai_e2e.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!new Set(["mysql:", "mysql2:"]).has(url.protocol) || !new Set(["127.0.0.1", "::1"]).has(host) || database !== "hire_ai_e2e" || url.search || url.hash) {
    throw new Error("Browser tests only run against a loopback MySQL database named exactly hire_ai_e2e.");
  }
  return url;
}

function createTestEnvironment(port) {
  const env = { ...process.env };
  const providerSecretName = /(?:API_KEY|ACCESS_KEY|PRIVATE_KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|(?:^|_)PAT(?:_|$)|STRIPE|OAUTH|OPENAI|ANTHROPIC|GEMINI|GOOGLE|DROPBOX|MICROSOFT|LINKEDIN|HAI|^AWS_|^AZURE_|^GCP_|^GITHUB_)/i;
  for (const name of Object.keys(env)) {
    if (name !== "DATABASE_URL" && providerSecretName.test(name)) delete env[name];
  }

  Object.assign(env, {
    NODE_ENV: "test",
    HOST: serverHost,
    PORT: String(port),
    DEV_QA_AUTH_ENABLED: "true",
    AUTONOMOUS_SCHEDULER_ENABLED: "false",
    JOB_SCRAPING_SCHEDULER_ENABLED: "false",
    DATABASE_URL: databaseUrl,
    VITE_APP_ID: "hire-ai-playwright-e2e",
    DOTENV_CONFIG_PATH: path.join(os.tmpdir(), `hire-ai-e2e-no-env-${process.pid}-${Date.now()}`),
    HIRE_AI_E2E_BASE_URL: `http://${serverHost}:${port}`,
  });
  return env;
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Node task failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

async function getLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, serverHost, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a loopback test port.");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startAndWaitForServer(env, port) {
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  if (!existsSync(tsxCli)) throw new Error("Install project dependencies before running browser tests.");
  const child = spawn(process.execPath, [tsxCli, "server/_core/index.ts"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });

  const baseUrl = `http://${serverHost}:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (spawnError) {
      await stopServer(child);
      throw new Error("Hire.AI could not start for the isolated browser test.");
    }
    if (child.exitCode !== null) throw new Error(`Hire.AI exited before becoming ready (exit ${child.exitCode}).`);
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.ok && (await response.json()).ready === true) return { child, baseUrl };
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stopServer(child);
  throw new Error("Hire.AI did not become ready on its loopback test port within 90 seconds.");
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function main() {
  validateDatabaseTarget(databaseUrl);
  const port = await getLoopbackPort();
  const env = createTestEnvironment(port);
  let server;
  try {
    await runNode([path.join(root, "scripts/database-migrate.mjs")], env);
    const ready = await startAndWaitForServer(env, port);
    server = ready.child;
    await runNode([path.join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/seed-e2e-fixtures.ts"], env);
    await runNode([path.join(root, "node_modules/@playwright/test/cli.js"), "test"], {
      ...env,
      HIRE_AI_E2E_BASE_URL: ready.baseUrl,
    });
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Browser test setup failed.");
  process.exitCode = 1;
});
