export function planPendingMigrations(
  migrations,
  appliedHashes,
  latestCreatedAt = 0,
  now = Date.now()
) {
  const journalHashes = new Set();
  for (const migration of migrations) {
    if (typeof migration.hash !== "string" || !migration.hash) {
      throw new Error("Migration journal contains an entry without a content hash.");
    }
    if (journalHashes.has(migration.hash)) {
      throw new Error(`Migration journal contains a duplicate content hash: ${migration.hash}`);
    }
    journalHashes.add(migration.hash);
  }

  const unknownHashes = appliedHashes.filter(hash => !journalHashes.has(hash));
  if (unknownHashes.length > 0) {
    throw new Error(
      `Database migration ledger contains hashes absent from this journal: ${unknownHashes.join(", ")}`
    );
  }

  const knownHashes = new Set(appliedHashes);
  let createdAt = Math.max(Number(latestCreatedAt) || 0, Number(now) - 1);
  const pending = [];

  for (const migration of migrations) {
    if (knownHashes.has(migration.hash)) continue;
    createdAt = Math.max(createdAt + 1, Number(now), migration.folderMillis);
    pending.push({ ...migration, folderMillis: createdAt });
    knownHashes.add(migration.hash);
  }

  return pending;
}
