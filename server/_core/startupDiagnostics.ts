export const startupStages = [
  "configuration validation",
  "database schema validation",
  "platform catalog initialization",
  "application assembly",
  "listener binding",
] as const;

export type StartupStage = (typeof startupStages)[number];

function safeErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return null;

  const name = /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name)
    ? error.name
    : "Error";
  const code =
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_-]{1,32}$/i.test(error.code)
      ? error.code
      : null;
  const message = error.message
    .replace(
      /\b(?:https?|mysql|postgres(?:ql)?)\:\/\/[^\s]+/gi,
      "[redacted-url]"
    )
    .replace(/\b(?:bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(
      /\b(password|secret|token|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]"
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted-value]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

  if (!message && !code) return name;
  return [name, code, message].filter(Boolean).join(": ");
}

export function writeStartupFailureStage(stage: StartupStage, error?: unknown) {
  console.error(`[Server] Startup stage failed: ${stage}.`);
  const details = safeErrorDetails(error);
  if (details) console.error(`[Server] Startup error: ${details}`);
}
