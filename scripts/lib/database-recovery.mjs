import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

export const BACKUP_FORMAT_VERSION = 1;

export function parseDatabaseUrl(value) {
  if (!value || !String(value).trim()) throw new Error("DATABASE_URL is required.");

  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL URL.");
  }
  if (!["mysql:", "mysql2:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the mysql or mysql2 protocol.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!/^[a-zA-Z0-9_$][a-zA-Z0-9_$-]{0,63}$/.test(database)) {
    throw new Error("DATABASE_URL must name exactly one safe database identifier.");
  }
  if (!url.hostname) throw new Error("DATABASE_URL must include a host.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const validHostname = host.length <= 253 && host.split(".").every(label =>
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)
  );
  if (isIP(host) === 0 && !validHostname) {
    throw new Error("DATABASE_URL host is invalid.");
  }

  const user = decodeURIComponent(url.username);
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]{0,127}$/.test(user)) {
    throw new Error("DATABASE_URL user is invalid.");
  }

  const port = url.port || "3306";
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("DATABASE_URL port is invalid.");
  }

  const password = decodeURIComponent(url.password);
  if (password.includes("\0") || password.length > 4096) {
    throw new Error("DATABASE_URL password is invalid.");
  }

  return { host, port, user, password, database };
}

export function timestampForFilename(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new Error("A valid backup date is required.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createBackupPaths(outputRoot, database, date = new Date()) {
  const safeDatabase = database.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const bundleName = `${safeDatabase}-${timestampForFilename(date)}`;
  const directory = path.resolve(outputRoot, bundleName);
  const temporaryDirectory = path.resolve(outputRoot, `.${bundleName}.partial-${process.pid}`);
  return {
    directory,
    temporaryDirectory,
    dumpPath: path.join(directory, "database.sql"),
    temporaryDumpPath: path.join(temporaryDirectory, "database.sql"),
    manifestPath: path.join(directory, "manifest.json"),
    temporaryManifestPath: path.join(temporaryDirectory, "manifest.json"),
  };
}

export function mysqlConnectionArguments(connection) {
  return [
    `--host=${connection.host}`,
    `--port=${connection.port}`,
    `--user=${connection.user}`,
  ];
}

function validateClientExecutable(executable, expectedExecutable) {
  if (typeof executable !== "string" || /[\u0000-\u001f\u007f]/.test(executable)) {
    throw new Error("Database recovery executable is invalid.");
  }
  const basename = path.win32.basename(executable).toLowerCase();
  const expectedNames = new Set([expectedExecutable, `${expectedExecutable}.exe`]);
  const hasPathSeparator = /[\\/]/.test(executable);
  const isAbsolutePath = path.isAbsolute(executable) || path.win32.isAbsolute(executable);
  if (!expectedNames.has(basename)
      || (hasPathSeparator && !isAbsolutePath)
      || (!hasPathSeparator && executable.toLowerCase() !== basename)) {
    throw new Error("Database recovery executable is invalid.");
  }
  return executable;
}

export function recoveryCommand(executable, args, dockerContainer, expectedExecutable) {
  if (!["mysql", "mysqldump"].includes(expectedExecutable)) {
    throw new Error("Database recovery operation is invalid.");
  }
  validateClientExecutable(executable, expectedExecutable);
  if (!dockerContainer) return { executable, args };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(dockerContainer)) {
    throw new Error("DATABASE_RECOVERY_DOCKER_CONTAINER is invalid.");
  }
  return {
    executable: "docker",
    args: ["exec", "-i", "-e", "MYSQL_PWD", dockerContainer, executable, ...args],
  };
}

function commandConnection(connection, dockerContainer) {
  return dockerContainer
    ? { ...connection, host: "127.0.0.1", port: "3306" }
    : connection;
}

export function dumpArguments(connection) {
  return [
    ...mysqlConnectionArguments(connection),
    "--single-transaction",
    "--quick",
    "--routines",
    "--events",
    "--triggers",
    "--hex-blob",
    "--default-character-set=utf8mb4",
    "--databases",
    connection.database,
  ];
}

function childEnvironment(connection) {
  const env = { ...process.env };
  if (connection.password) env.MYSQL_PWD = connection.password;
  else delete env.MYSQL_PWD;
  return env;
}

function boundedError(chunks) {
  return Buffer.concat(chunks).toString("utf8").trim().slice(0, 2_000);
}

export async function runDump({ connection, executable = "mysqldump", dockerContainer, outputPath, spawnImpl = spawn }) {
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  const command = recoveryCommand(executable, dumpArguments(commandConnection(connection, dockerContainer)), dockerContainer, "mysqldump");
  const child = spawnImpl(command.executable, command.args, {
    env: childEnvironment(connection),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const errors = [];
  child.stderr.on("data", chunk => {
    if (errors.reduce((total, item) => total + item.length, 0) < 2_000) errors.push(Buffer.from(chunk));
  });
  const processResult = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const [streamState, processState] = await Promise.allSettled([
    pipeline(child.stdout, output),
    processResult,
  ]);
  if (processState.status === "rejected") throw processState.reason;
  if (streamState.status === "rejected") throw streamState.reason;
  if (processState.value !== 0) {
    throw new Error(`mysqldump failed with exit code ${processState.value ?? "unknown"}${boundedError(errors) ? `: ${boundedError(errors)}` : "."}`);
  }
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", chunk => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolve);
  });
  return hash.digest("hex");
}

