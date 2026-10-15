import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDatabaseAcceptanceTarget } from "./database-acceptance-policy.mjs";

if (!isDatabaseAcceptanceTarget()) {
  console.error(
    "Refusing acceptance migrations: DATABASE_URL must target a dedicated local hire_ai_acceptance database outside production. Do not use a shared or port-forwarded database."
  );
  process.exitCode = 1;
} else {
  const migrationScript = fileURLToPath(
    new URL("./database-migrate.mjs", import.meta.url)
  );
  const result = spawnSync(process.execPath, [migrationScript], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error("Could not start the acceptance database migration.");
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
