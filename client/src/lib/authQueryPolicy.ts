export const authMeQueryPolicy = {
  retry: false,
  retryOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnMount: (query: { state: { status: string } }) =>
    query.state.status !== "error",
};
