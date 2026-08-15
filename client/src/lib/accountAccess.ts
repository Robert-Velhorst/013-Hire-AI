export type AccountStatus = "active" | "suspended" | "pending";

export function accountRestriction(
  accountStatus: AccountStatus | string | null | undefined
): "suspended" | "pending" | null {
  if (accountStatus === "active") return null;
  return accountStatus === "pending" ? "pending" : "suspended";
}
