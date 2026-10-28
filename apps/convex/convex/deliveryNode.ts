"use node";

import type { DeliveryPlan, DeliveryTarget, SlackMemberKey } from "@mf100/application";
import type { DeliveryChannel, DestinationKey, SendOutcome } from "@mf100/domain";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import type { DeliveryTargetArg } from "./delivery.ts";
import { type DeliveryConfig, deliveryConfigFromEnv } from "./lib/channels.ts";
import { sendEmail } from "./lib/email.ts";
import { sleepFor } from "./lib/retryAfter.ts";
import { lookupSlackMember, type MeichanConfig, postSlackDm } from "./lib/slack.ts";
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
        ? sendSlack(ctx, t, c.slack)
        : { outcome: NOT_CONFIGURED, ref: slackRef(t, t.memberId) };
  }
}

type SlackTarget = Extract<DeliveryTarget, { channel: "slack" }>;

function slackRef(t: SlackTarget, memberId: string | null): DeliveryTargetArg {
  return { channel: "slack", key: "slack", teamId: t.teamId, email: t.email, memberId };
}

/** DM の枠の時刻まで action の中で待つ上限（ms）。workpool の同時数（8）× 1 秒より長く、続けて送る分を待って届ける */
const SLACK_DM_MAX_WAIT_MS = 10_000;

/**
 * メンバーが分からなければ、選んだワークスペースで登録メールアドレスを引いて保存する。見つかったときだけ、
 * 速さ制限の枠を予約し、その時刻まで待って DM を送る（上限より先なら retry。workpool がやり直す）
 */
async function sendSlack(ctx: ActionCtx, t: SlackTarget, cfg: MeichanConfig): Promise<Attempt> {
  let memberId = t.memberId;
  if (memberId === null) {
    const found = await lookupSlackMember(cfg, { teamId: t.teamId, email: t.email });
    if (found.kind === "retry" || found.kind === "unavailable")
      return { outcome: found, ref: slackRef(t, null) };
    await ctx.runMutation(internal.delivery.recordSlackLookup, {
      teamId: t.teamId,
      email: t.email,
      result: found,
    });
    if (found.kind === "not_found")
      return { outcome: { kind: "rejected", reason: "not_found" }, ref: slackRef(t, null) };
    memberId = found.memberId;
  }
  const { ok, retryAfter } = await ctx.runMutation(internal.delivery.reserveSlackDm, {});
  if (!ok || retryAfter > SLACK_DM_MAX_WAIT_MS)
    return { outcome: { kind: "retry" }, ref: slackRef(t, memberId) };
  if (retryAfter > 0) await sleepFor(retryAfter);
  const outcome = await postSlackDm(cfg, { teamId: t.teamId, userId: memberId, text: t.text });
  return { outcome, ref: slackRef(t, memberId) };
}

export const deliver = internalAction({
  args: { notificationId: v.string() },
  handler: (ctx, { notificationId }): Promise<number> => deliverNotification(ctx, notificationId),
});

/**
 * Slack をオンにした・ワークスペースを替えたとき、選んだワークスペースで登録メールアドレスを引き直す（今の状態によらない）。
 * やり直さない（引けなければ未確認のまま。次に送るときに引く）
 */
export const resolveSlack = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<null> => {
    const slack = deliveryConfigFromEnv(process.env).slack;
    if (!slack) return null;
    const target: SlackMemberKey | null = await ctx.runQuery(internal.delivery.slackTarget, {
      userId,
    });
    if (!target) return null;
    const result = await lookupSlackMember(slack, target);
    if (result.kind === "found" || result.kind === "not_found")
      await ctx.runMutation(internal.delivery.recordSlackLookup, { ...target, result });
    else if (result.kind === "unavailable") logUnavailable("slack", result.reason);
    else console.warn(JSON.stringify({ event: "slack_resolve_deferred" }));
    return null;
  },
});

/** 運用側の問題（鍵・権限・送信枠）。宛先・メンバー・本文はログに出さない */
function logUnavailable(channel: DeliveryChannel, reason: string): void {
  console.warn(JSON.stringify({ event: "delivery_unavailable", channel, reason }));
}
