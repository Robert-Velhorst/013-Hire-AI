import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  createDatabaseBackup,
  dumpArguments,
  expectedRestoreConfirmation,
  parseDatabaseUrl,
  recoveryCommand,
  restoreDatabaseBackup,
  verifyDatabaseBackup,
} from "../scripts/lib/database-recovery.mjs";

type FakeChild = EventEmitter & {
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
};

function successfulChild(stdout = "-- MySQL dump\nCREATE TABLE example (id int);\n") {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  setImmediate(() => {
    child.stdout.end(stdout);
    child.stderr.end();
    setImmediate(() => child.emit("close", 0));
  });
  return child;
}

describe("database recovery tooling", () => {
  it("parses MySQL URLs without putting credentials in command arguments", () => {
    const connection = parseDatabaseUrl("mysql://backup-user:p%40ss@db.internal:3307/hire_ai");
    expect(connection).toEqual({
      host: "db.internal",
      port: "3307",
      user: "backup-user",
      password: "p@ss",
      database: "hire_ai",
    });
    const args = dumpArguments(connection);
    expect(args).toContain("--host=db.internal");
    expect(args).toContain("--port=3307");
    expect(args).toContain("--user=backup-user");
    expect(args).not.toContain("p@ss");
    expect(args).toContain("--single-transaction");
    expect(args).toContain("--quick");
  });

  it("accepts IPv6 database hosts without passing URL brackets to the client", () => {
    expect(parseDatabaseUrl("mysql://operator:secret@[::1]:3307/hire_ai")).toEqual({
      host: "::1",
      port: "3307",
      user: "operator",
      password: "secret",
      database: "hire_ai",
    });
  });

  it("supports MySQL client execution inside an explicitly named Docker container", () => {
    expect(recoveryCommand("dump", ["--host", "127.0.0.1"], "hire-ai-db"))
      .toEqual({
        executable: "docker",
        args: ["exec", "-i", "-e", "MYSQL_PWD", "hire-ai-db", "mysqldump", "--host", "127.0.0.1"],
      });
    expect(recoveryCommand("dump", [], undefined)).toEqual({
      executable: "mysqldump",
      args: [],
    });
    expect(recoveryCommand("restore", [], "hire-ai-db")).toEqual({
      executable: "docker",
      args: ["exec", "-i", "-e", "MYSQL_PWD", "hire-ai-db", "mysql"],
    });
    expect(
      recoveryCommand(
        "dump",
        [],
        undefined,
        "C:\\Program Files\\MySQL\\bin\\mysqldump.exe"
      )
    ).toEqual({
      executable: "C:\\Program Files\\MySQL\\bin\\mysqldump.exe",
      args: [],
    });
    expect(
      recoveryCommand("restore", [], "hire-ai-db", "/opt/mysql/bin/mysql")
    ).toEqual({
      executable: "docker",
      args: [
        "exec",
        "-i",
        "-e",
        "MYSQL_PWD",
        "hire-ai-db",
        "/opt/mysql/bin/mysql",
      ],
    });
    expect(() => recoveryCommand("restore", [], "unsafe container name"))
      .toThrow("DATABASE_RECOVERY_DOCKER_CONTAINER is invalid");
    expect(() => recoveryCommand("powershell", ["-Command", "Get-Process"], undefined))
      .toThrow("Database recovery operation is invalid");
    expect(() => recoveryCommand("restore", [], undefined, "powershell"))
      .toThrow("Database recovery executable is invalid");
    expect(() => recoveryCommand("restore", [], undefined, "bin/mysql"))
      .toThrow("Database recovery executable is invalid");
  });

  it.each([
    "",
    "not-a-url",
    "postgres://user:secret@db.internal/hire_ai",
    "mysql://db.internal/",
    "mysql://db.internal/one/two",
    "mysql://--defaults-file%3D%2Ftmp%2Fevil:secret@db.internal/hire_ai",
    "mysql://operator:secret@db.internal/--defaults-file%3D%2Ftmp%2Fevil",
    "mysql://operator%0A%2D%2Dhelp:secret@db.internal/hire_ai",
    "mysql://operator:secret@-defaults-file.internal/hire_ai",
  ])("rejects an unsafe database target: %s", value => {
    expect(() => parseDatabaseUrl(value)).toThrow();
  });

  it("creates an atomic, checksummed backup bundle with no secret metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hire-ai-backup-"));
    const outputRoot = path.join(root, "new-backup-parent");
    const spawnImpl = vi.fn((_executable, args, options) => {
      expect(args).not.toContain("super-secret");
      expect(options.env.MYSQL_PWD).toBe("super-secret");
      expect(options.shell).toBe(false);
      return successfulChild();
    });

    const result = await createDatabaseBackup({
      databaseUrl: "mysql://operator:super-secret@127.0.0.1/hire_ai",
      outputRoot,
      now: new Date("2026-08-09T04:00:00.000Z"),
      spawnImpl,
    });
    const verified = await verifyDatabaseBackup(result.directory);
    expect(spawnImpl).toHaveBeenCalledOnce();
    expect(verified.manifest.database).toBe("hire_ai");
    expect(verified.manifest.source).toEqual({ host: "127.0.0.1", port: "3306" });
    expect(JSON.stringify(verified.manifest)).not.toContain("super-secret");
    expect(await readFile(verified.dumpPath, "utf8")).toContain("CREATE TABLE example");
  });

  it("uses the configured absolute mysqldump path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hire-ai-backup-client-"));
    const spawnImpl = vi.fn(() => successfulChild());
    await createDatabaseBackup({
      databaseUrl: "mysql://operator:secret@127.0.0.1/hire_ai",
      outputRoot: root,
      executable: "C:\\Program Files\\MySQL\\bin\\mysqldump.exe",
      spawnImpl,
    });
    expect(spawnImpl.mock.calls[0]?.[0]).toBe(
      "C:\\Program Files\\MySQL\\bin\\mysqldump.exe"
    );
  });

  it("rejects a backup after its dump is modified", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hire-ai-tamper-"));
    const result = await createDatabaseBackup({
      databaseUrl: "mysql://operator:secret@127.0.0.1/hire_ai",
      outputRoot: root,
      spawnImpl: vi.fn(() => successfulChild()),
    });
    await writeFile(result.dumpPath, "tampered", "utf8");
    await expect(verifyDatabaseBackup(result.directory)).rejects.toThrow(/byte count|checksum/i);
  });

  it("removes an incomplete bundle when mysqldump fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hire-ai-failed-backup-"));
    const failedChild = () => {
      const child = new EventEmitter() as FakeChild;
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      setImmediate(() => {
        child.stdout.end();
        child.stderr.end("dump failed");
        setImmediate(() => child.emit("close", 2));
      });
      return child;
    };
    await expect(createDatabaseBackup({
      databaseUrl: "mysql://operator:secret@127.0.0.1/hire_ai",
      outputRoot: root,
      now: new Date("2026-08-09T04:10:00.000Z"),
      spawnImpl: vi.fn(failedChild),
    })).rejects.toThrow(/mysqldump failed/i);
    await expect(access(path.join(root, "hire_ai-20260809T041000Z"))).rejects.toThrow();
  });

  it("blocks mismatched and unconfirmed restores before starting mysql", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hire-ai-restore-"));
    const result = await createDatabaseBackup({
      databaseUrl: "mysql://operator:secret@127.0.0.1/hire_ai",
      outputRoot: root,
      spawnImpl: vi.fn(() => successfulChild()),
    });
    const restoreSpawn = vi.fn(() => successfulChild(""));

    await expect(restoreDatabaseBackup({
      bundlePath: result.directory,
      databaseUrl: "mysql://operator:secret@127.0.0.1/other_database",
      confirmation: expectedRestoreConfirmation("other_database"),
      spawnImpl: restoreSpawn,
    })).rejects.toThrow(/does not match target/i);

    await expect(restoreDatabaseBackup({
      bundlePath: result.directory,
      databaseUrl: "mysql://operator:secret@127.0.0.1/hire_ai",
      confirmation: "yes",
      spawnImpl: restoreSpawn,
    })).rejects.toThrow(/exact confirmation/i);
    expect(restoreSpawn).not.toHaveBeenCalled();
  });

  it("streams a verified dump into mysql only after exact confirmation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hire-ai-valid-restore-"));
    const result = await createDatabaseBackup({
      databaseUrl: "mysql://operator:secret@127.0.0.1/hire_ai",
      outputRoot: root,
      spawnImpl: vi.fn(() => successfulChild()),
    });
    let restoredSql = "";
    const restoreSpawn = vi.fn((_executable, args, options) => {
      expect(args).not.toContain("secret");
      expect(options.env.MYSQL_PWD).toBe("secret");
      const child = new EventEmitter() as FakeChild;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({
        write(chunk, _encoding, callback) {
          restoredSql += chunk.toString("utf8");
          callback();
        },
      });
      child.stdin.once("finish", () => child.emit("close", 0));
      return child;
    });

    await restoreDatabaseBackup({
      bundlePath: result.directory,
      databaseUrl: "mysql://operator:secret@127.0.0.1/hire_ai",
      confirmation: expectedRestoreConfirmation("hire_ai"),
      spawnImpl: restoreSpawn,
    });
    expect(restoreSpawn).toHaveBeenCalledOnce();
    expect(restoredSql).toContain("CREATE TABLE example");
  });

  it("uses the configured absolute mysql path for restores", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hire-ai-restore-client-"));
    const result = await createDatabaseBackup({
      databaseUrl: "mysql://operator:secret@127.0.0.1/hire_ai",
      outputRoot: root,
      spawnImpl: vi.fn(() => successfulChild()),
    });
    const restoreSpawn = vi.fn(() => {
      const child = new EventEmitter() as FakeChild;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      child.stdin.once("finish", () => child.emit("close", 0));
      return child;
    });

    await restoreDatabaseBackup({
      bundlePath: result.directory,
      databaseUrl: "mysql://operator:secret@127.0.0.1/hire_ai",
      confirmation: expectedRestoreConfirmation("hire_ai"),
      executable: "/opt/mysql/bin/mysql",
      spawnImpl: restoreSpawn,
    });
    expect(restoreSpawn.mock.calls[0]?.[0]).toBe("/opt/mysql/bin/mysql");
  });

  it("wires recovery commands and excludes backup artifacts from Git", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
    const gitignore = await readFile(path.resolve(".gitignore"), "utf8");
    const backupScript = await readFile(path.resolve("scripts/database-backup.mjs"), "utf8");
    const restoreScript = await readFile(path.resolve("scripts/database-restore.mjs"), "utf8");
    expect(packageJson.scripts["db:backup"]).toBe("node scripts/database-backup.mjs");
    expect(packageJson.scripts["db:backup:verify"]).toBe("node scripts/database-backup.mjs verify");
    expect(packageJson.scripts["db:restore"]).toBe("node scripts/database-restore.mjs");
    expect(backupScript).toContain('executable: valueAfter("--mysqldump")');
    expect(restoreScript).toContain('executable: valueAfter("--mysql")');
    expect(gitignore).toMatch(/^backups\/$/m);
  });
});
