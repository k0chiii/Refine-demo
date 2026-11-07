import { isPushSubscribed, subscribePush, unsubscribePush } from "@mf100/application";
import { vapidKeysFromEnv } from "@mf100/platform";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/push.ts の写し（端末への通知 Web Push。enqueue / completed は Convex の旧い予約の名残なので移さない）

export const push = {
  /** ブラウザに渡す公開鍵。鍵（VAPID_PUBLIC_KEY・VAPID_PRIVATE_KEY・VAPID_SUBJECT）が揃わない環境では null */
  "push:config": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => {
      const keys = vapidKeysFromEnv(ctx.env);
      return keys ? { publicKey: keys.publicKey } : null;
    },
  }),

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
