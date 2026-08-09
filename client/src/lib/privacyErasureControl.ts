export function buildPrivacyCleanupConfirmation(
  userId: number,
  policyVersion: string
) {
  return `CLEAN UP USER ${userId} USING ${policyVersion}`;
}

export function buildPrivacyDatabaseConfirmation(
  userId: number,
  policyVersion: string
) {
  return `ERASE DATABASE USER ${userId} USING ${policyVersion}`;
}

export function canExecutePrivacyCleanup(input: {
  status: string;
  confirmation: string;
  userId: number;
  policyVersion: string;
}) {
  return (
    ["planned", "cleanup_in_progress", "failed"].includes(input.status) &&
    input.confirmation ===
      buildPrivacyCleanupConfirmation(input.userId, input.policyVersion)
  );
}

export function canFinalizePrivacyErasure(input: {
  status: string;
  confirmation: string;
  userId: number;
  policyVersion: string;
}) {
  return (
    input.status === "ready_for_database" &&
    input.confirmation ===
      buildPrivacyDatabaseConfirmation(input.userId, input.policyVersion)
  );
}
