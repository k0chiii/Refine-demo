import {
  confirmIndependently,
  finalizeWork,
  getConfirmationStatus,
  reopenWork,
} from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { resolveUsers } from "./users.ts";
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

  /** 独立確認の状況（校了ダイアログと「情報」に出す）。制作物を見られる人だけが引ける */
  "approvals:confirmationStatus": query({
    auth: "user",
    args: object({ workId: vId }),
    handler: async (ctx, { workId }) => {
      const s = await getConfirmationStatus(ctx.db, ctx.principal!, { workId });
      const users = resolveUsers(ctx.sql, s.valid ? [s.valid.confirmerId] : []);
      return {
        required: s.required,
        requiredForMe: s.requiredForMe,
        candidateRevisionId: s.candidateRevisionId,
        valid: s.valid
          ? {
              confirmer: users.get(s.valid.confirmerId) ?? null,
              confirmedAt: s.valid.confirmedAt,
              note: s.valid.note ?? null,
            }
          : null,
        canConfirm: s.canConfirm,
        confirmedByMe: s.confirmedByMe,
      };
    },
  }),
} satisfies Record<string, FnDef>;
