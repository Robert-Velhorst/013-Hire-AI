import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authMeQueryPolicy } from "./authQueryPolicy";

describe("auth.me query policy", () => {
  let client: QueryClient | undefined;

  afterEach(() => {
    client?.clear();
    client = undefined;
  });

  it("does not refetch a failed auth check when the gate remounts its child", async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryFn = vi.fn(async () => {
      throw new Error("API unavailable");
    });
    const queryOptions = {
      queryKey: ["auth", "me"],
      queryFn,
      ...authMeQueryPolicy,
    };
    const firstObserver = new QueryObserver(client, queryOptions);
    const unsubscribe = firstObserver.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(firstObserver.getCurrentResult().status).toBe("error");
    });
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
    firstObserver.destroy();

    const remountedObserver = new QueryObserver(client, queryOptions);
    const unsubscribeRemounted = remountedObserver.subscribe(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(remountedObserver.getCurrentResult().status).toBe("error");

    unsubscribeRemounted();
    remountedObserver.destroy();
  });
});
