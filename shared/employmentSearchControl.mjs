export function isEmploymentSearchOnHold(preferences) {
  let value = preferences;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.employmentSearchHold === true);
}
