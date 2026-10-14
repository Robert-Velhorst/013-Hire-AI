export const LEGACY_AUTH_USER_INFO_KEY = "manus-runtime-user-info";

export function clearLegacyAuthUserInfo(storage?: Pick<Storage, "removeItem">) {
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    target?.removeItem(LEGACY_AUTH_USER_INFO_KEY);
  } catch {
    // Storage is optional; authenticated UI state comes from the server session.
  }
}
