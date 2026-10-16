export function getApplicationEmailPanelPolicy(
  applicationStatus: string,
  hasDelivery: boolean,
  isEligible: boolean,
) {
  const canPrepare = applicationStatus === "pending" && isEligible;
  return {
    visible: canPrepare || hasDelivery,
    canPrepare,
  };
}
