import { expectedRestoreConfirmation, parseDatabaseUrl, restoreDatabaseBackup } from "./lib/database-recovery.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

try {
  const bundlePath = process.argv[2];
  if (!bundlePath) throw new Error("Usage: pnpm db:restore -- <backup-directory> --confirm RESTORE:<database>");
  const connection = parseDatabaseUrl(process.env.DATABASE_URL);
  const confirmation = valueAfter("--confirm");
  if (!confirmation) throw new Error(`Restore requires --confirm ${expectedRestoreConfirmation(connection.database)}.`);
  const result = await restoreDatabaseBackup({
    bundlePath,
    confirmation,
    executable: valueAfter("--mysql") || "mysql",
  });
  console.log(`Restored and verified backup into ${result.manifest.database}. Run application reconciliation checks before enabling workers.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database restore failed.");
  process.exitCode = 1;
}
