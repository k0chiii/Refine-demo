import {
  confirmIndependently,
  finalizeWork,
  getConfirmationStatus,
  reopenWork,
} from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";

/**
 * 校了宣言（U-07 / A-08 / A-10）。ガードはすべてドメイン側で評価する。
 * 自己校了（D2）の独立確認は、確認者本人が {@link confirm} で記録したものだけを使う（ここでは確認者を受け取らない）。
 */
export const finalize = mutation({
  args: {
    workId: v.id("works"),
    revisionId: v.id("revisions"),
    exceptionReason: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    requestId: v.optional(v.string()),
    autoProofreadNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const { event, finalized, declared, quorum } = await finalizeWork(
        createAppContext(ctx),
        principal,
        args,
      );
      // finalized が false のときは校了者 1 人の宣言を記録しただけ（校了とみなす人数に届いていない）
      return { action: event.action, createdAt: event.createdAt, finalized, declared, quorum };
    });
  },
});

/** 理由付き再開（A-09）。 */
export const reopen = mutation({
  args: { workId: v.id("works"), reason: v.string(), expectedVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const { event } = await reopenWork(createAppContext(ctx), principal, args);
      return { action: event.action, createdAt: event.createdAt };
    });
  },
});

/**
 * 独立確認（D2）。制作者・校了権限者以外の、制作物の確認に参加できる人が、
 * 自分の操作で校了候補の版を確認したと記録する。確認者はサインインしている本人に限る。
 */
export const confirm = mutation({
  args: { revisionId: v.id("revisions"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const c = await confirmIndependently(createAppContext(ctx), principal, args);
      return { id: c.id, revisionId: c.revisionId, confirmedAt: c.confirmedAt };
    });
  },
});

/** 独立確認の状況（校了ダイアログと「情報」に出す）。制作物を見られる人だけが引ける。 */
export const confirmationStatus = query({
  args: { workId: v.id("works") },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const s = await getConfirmationStatus(createReadContext(ctx.db), principal, { workId });
      const users = await resolveUsers(ctx.db, s.valid ? [s.valid.confirmerId] : []);
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
    });
  },
});
