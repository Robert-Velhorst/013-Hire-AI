const EMPLOYMENT_SEARCH_PAUSE_ABORT_REASON = "employment_search_paused_after_hire";
const activeRunAbortControllers = new Map<number, AbortController>();

export function registerAutonomousRunCancellation(userId: number, controller: AbortController) {
  activeRunAbortControllers.set(userId, controller);
  return () => {
    if (activeRunAbortControllers.get(userId) === controller) {
      activeRunAbortControllers.delete(userId);
    }
  };
}

export function cancelAutonomousRunForEmploymentHold(userId: number): boolean {
  const controller = activeRunAbortControllers.get(userId);
  if (!controller || controller.signal.aborted) return false;
  controller.abort(EMPLOYMENT_SEARCH_PAUSE_ABORT_REASON);
  return true;
}

export function isEmploymentSearchPauseAbort(signal?: AbortSignal) {
  return signal?.aborted === true && signal.reason === EMPLOYMENT_SEARCH_PAUSE_ABORT_REASON;
}
