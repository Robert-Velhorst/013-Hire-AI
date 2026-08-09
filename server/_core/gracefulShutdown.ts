import type { Server } from "http";

const SHUTDOWN_FAILURE = "Runtime shutdown could not complete.";

type ClosableServer = Pick<Server, "close">;
type Stopper = () => Promise<void> | void;

export async function drainRuntime(server: ClosableServer, stoppers: Stopper[]): Promise<void> {
  // Calling close immediately stops new connections before background workers
  // begin draining. Individual failures must not prevent sibling cleanup.
  const listenerClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  const operations = [
    listenerClosed,
    ...stoppers.map((stop) => Promise.resolve().then(stop)),
  ];
  const results = await Promise.allSettled(operations);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error(SHUTDOWN_FAILURE);
  }
}
