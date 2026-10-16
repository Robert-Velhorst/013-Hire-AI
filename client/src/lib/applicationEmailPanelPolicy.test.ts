import { describe, expect, it } from "vitest";
import { getApplicationEmailPanelPolicy } from "./applicationEmailPanelPolicy";

describe("application email panel policy", () => {
  it("allows preparation while an application is pending, before a delivery exists", () => {
    expect(getApplicationEmailPanelPolicy("pending", false, true)).toEqual({
      visible: true,
      canPrepare: true,
    });
  });

  it("retains delivery history after submission without enabling another send", () => {
    expect(getApplicationEmailPanelPolicy("applied", true, false)).toEqual({
      visible: true,
      canPrepare: false,
    });
  });

  it("does not show an email action for a closed application without a delivery", () => {
    expect(getApplicationEmailPanelPolicy("rejected", false, false)).toEqual({
      visible: false,
      canPrepare: false,
    });
  });

  it("does not offer preparation when the backend eligibility gate blocks it", () => {
    expect(getApplicationEmailPanelPolicy("pending", false, false)).toEqual({
      visible: false,
      canPrepare: false,
    });
  });
});
