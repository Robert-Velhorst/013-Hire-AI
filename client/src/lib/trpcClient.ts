import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";

export function createHireTrpcClient(
  url: string,
  fetchImplementation: typeof fetch = globalThis.fetch.bind(globalThis)
) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url,
        transformer: superjson,
        fetch(input, init) {
          return fetchImplementation(input, {
            ...(init ?? {}),
            credentials: "include",
          });
        },
      }),
    ],
  });
}
