import path from "node:path";
import { describe, expect, it } from "vitest";
import { createViteConfig } from "../../vite.config";

function pluginNames(command: "build" | "serve") {
  return (createViteConfig(command).plugins || [])
    .flat()
    .filter((plugin): plugin is Exclude<typeof plugin, false | null | undefined> => Boolean(plugin))
    .map((plugin) => plugin.name);
}

describe("Vite runtime configuration", () => {
  it("keeps development instrumentation out of production builds", () => {
    const names = pluginNames("build");

    expect(names).not.toContain("vite-plugin-manus-runtime");
    expect(names).not.toContain("vite-plugin-jsx-loc");
  });

  it("gives the embedded development server the client root and development plugins", () => {
    const config = createViteConfig("serve");
    const names = pluginNames("serve");

    expect(config.root).toBe(path.resolve(import.meta.dirname, "..", "..", "client"));
    expect(names).toContain("vite-plugin-manus-runtime");
    expect(names).toContain("vite-plugin-jsx-loc");
  });
});
