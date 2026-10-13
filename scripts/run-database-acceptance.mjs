import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDatabaseAcceptanceReport } from "./database-acceptance-report.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = path.join(
  root,
  "scripts",
  "database-acceptance-suites.json"
);
const integrationSuffix = ".integration.test.ts";

async function findIntegrationSuites(directory, relativeToRoot = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async entry => {
      const relativePath = path.join(relativeToRoot, entry.name);
      if (entry.isDirectory()) {
        return findIntegrationSuites(
          path.join(directory, entry.name),
          relativePath
        );
      }
      return entry.isFile() && entry.name.endsWith(integrationSuffix)
        ? [relativePath.split(path.sep).join("/")]
        : [];
    })
  );
  return files.flat().sort();
}

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
  let temporaryDirectory;
  let reportPath = process.env.HIRE_AI_DATABASE_ACCEPTANCE_REPORT;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const suites = manifest.suites;
    if (
      !Array.isArray(suites) ||
      suites.length === 0 ||
      suites.some(suite => typeof suite !== "string")
    ) {
      throw new Error(
        "The database acceptance suite manifest must contain at least one suite path."
      );
    }
    if (new Set(suites).size !== suites.length) {
      throw new Error(
        "The database acceptance suite manifest contains duplicate paths."
      );
    }

    const discoveredSuites = await findIntegrationSuites(
      path.join(root, "server"),
      "server"
    );
    const approvedSuites = suites.slice().sort();
    const missing = approvedSuites.filter(
      suite => !discoveredSuites.includes(suite)
    );
    const unapproved = discoveredSuites.filter(
      suite => !approvedSuites.includes(suite)
    );
    if (missing.length || unapproved.length) {
      throw new Error(
        [
          ...missing.map(
            suite => `Approved integration suite is missing: ${suite}`
          ),
          ...unapproved.map(
            suite =>
              `Review and approve newly discovered integration suite: ${suite}`
          ),
        ].join("\n")
      );
    }

    if (!reportPath) {
      temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), "hire-ai-db-acceptance-")
      );
      reportPath = path.join(temporaryDirectory, "report.json");
    } else {
      reportPath = path.resolve(root, reportPath);
    }

    console.log(
      `Running ${approvedSuites.length} approved integration suites against isolated MySQL.`
    );
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("../node_modules/vitest/vitest.mjs", import.meta.url)
        ),
        "run",
        ...approvedSuites,
        "--reporter=default",
        "--reporter=json",
        `--outputFile=${reportPath}`,
        "--maxWorkers=1",
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_ENV: "test",
          HIRE_AI_DATABASE_ACCEPTANCE: "true",
          PRIVACY_ERASURE_INTEGRATION: "true",
        },
      }
    );

    let timedOut = false;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
      },
      10 * 60 * 1000
    );
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    })
      .catch(error => {
        console.error(
          "Database acceptance runner could not start:",
          error.message
        );
        return 1;
      })
      .finally(() => clearTimeout(timeout));

    if (timedOut) {
      console.error("Database acceptance exceeded the 10-minute limit.");
      process.exitCode = 1;
    } else if (exitCode !== 0) {
      process.exitCode = exitCode;
    }

    let report;
    try {
      report = JSON.parse(await readFile(reportPath, "utf8"));
    } catch (error) {
      console.error(
        `Vitest JSON report is missing or invalid: ${error.message}`
      );
      process.exitCode = 1;
    }
    if (report) {
      const failures = verifyDatabaseAcceptanceReport(
        report,
        approvedSuites,
        root
      );
      if (failures.length) {
        console.error("Database acceptance verification failed:");
        for (const failure of failures) console.error(`- ${failure}`);
        process.exitCode = 1;
      } else {
        console.log(
          `Verified ${report.numPassedTests} passing tests; no approved suite was skipped.`
        );
      }
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Database acceptance setup failed."
    );
    process.exitCode = 1;
  } finally {
    if (temporaryDirectory)
      await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
