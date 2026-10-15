import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production container packaging", () => {
  it("uses the repository package manager and carries its frozen-install configuration", () => {
    const dockerfile = readFileSync(
      resolve(process.cwd(), "Dockerfile"),
      "utf8"
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      packageManager?: string;
    };
    const packageManager = packageJson.packageManager;

    expect(packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect(dockerfile).toContain(
      `corepack prepare ${packageManager} --activate`
    );
    expect(dockerfile).toContain(
      "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.mjs ./"
    );
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
  });

  it("fails closed through the production doctor and runs as a non-root user", () => {
    const dockerfile = readFileSync(
      resolve(process.cwd(), "Dockerfile"),
      "utf8"
    );

    expect(dockerfile).toContain(
      "COPY --from=build /app/scripts/doctor.mjs ./scripts/doctor.mjs"
    );
    expect(dockerfile).toContain(
      "COPY --from=build /app/shared/windowsDefenderPaths.mjs ./shared/windowsDefenderPaths.mjs"
    );
    expect(dockerfile).toContain(
      "COPY --from=build /app/scripts/database-migrate.mjs ./scripts/database-migrate.mjs"
    );
    expect(dockerfile).toContain(
      "COPY --from=build /app/scripts/database-migration-plan.mjs ./scripts/database-migration-plan.mjs"
    );
    expect(dockerfile).toContain(
      "node scripts/doctor.mjs && exec node dist/index.js"
    );
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/readyz");
    expect(dockerfile).toContain("AbortSignal.timeout(4000)");
    expect(dockerfile).toContain("USER node");
    const ignored = readFileSync(resolve(process.cwd(), ".dockerignore"), "utf8");
    expect(ignored).toContain(".playwright-cli");
    expect(ignored).toContain("backups");

    const migrator = readFileSync(
      resolve(process.cwd(), "scripts", "database-migrate.mjs"),
      "utf8"
    );
    expect(migrator).toContain("SELECT GET_LOCK(?, ?) AS acquired");
    expect(migrator).toContain("SELECT RELEASE_LOCK(?)");
  });

  it("copies all relative modules imported by the production doctor into the runtime image", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
    const doctor = readFileSync(resolve(process.cwd(), "scripts", "doctor.mjs"), "utf8");
    const imports = [...doctor.matchAll(/(?:from\s+|import\s+)["'](\.{1,2}\/[^"']+)["']/g)]
      .map(match => posix.normalize(posix.join("scripts", match[1]!)));
    const missingCopies = (imageDockerfile: string) => imports.filter(importPath =>
      !imageDockerfile.includes(`COPY --from=build /app/${importPath} ./${importPath}`)
    );

    expect(imports.length).toBeGreaterThan(0);
    expect(missingCopies(dockerfile)).toEqual([]);

    const omittedPolicyCopy = dockerfile.replace(
      /^COPY --from=build \/app\/shared\/malwareScannerEndpointPolicy\.mjs \.\/shared\/malwareScannerEndpointPolicy\.mjs\r?\n?/m,
      ""
    );
    expect(missingCopies(omittedPolicyCopy)).toContain("shared/malwareScannerEndpointPolicy.mjs");
  });

  it("excludes the development-only Vite server from the production server bundle", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.build).toContain("--external:./vite");
  });
});
