import { isWorkPinned, listSubmitTargets, setWorkPinned } from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnCtx, type FnDef } from "./define.ts";
import { object } from "./validators.ts";
import { WORKS_SCAN_LIMIT } from "./workList.ts";

/** 進行中の制作物（書ける・提出できる候補。権限は use case が確かめる） */
export async function activeWorks(ctx: FnCtx) {
  return (await ctx.db.works.list(WORKS_SCAN_LIMIT)).filter((w) => w.lifecycle === "active");
}

export const home = {
  /**
   * FAB「版を提出」の候補: 自分が版を提出できる進行中の制作物（納期順）。
   * ponytail: Convex は職責・ACL の索引で「自分が関わる制作物」に絞ってから渡す。ここは進行中を全件渡す
   * （閲覧・提出の権限は listSubmitTargets が必ず確かめるので結果は同じ。読みが多いだけ）
   */
  "home:submitTargets": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => {
      return listSubmitTargets(ctx.db, ctx.principal!, await activeWorks(ctx));
    },
  }),

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
