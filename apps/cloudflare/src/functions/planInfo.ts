import { loadAuthorizedWork, syncPlanInfoWarnings } from "@mf100/application";
import { heuristicPlanInfoCompare } from "@mf100/domain";
import { z } from "zod";
import { mutation, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/planInfo.ts の写し（sync は alarm の仕事 planInfoSync。src/jobs.ts）

export const planInfo = {
  /**
   * 登録情報と本文の項目照合（decision 70A）。AI は heuristicPlanInfoCompare のスタブ。
   * 戻りを返すだけでなく warn-only の bot スレッドも同期するので mutation（Convex と同じ）
   */
  "planInfo:compare": mutation({
    auth: "user",
    args: object({ workId: z.string(), text: z.string() }),
    handler: async (ctx, args) => {
      const principal = ctx.principal!;
      const { work } = await loadAuthorizedWork(ctx.db, principal, args.workId, "work.view");
      const info = work.registeredPlanInfo;
      if (!info) return { items: [] };
      const items = await heuristicPlanInfoCompare.compare(args.text, info);
      await syncPlanInfoWarnings(ctx.db, principal, args.workId, { textOverride: args.text });
      return { items };
    },
  }),

  /** 企画情報と版本文の照合（warn-only bot スレッド。decision 71B） */
  "planInfo:check": mutation({
    auth: "user",
    args: object({ workId: z.string(), text: z.string().optional() }),
    handler: async (ctx, args) =>
      syncPlanInfoWarnings(
        ctx.db,
        ctx.principal!,
        args.workId,
        args.text !== undefined ? { textOverride: args.text } : {},
      ),
  }),
} satisfies Record<string, FnDef>;
