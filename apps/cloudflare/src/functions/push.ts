import { isPushSubscribed, subscribePush, unsubscribePush } from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/push.ts の写し（端末への通知 Web Push。config は VAPID の鍵を読む別の単位）

export const push = {
  /** この端末（endpoint）に自分宛ての通知を送っているか */
  "push:status": query({
    auth: "user",
    args: object({ endpoint: z.string() }),
    handler: async (ctx, { endpoint }) => isPushSubscribed(ctx.db, ctx.principal!, endpoint),
  }),

  "push:subscribe": mutation({
    auth: "user",
    args: object({
      endpoint: z.string(),
      p256dh: z.string(),
      auth: z.string(),
      device: z.string().optional(),
    }),
    handler: async (ctx, args) => {
      await subscribePush(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  "push:unsubscribe": mutation({
    auth: "user",
    args: object({ endpoint: z.string() }),
    handler: async (ctx, { endpoint }) => unsubscribePush(ctx.db, ctx.principal!, endpoint),
  }),
} satisfies Record<string, FnDef>;
