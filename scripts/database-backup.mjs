import path from "node:path";
import { createDatabaseBackup, verifyDatabaseBackup } from "./lib/database-recovery.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

try {
  if (process.argv[2] === "verify") {
    const bundlePath = process.argv[3];
    if (!bundlePath) throw new Error("Usage: pnpm db:backup:verify -- <backup-directory>");
    const verified = await verifyDatabaseBackup(bundlePath);
    console.log(`Verified backup for ${verified.manifest.database}: ${verified.manifest.dump.bytes} bytes, SHA-256 ${verified.manifest.dump.sha256}.`);
  } else {
    const result = await createDatabaseBackup({
      outputRoot: valueAfter("--output") || path.resolve("backups"),
      executable: valueAfter("--mysqldump") || "mysqldump",
      dockerContainer: valueAfter("--docker-container") || process.env.DATABASE_RECOVERY_DOCKER_CONTAINER,
    });
    console.log(`Created verified backup at ${result.directory}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database backup failed.");
  process.exitCode = 1;
}
