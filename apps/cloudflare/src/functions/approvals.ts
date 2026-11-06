import { confirmIndependently, finalizeWork, reopenWork } from "@mf100/application";
import { z } from "zod";
import { mutation, type FnDef } from "./define.ts";
import { object, vId } from "./validators.ts";

// apps/convex/convex/approvals.ts の写し

export const approvals = {
  /**
   * 校了宣言（U-07 / A-08 / A-10）。ガードはすべてドメイン側で評価する。
   * 自己校了（D2）の独立確認は、確認者本人が approvals:confirm で記録したものだけを使う（ここでは確認者を受け取らない）
   */
  "approvals:finalize": mutation({
    auth: "user",
    args: object({
      workId: vId,
      revisionId: vId,
      exceptionReason: z.string().optional(),
      expectedVersion: z.number().optional(),
      requestId: z.string().optional(),
      autoProofreadNote: z.string().optional(),
    }),
    handler: async (ctx, args) => {
      const { event, finalized, declared, quorum } = await finalizeWork(
        ctx.db,
        ctx.principal!,
        args,
      );
      // finalized が false のときは校了者 1 人の宣言を記録しただけ（校了とみなす人数に届いていない）
      return { action: event.action, createdAt: event.createdAt, finalized, declared, quorum };
    },
  }),

  /** 理由付き再開（A-09） */
  "approvals:reopen": mutation({
    auth: "user",
    args: object({ workId: vId, reason: z.string(), expectedVersion: z.number().optional() }),
    handler: async (ctx, args) => {
      const { event } = await reopenWork(ctx.db, ctx.principal!, args);
      return { action: event.action, createdAt: event.createdAt };
    },
  }),

  /** 独立確認（D2）。確認者はサインインしている本人に限る */
  "approvals:confirm": mutation({
    auth: "user",
    args: object({ revisionId: vId, note: z.string().optional() }),
    handler: async (ctx, args) => {
      const c = await confirmIndependently(ctx.db, ctx.principal!, args);
      return { id: c.id, revisionId: c.revisionId, confirmedAt: c.confirmedAt };
    },
  }),
} satisfies Record<string, FnDef>;
