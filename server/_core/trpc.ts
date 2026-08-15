import { INACTIVE_ACCOUNT_ERR_MSG, NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireActiveUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  const user = ctx.user;

  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (user.accountStatus !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: INACTIVE_ACCOUNT_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireActiveUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const user = ctx.user;

    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    if (user.accountStatus !== "active") {
      throw new TRPCError({ code: "FORBIDDEN", message: INACTIVE_ACCOUNT_ERR_MSG });
    }
    if (user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user,
      },
    });
  }),
);
