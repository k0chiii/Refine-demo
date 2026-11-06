import { syncPlanInfoWarnings } from "@mf100/application";
import { z } from "zod";
import { mutation, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/planInfo.ts の写し（compare は domain の突き合わせを足す別の単位。sync は alarm から呼ばれる内部関数で U6）

export const planInfo = {
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
