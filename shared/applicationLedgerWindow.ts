export const APPLICATION_LEDGER_WINDOW_LIMITS = {
  attempts: 5,
  employerResponses: 5,
  auditEvents: 6,
} as const;

export function takeApplicationLedgerWindow<T>(items: T[], limit: number) {
  return {
    items: items.slice(0, limit),
    hasMore: items.length > limit,
  };
}