export async function createDatabaseBackup({ databaseUrl, outputRoot = "backups", now = new Date(), executable = "mysqldump", dockerContainer = process.env.DATABASE_RECOVERY_DOCKER_CONTAINER, spawnImpl } = {}) {
  const connection = parseDatabaseUrl(databaseUrl ?? process.env.DATABASE_URL);
  const paths = createBackupPaths(outputRoot, connection.database, now);
  await mkdir(path.resolve(outputRoot), { recursive: true, mode: 0o700 });
  await mkdir(paths.temporaryDirectory, { recursive: false, mode: 0o700 });

  try {
    await runDump({ connection, executable, dockerContainer, outputPath: paths.temporaryDumpPath, spawnImpl });
    const details = await stat(paths.temporaryDumpPath);
    if (!details.isFile() || details.size === 0) throw new Error("mysqldump produced an empty backup.");
    const checksum = await sha256File(paths.temporaryDumpPath);

    const manifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: now.toISOString(),
      engine: "mysql",
      database: connection.database,
      source: { host: connection.host, port: connection.port },
      dump: { file: "database.sql", bytes: details.size, sha256: checksum },
    };
    await writeFile(paths.temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(paths.temporaryDirectory, paths.directory);
    return { ...paths, manifest };
  } catch (error) {
    await rm(paths.temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

function assertManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Backup manifest must be an object.");
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) throw new Error("Unsupported backup manifest version.");
  if (manifest.engine !== "mysql") throw new Error("Backup manifest engine must be mysql.");
  if (typeof manifest.database !== "string" || !manifest.database) throw new Error("Backup manifest database is missing.");
  if (!manifest.dump || manifest.dump.file !== "database.sql") throw new Error("Backup manifest dump filename is invalid.");
  if (!Number.isSafeInteger(manifest.dump.bytes) || manifest.dump.bytes <= 0) throw new Error("Backup manifest byte count is invalid.");
  if (!/^[a-f0-9]{64}$/.test(manifest.dump.sha256)) throw new Error("Backup manifest checksum is invalid.");
}

export async function verifyDatabaseBackup(bundlePath) {
  const directory = path.resolve(bundlePath);
  const manifestPath = path.join(directory, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Backup manifest could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  assertManifest(manifest);

  const dumpPath = path.resolve(directory, manifest.dump.file);
  if (path.dirname(dumpPath) !== directory) throw new Error("Backup dump must remain inside its bundle.");
  const details = await stat(dumpPath).catch(() => null);
  if (!details?.isFile()) throw new Error("Backup dump is missing.");
  if (details.size !== manifest.dump.bytes) throw new Error("Backup dump byte count does not match its manifest.");
  if (await sha256File(dumpPath) !== manifest.dump.sha256) throw new Error("Backup dump checksum does not match its manifest.");
  return { directory, dumpPath, manifestPath, manifest };
}

export function expectedRestoreConfirmation(database) {
  return `RESTORE:${database}`;
}

export async function restoreDatabaseBackup({ bundlePath, databaseUrl, confirmation, executable = "mysql", dockerContainer = process.env.DATABASE_RECOVERY_DOCKER_CONTAINER, spawnImpl = spawn } = {}) {
  const connection = parseDatabaseUrl(databaseUrl ?? process.env.DATABASE_URL);
  const verified = await verifyDatabaseBackup(bundlePath);
  if (verified.manifest.database !== connection.database) {
    throw new Error(`Backup database ${verified.manifest.database} does not match target database ${connection.database}.`);
  }
  const expected = expectedRestoreConfirmation(connection.database);
  if (confirmation !== expected) throw new Error(`Restore requires the exact confirmation ${expected}.`);

  const command = recoveryCommand(
    executable,
    [...mysqlConnectionArguments(commandConnection(connection, dockerContainer)), connection.database],
    dockerContainer,
    "mysql"
  );
  const child = spawnImpl(command.executable, command.args, {
    env: childEnvironment(connection),
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "ignore", "pipe"],
  });
  const errors = [];
  child.stderr.on("data", chunk => {
    if (errors.reduce((total, item) => total + item.length, 0) < 2_000) errors.push(Buffer.from(chunk));
  });
  const processResult = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const [streamState, processState] = await Promise.allSettled([
    pipeline(createReadStream(verified.dumpPath), child.stdin),
    processResult,
  ]);
  if (processState.status === "rejected") throw processState.reason;
  if (processState.value !== 0) {
    throw new Error(`mysql restore failed with exit code ${processState.value ?? "unknown"}${boundedError(errors) ? `: ${boundedError(errors)}` : "."}`);
  }
  if (streamState.status === "rejected") throw streamState.reason;
  return verified;
}
