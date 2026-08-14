import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin operational failure wiring", () => {
  it("loads the admin-only bounded signal summary and renders its operator region", () => {
    const adminPage = readFileSync(
      resolve(process.cwd(), "client", "src", "pages", "AdminPanel.tsx"),
      "utf8"
    );
    const adminRouter = readFileSync(
      resolve(process.cwd(), "server", "routers", "admin.ts"),
      "utf8"
    );

    expect(adminRouter).toContain("getOperationalFailures: adminProcedure");
    expect(adminRouter).toContain("getOperationalFailureMonitoringSnapshot(input?.limit ?? 20)");
    expect(adminPage).toContain("trpc.admin.getOperationalFailures.useQuery");
    expect(adminPage).toContain('data-testid="admin-runtime-failure-signals"');
    expect(adminPage).toContain("refetchInterval: 30_000");
    expect(adminPage).toContain('ac("runtimeFailureSignals")');
    expect(adminPage).toContain('dateTimeFormatter.format(new Date(signal.lastOccurredAt))');
    expect(adminPage).not.toContain(">Runtime failure signals<");
  });
});
