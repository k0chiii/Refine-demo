"use node";

import type { DeliveryPlan, DeliveryTarget } from "@mf100/application";
import type { DeliveryChannel, DestinationKey, SendOutcome } from "@mf100/domain";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import type { DeliveryTargetArg } from "./delivery.ts";
import { type DeliveryConfig, deliveryConfigFromEnv } from "./lib/channels.ts";
import { sendEmail } from "./lib/email.ts";
import { lookupSlackMember, postSlackDm } from "./lib/slack.ts";
import { sendWebPush, webPushOutcome } from "./lib/webpush.ts";

/*
 * 外への通知を送る（端末・登録メールアドレス・Slack の DM）。Node ランタイムで動かす（Web Push の WebCrypto の ECDH・HKDF を確実に使うため）。
 * 送るたびに計画を読み直す（既読・閲覧権限・設定・宛先の変化を反映。delivery.plan）。内容は計画が描き終えている。
 */

/** 経路ごとの結果の数（ログに出す。deliver が返すのは送れた数） */
export interface DeliveryReport {
  sent: number;
  rejected: number;
  retry: number;
  unavailable: number;
}

/**
 * 通知 1 件の届け先に 1 つずつ送り、決着を記録する。送れた数を返す。
 * 一時的な失敗があれば最後に投げて workpool にやり直させる（決着した届け先は次の計画に入らない）
 */
export async function deliverNotification(ctx: ActionCtx, notificationId: string): Promise<number> {
  const config = deliveryConfigFromEnv(process.env);
  const attempted = new Set<DestinationKey>();
  const report: DeliveryReport = { sent: 0, rejected: 0, retry: 0, unavailable: 0 };
  for (;;) {
    const plan: DeliveryPlan | null = await ctx.runQuery(internal.delivery.plan, {
      notificationId,
    });
    const target = plan?.targets.find((t) => !attempted.has(t.key));
    if (!target) break;
    attempted.add(target.key);
    const { outcome, ref } = await send(ctx, target, config, notificationId);
    report[outcome.kind]++;
    if (outcome.kind === "sent" || outcome.kind === "rejected")
      await ctx.runMutation(internal.delivery.record, { notificationId, target: ref, outcome });
    else if (outcome.kind === "unavailable") logUnavailable(target.channel, outcome.reason);
  }
  if (attempted.size > 0)
    console.log(JSON.stringify({ event: "delivery_report", notificationId, ...report }));
  if (report.retry > 0) throw new Error("delivery_transient_failure");
  return report.sent;
}

/** 1 つの届け先に送った結果と、記録に渡す手がかり（Slack は送った相手のメンバー） */
interface Attempt {
  outcome: SendOutcome;
  ref: DeliveryTargetArg;
}

/** 計画は env の揃った経路だけを含むので、ここに来るのは計画と送る間に env が変わったときだけ */
const NOT_CONFIGURED = { kind: "unavailable", reason: "not_configured" } as const;

async function send(
  ctx: ActionCtx,
  t: DeliveryTarget,
  c: DeliveryConfig,
  notificationId: string,
): Promise<Attempt> {
  switch (t.channel) {
    case "push": {
      const ref = { channel: "push", subscriptionId: t.device.id } as const;
      if (!c.push) return { outcome: NOT_CONFIGURED, ref };
      try {
        const status = await sendWebPush(t.device, t.payload, c.push, { now: Date.now() });
        return { outcome: webPushOutcome(status), ref };
      } catch {
        // 暗号化で投げた（購読の鍵が壊れているなど）。つながらないときと同じくやり直しに回す
        return { outcome: { kind: "retry" }, ref };
      }
    }
    case "email": {
      const ref = { channel: "email", key: "email" } as const;
      if (!c.email) return { outcome: NOT_CONFIGURED, ref };
      const outcome = await sendEmail(
        c.email,
        { to: t.to, content: t.content },
        { idempotencyKey: `${notificationId}/email` },
      );
      return { outcome, ref };
    }
    case "slack":
      return c.slack
        ? sendSlack(ctx, t, c.slack.botToken)
        : { outcome: NOT_CONFIGURED, ref: slackRef(t, t.memberId) };
  }
}

type SlackTarget = Extract<DeliveryTarget, { channel: "slack" }>;

function slackRef(t: SlackTarget, memberId: string | null): DeliveryTargetArg {
  return { channel: "slack", key: "slack", email: t.email, memberId };
}

/** メンバーが分からなければ登録メールアドレスで引いて保存し、見つかったときだけ DM を送る */
async function sendSlack(ctx: ActionCtx, t: SlackTarget, token: string): Promise<Attempt> {
  let memberId = t.memberId;
  if (memberId === null) {
    const found = await lookupSlackMember(token, t.email);
    if (found.kind === "retry" || found.kind === "unavailable")
      return { outcome: found, ref: slackRef(t, null) };
    await ctx.runMutation(internal.delivery.recordSlackLookup, { email: t.email, result: found });
    if (found.kind === "not_found")
      return { outcome: { kind: "rejected", reason: "not_found" }, ref: slackRef(t, null) };
    memberId = found.memberId;
  }
  const outcome = await postSlackDm(token, memberId, t.text);
  return { outcome, ref: slackRef(t, memberId) };
}

export const deliver = internalAction({
  args: { notificationId: v.string() },
  handler: (ctx, { notificationId }): Promise<number> => deliverNotification(ctx, notificationId),
});

/**
 * Slack をオンにしたとき、登録メールアドレスで引き直す（今の状態によらない）。
 * やり直さない（引けなければ未確認のまま。次に送るときに引く）
 */
export const resolveSlack = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<null> => {
    const slack = deliveryConfigFromEnv(process.env).slack;
    if (!slack) return null;
    const email: string | null = await ctx.runQuery(internal.delivery.slackEmail, { userId });
    if (!email) return null;
    const result = await lookupSlackMember(slack.botToken, email);
    if (result.kind === "found" || result.kind === "not_found")
      await ctx.runMutation(internal.delivery.recordSlackLookup, { email, result });
    else if (result.kind === "unavailable") logUnavailable("slack", result.reason);
    else console.warn(JSON.stringify({ event: "slack_resolve_deferred" }));
    return null;
  },
});

/** 運用側の問題（鍵・権限・送信枠）。宛先・メンバー・本文はログに出さない */
function logUnavailable(channel: DeliveryChannel, reason: string): void {
  console.warn(JSON.stringify({ event: "delivery_unavailable", channel, reason }));
}
