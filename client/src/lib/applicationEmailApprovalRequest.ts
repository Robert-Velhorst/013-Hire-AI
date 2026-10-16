export async function saveDraftThenRequestApproval(
  saveDraft: () => Promise<unknown>,
  requestApproval: () => void
) {
  try {
    await saveDraft();
    requestApproval();
    return true;
  } catch {
    return false;
  }
}
