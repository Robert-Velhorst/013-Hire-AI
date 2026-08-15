import { TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { HttpError } from "../../shared/_core/errors";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 503) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: error.message,
        cause: error,
      });
    }
    if (!(error instanceof HttpError) || error.statusCode < 400 || error.statusCode >= 500) {
      throw error;
    }
    // Invalid or unauthorized sessions remain optional for public procedures.
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
