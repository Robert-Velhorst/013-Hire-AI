import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("localization wiring", () => {
  it("wires the account locale through the provider, shell, and settings mutation", () => {
    const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
    const provider = readFileSync(resolve(process.cwd(), "client/src/contexts/LocaleContext.tsx"), "utf8");
    const layout = readFileSync(resolve(process.cwd(), "client/src/components/DashboardLayout.tsx"), "utf8");
    const settings = readFileSync(resolve(process.cwd(), "client/src/pages/Settings.tsx"), "utf8");

    expect(app).toContain("<LocaleProvider>");
    expect(provider).toContain("document.documentElement.lang = locale");
    expect(provider).toContain("user?.locale");
    expect(layout).toContain("t(item.labelKey)");
    expect(settings).toContain("trpc.auth.updateLocale.useMutation");
    expect(settings).toContain("SUPPORTED_LOCALES.map");
  });
});
