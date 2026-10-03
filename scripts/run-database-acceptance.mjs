import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let allowed = false;
try {
  const target = new URL(process.env.DATABASE_URL || "");
  allowed =
    process.env.HIRE_AI_DATABASE_ACCEPTANCE === "true" &&
    process.env.NODE_ENV !== "production" &&
    target.protocol === "mysql:" &&
    target.pathname === "/hire_ai_acceptance";
} catch {
  /* Invalid targets must not reach the test runner. */
}

if (!allowed) {
  console.error(
    "Set HIRE_AI_DATABASE_ACCEPTANCE=true and DATABASE_URL for an isolated hire_ai_acceptance database outside production. No tests were run."
  );
  process.exitCode = 1;
} else {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vitest/vitest.mjs", import.meta.url)
      ),
      "run",
      "server/productionData.integration.test.ts",
      "server/privacyErasurePlanning.integration.test.ts",
      "--maxWorkers=1",
      "--minWorkers=1",
    ],
    {
      cwd: root,
      stdio: "inherit",
      timeout: 180000,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PRIVACY_ERASURE_INTEGRATION: "true",
      },
    }
  );
  child.on("error", () => {
    console.error("Database acceptance runner could not start.");
    process.exitCode = 1;
  });
  child.on("exit", code => {
    process.exitCode = code ?? 1;
  });
}
