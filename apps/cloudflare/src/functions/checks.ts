import { addRequiredCheck, completeRequiredCheck, waiveRequiredCheck } from "@mf100/application";
import { z } from "zod";
import { mutation, type FnDef } from "./define.ts";
import { object, vCheckType, vId } from "./validators.ts";

// apps/convex/convex/checks.ts の写し

export const checks = {
  /** 専門確認（必須チェック）の追加（§2.2-4 / D6）。校正者割当権限者 */
  "checks:add": mutation({
    auth: "user",
    args: object({
      revisionId: vId,
      type: vCheckType,
      label: z.string().optional(),
      assigneeId: z.string().optional(),
    }),
    handler: async (ctx, args) => {
      const c = await addRequiredCheck(ctx.db, ctx.principal!, args);
      return c.id;
    },
  }),

  /** 確認完了。担当者本人、または主管・校了権限者の代行 */
  "checks:complete": mutation({
    auth: "user",
    args: object({ checkId: vId, note: z.string().optional() }),
    handler: async (ctx, args) => {
      const c = await completeRequiredCheck(ctx.db, ctx.principal!, args);
      return c.state;
    },
  }),

  /** 免除（理由必須・監査対象）。主管・校了権限者 */
  "checks:waive": mutation({
    auth: "user",
    args: object({ checkId: vId, reason: z.string() }),
    handler: async (ctx, args) => {
      const c = await waiveRequiredCheck(ctx.db, ctx.principal!, args);
      return c.state;
    },
  }),
} satisfies Record<string, FnDef>;
