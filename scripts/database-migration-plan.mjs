export function planPendingMigrations(
  migrations,
  appliedHashes,
  latestCreatedAt = 0,
  now = Date.now()
) {
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
