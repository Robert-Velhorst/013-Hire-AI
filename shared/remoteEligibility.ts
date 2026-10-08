const remoteSignals =
  /\b(remote|worldwide|anywhere|distributed|work from home|wfh)\b/i;

export const REMOTE_ONLY_EXCLUSION_PATTERN = String.raw`\b(?:hybrid|mostly\s+remote|partly\s+remote|partially\s+remote|remote[- ]friendly|(?:weekly|monthly|quarterly|regular(?:ly)?|occasional(?:ly)?)\s+(?:on[- ]site|in[- ]person|in[- ]office)|(?:on[- ]site|in[- ]person|in[- ]office)\s+(?:attendance|presence|days?|work|collaboration|meetings?)|office[- ]based|based in (?:the )?office|onsite|on-site|in office|in-office)\b`;

const nonRemoteSignal = new RegExp(REMOTE_ONLY_EXCLUSION_PATTERN, "i");

export function hasNonRemoteWorkSignal(
  ...values: Array<string | null | undefined>
) {
  const text = values.filter(Boolean).join(" ");
  return nonRemoteSignal.test(text);
}

export function hasExplicitRemoteWorkSignal(
  ...values: Array<string | null | undefined>
) {
  return remoteSignals.test(values.filter(Boolean).join(" "));
}
