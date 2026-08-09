import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { translate } from "../contexts/LocaleContext";

describe("workspace governance UI wiring", () => {
  it("exposes every governance operation while keeping candidate records out of the team surface", () => {
    const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
    const layout = readFileSync(resolve(process.cwd(), "client/src/components/DashboardLayout.tsx"), "utf8");
    const team = readFileSync(resolve(process.cwd(), "client/src/pages/Team.tsx"), "utf8");

    expect(app).toContain('<Route path={"/team"} component={Team} />');
    expect(layout).toContain('labelKey: "team"');
    for (const operation of [
      "list", "detail", "create", "rename", "invite", "acceptInvitation",
      "revokeInvitation", "changeMemberRole", "removeMember", "transferOwnership", "archive",
    ]) {
      expect(team).toContain(`trpc.workspaces.${operation}.`);
    }
    expect(team).toContain('t("candidateDataPrivate")');
    expect(team).not.toMatch(/<main\b/);
    expect(translate("en", "candidateDataPrivate")).toBe("Candidate data remains private");
    expect(translate("nl", "candidateDataPrivate")).toBe("Kandidaatgegevens blijven prive");
    expect(team).not.toContain("trpc.applications.");
    expect(team).not.toContain("trpc.profile.");
    expect(team).not.toContain("trpc.successFees.");
  });
});
