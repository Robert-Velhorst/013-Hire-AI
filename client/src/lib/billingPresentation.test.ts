import { describe, expect, it } from "vitest";
import { translate } from "../contexts/LocaleContext";
import { formatBillingCurrency } from "./billingPresentation";

describe("billing presentation localization", () => {
  it("formats money with the account locale without changing its currency", () => {
    const english = formatBillingCurrency(123_456, "eur", "en");
    const dutch = formatBillingCurrency(123_456, "eur", "nl");

    expect(english).toContain("1,234.56");
    expect(dutch).toContain("1.234,56");
    expect(english).toContain("€");
    expect(dutch).toContain("€");
    expect(formatBillingCurrency(123_456, "EUR", "nl")).toBe(dutch);
  });

  it("keeps unknown currency input contained and localizes billing states", () => {
    expect(formatBillingCurrency(1_250, "invalid", "nl")).toBe("INVALID 12.50");
    expect(translate("nl", "pendingVerification")).toBe("Wacht op verificatie");
    expect(translate("nl", "needsAttention")).toBe("Aandacht vereist");
    expect(translate("nl", "severityCritical")).toBe("Kritiek");
  });
});
