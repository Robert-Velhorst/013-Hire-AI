import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getLoginUrl } from "./const";
import { reportApiMutationFailure, reportApiQueryFailure } from "./lib/apiErrorReporting";
import { createHireTrpcClient } from "./lib/trpcClient";
import "./index.css";

const queryClient = new QueryClient();

const loadAnalytics = () => {
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT;
  const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID;
  if (!endpoint || !websiteId) return;

  let scriptUrl: URL;
  try {
    scriptUrl = new URL("/umami", endpoint);
  } catch {
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = scriptUrl.toString();
  script.dataset.websiteId = websiteId;
  document.head.appendChild(script);
};

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return false;
  if (typeof window === "undefined") return false;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return false;

  window.location.href = getLoginUrl();
  return true;
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    if (!redirectToLoginIfUnauthorized(error)) {
      reportApiQueryFailure(error);
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    if (!redirectToLoginIfUnauthorized(error)) {
      reportApiMutationFailure(error);
    }
  }
});

const trpcClient = createHireTrpcClient("/api/trpc");

loadAnalytics();

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
