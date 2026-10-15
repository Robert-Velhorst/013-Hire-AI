const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isDatabaseAcceptanceTarget(environment = process.env) {
  if (
    environment.HIRE_AI_DATABASE_ACCEPTANCE !== "true" ||
    environment.NODE_ENV === "production"
  ) {
    return false;
  }

  try {
    const target = new URL(environment.DATABASE_URL || "");
    return (
      target.protocol === "mysql:" &&
      target.pathname === "/hire_ai_acceptance" &&
      allowedHosts.has(target.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
