import { describe, expect, it, vi } from "vitest";
import { saveDraftThenRequestApproval } from "./applicationEmailApprovalRequest";

describe("application email approval request sequencing", () => {
  it("requests approval only after the draft save succeeds", async () => {
    const events: string[] = [];
    const result = await saveDraftThenRequestApproval(
      async () => {
        events.push("saved");
      },
      () => events.push("requested")
    );

    expect(result).toBe(true);
    expect(events).toEqual(["saved", "requested"]);
  });

  it("does not request approval when saving the draft fails", async () => {
    const requestApproval = vi.fn();
    const result = await saveDraftThenRequestApproval(async () => {
      throw new Error("save failed");
    }, requestApproval);

    expect(result).toBe(false);
    expect(requestApproval).not.toHaveBeenCalled();
  });
});
