export const startupStages = [
  "configuration validation",
  "platform catalog initialization",
  "application assembly",
  "listener binding",
] as const;

export type StartupStage = (typeof startupStages)[number];

export function writeStartupFailureStage(stage: StartupStage) {
  console.error(`[Server] Startup stage failed: ${stage}.`);
}
