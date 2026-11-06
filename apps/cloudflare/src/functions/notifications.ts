import { query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

export const notifications = {
  // Convex は notificationCounters 表を読む。ここは集計の派生表を持たず、notifications を数える
  "notifications:unreadCount": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => ctx.db.notifications.countUnread(ctx.userId!),
  }),
} satisfies Record<string, FnDef>;
