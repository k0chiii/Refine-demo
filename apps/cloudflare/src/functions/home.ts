import { isWorkPinned, setWorkPinned } from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

export const home = {
  /** ホームにピン留め／外す */
  "home:setPinned": mutation({
    auth: "user",
    args: object({ workId: z.string(), pinned: z.boolean() }),
    handler: async (ctx, args) => setWorkPinned(ctx.db, ctx.principal!, args),
  }),

  // Convex の名前は `home:pinned`（`isPinned` ではない）。鍵は Convex の getFunctionName と同じにする
  "home:pinned": query({
    auth: "user",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }) => isWorkPinned(ctx.db, ctx.principal!, workId),
  }),
} satisfies Record<string, FnDef>;
