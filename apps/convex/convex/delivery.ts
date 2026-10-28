import {
  type DeliveryPlan,
  type DeliveryTargetRef,
  planDelivery,
  recordDelivery,
  recordSlackLookup as recordSlackLookupFor,
  slackLookupEmail,
} from "@mf100/application";
import type { SlackLink } from "@mf100/domain";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { deliveryConfigFromEnv, deliveryEnvOf } from "./lib/channels.ts";
import { deliveryPool } from "./lib/deliveryPool.ts";

/*
 * 外への通知（端末・登録メールアドレス・Slack の DM）の内部関数。送るのは deliveryNode.deliver（通知 1 件に 1 回）。
 * 計画・記録の判断は usecases/delivery.ts。ここは引数の形を確かめて渡すだけ。
 */

/**
 * 通知ごとに deliveryNode.deliver を workpool に積む。workpool が同時数を抑え、一時的な失敗をやり直す。
 * 同じ予約の中で複数の通知を積むので、workpool の起動（batch-worker への ping）は 1 回で済む
 */
export async function enqueueDeliveries(ctx: MutationCtx, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const args = { notificationId: id };
    await deliveryPool.enqueueAction(ctx, internal.deliveryNode.deliver, args, {
      onComplete: internal.delivery.completed,
      context: args,
    });
  }
}

/** 通知を作ったトランザクションが予約する（1 トランザクションに 1 本。adapters がまとめる） */
export const enqueue = internalMutation({
  args: { notificationIds: v.array(v.string()) },
  handler: async (ctx, { notificationIds }) => {
    await enqueueDeliveries(ctx, notificationIds);
  },
});

/** 送る計画（deliveryNode.deliver が送る前に毎回読む） */
export const plan = internalQuery({
  args: { notificationId: v.string() },
  handler: (ctx, { notificationId }): Promise<DeliveryPlan | null> =>
    planDelivery(
      createReadContext(ctx.db),
      notificationId,
      deliveryEnvOf(deliveryConfigFromEnv(process.env)),
    ),
});

const targetRef = v.union(
  v.object({ channel: v.literal("push"), key: v.string(), subscriptionId: v.string() }),
  v.object({ channel: v.literal("email"), key: v.literal("email") }),
  v.object({
    channel: v.literal("slack"),
    key: v.literal("slack"),
    email: v.string(),
    memberId: v.union(v.string(), v.null()),
  }),
);

const rejectReason = v.union(
  v.literal("gone"),
  v.literal("invalid_address"),
  v.literal("not_found"),
  v.literal("cannot_dm"),
  v.literal("invalid_content"),
);

const settledOutcome = v.union(
  v.object({ kind: v.literal("sent"), httpStatus: v.optional(v.number()) }),
  v.object({
    kind: v.literal("rejected"),
    reason: rejectReason,
    httpStatus: v.optional(v.number()),
  }),
);

/** 端末の届け先のキーは購読から決まる（食い違う引数は受け付けない） */
function targetRefOf(t: Infer<typeof targetRef>): DeliveryTargetRef {
  if (t.channel !== "push") return t;
  const key = `push:${t.subscriptionId}` as const;
  if (t.key !== key) throw new Error("delivery_target_invalid");
  return { channel: "push", key, subscriptionId: t.subscriptionId };
}

/** 送った結果（決着したものだけ）を記録する */
export const record = internalMutation({
  args: { notificationId: v.string(), target: targetRef, outcome: settledOutcome },
  handler: async (ctx, { notificationId, target, outcome }) => {
    await recordDelivery(createAppContext(ctx), {
      notificationId,
      target: targetRefOf(target),
      outcome,
    });
  },
});

/** 登録メールアドレスで Slack を引いた結果を保存する */
export const recordSlackLookup = internalMutation({
  args: {
    email: v.string(),
    result: v.union(
      v.object({ kind: v.literal("found"), memberId: v.string() }),
      v.object({ kind: v.literal("not_found") }),
    ),
  },
  handler: (ctx, { email, result }): Promise<SlackLink> =>
    recordSlackLookupFor(createAppContext(ctx), email, result),
});

/** Slack で引くメールアドレス（引かないときは null） */
export const slackEmail = internalQuery({
  args: { userId: v.string() },
  handler: (ctx, { userId }): Promise<string | null> =>
    slackLookupEmail(createReadContext(ctx.db), userId),
});

/** workpool の 1 件が終わった（success・failed・canceled）。旧の push.completed も同じ */
export function logDeliveryComplete(notificationId: string, outcome: string): void {
  console.log(JSON.stringify({ event: "delivery_complete", notificationId, outcome }));
}

export const completed = deliveryPool.defineOnComplete({
  context: v.object({ notificationId: v.string() }),
  handler: async (_ctx, { context, result }) => {
    logDeliveryComplete(context.notificationId, result.kind);
  },
});
