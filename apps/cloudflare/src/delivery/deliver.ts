import {
  type AppContext,
  type DeliveryPlan,
  type DeliveryTarget,
  type DeliveryTargetRef,
  planDelivery,
  recordDelivery,
  recordSlackLookup,
  type SlackLookupResult,
  slackLookupTarget,
} from "@mf100/application";
import type { DeliveryChannel, DestinationKey, RejectReason, SendOutcome } from "@mf100/domain";
import {
  type DeliveryConfig,
  type DeliveryVars,
  deliveryConfigFromEnv,
  deliveryEnvOf,
} from "./channels.ts";
import { sendEmail } from "./email.ts";
import { type Fetch, type Sleep, sleepFor } from "./http.ts";
import { type MeichanConfig, resolveSlackMember, sendSlackDm } from "./slack.ts";
import { sendWebPush, webPushOutcome } from "./webpush.ts";

/*
 * 外への通知を送る（端末・Nogiku のメールアドレス・Slack の DM）。Convex の deliveryNode.ts / delivery.ts の写し。
 * 送るたびに計画を読み直す（既読・閲覧権限・設定・宛先の変化を反映）。内容は計画が描き終えている。
 * Convex では一時的な失敗を投げて workpool にやり直させたが、ここでは投げない。retry: true で返し、
 * やり直しの予定は alarm 側が DELIVERY_RETRY に従って立てる（決着した届け先は次の計画に入らないので、何度呼んでも二重に送らない）。
 */

/** やり直しの方針（Convex の workpool: maxAttempts 4・initialBackoffMs 1000・base 2 と同じ。待ちは 1 回目の失敗の後から数える） */
export const DELIVERY_RETRY = { attempts: 4, backoffMs: [1000, 2000, 4000] };

/** failed 回目の失敗の後に待つ ms。試行を使い切ったら null（alarm はあきらめてログに出す） */
export function nextRetryDelayMs(failed: number): number | null {
  return failed >= DELIVERY_RETRY.attempts ? null : (DELIVERY_RETRY.backoffMs[failed - 1] ?? null);
}

/** 呼び出し側（alarm）が渡す外の世界 */
export interface DeliveryIo {
  fetch: Fetch;
  now: () => number;
  /** 速さ制限の Retry-After と DM の枠を待つ。省略は setTimeout */
  sleep?: Sleep;
  /**
   * DM の枠（1 秒に 1 件。めいちゃんの制限）を先の時刻まで予約する。retryAfter はその時刻までの ms（すぐ送れるなら 0）。
   * ponytail: 省略したら枠を使わず、すぐ送る。DO 1 つで通知を順に送るなら要らないが、並べて送るなら alarm 側が渡す
   */
  reserveSlackDm?: () => Promise<{ ok: boolean; retryAfter: number }>;
}

export interface DeliveryResult {
  /** 送れて記録した届け先 */
  sent: DestinationKey[];
  /** 二度と送らないと決まって記録した届け先 */
  rejected: Array<{ key: DestinationKey; reason: RejectReason }>;
  /** 運用側の問題（鍵・権限・送信枠）。記録せず、やり直しにも回さない（直せば次の通知から送れる） */
  unavailable: Array<{ key: DestinationKey; reason: string }>;
  /** 一時的な失敗（429・5xx・つながらない）が 1 つでもあった。alarm がやり直しを予定する */
  retry: boolean;
  /** 端末のプッシュサービスが返した Retry-After（ms。上限なし）の最大。あれば次の予定の下限にする */
  retryAfterMs?: number;
}

/** 計画は env の揃った経路だけを含むので、ここに来るのは計画と送る間に env が変わったときだけ */
const NOT_CONFIGURED = { kind: "unavailable", reason: "not_configured" } as const;

/** 1 つの届け先に送った結果と、記録に渡す手がかり（Slack は送った相手のメンバー） */
interface Attempt {
  outcome: SendOutcome;
  ref: DeliveryTargetRef;
  retryAfterMs?: number;
}

/**
 * 通知 1 件の届け先に 1 つずつ送り、決着を記録する。
 * env は Worker の env（秘密と FRONTEND_URL を channels.ts が読む）
 */
export async function deliverNotification(
  ctx: AppContext,
  notificationId: string,
  env: DeliveryVars,
  io: DeliveryIo,
): Promise<DeliveryResult> {
  const config = deliveryConfigFromEnv(env);
  const planEnv = deliveryEnvOf(config);
  const attempted = new Set<DestinationKey>();
  const result: DeliveryResult = { sent: [], rejected: [], unavailable: [], retry: false };
  const targets: Array<{ channel: DeliveryChannel } & SendOutcome> = [];
  for (;;) {
    const plan: DeliveryPlan | null = await planDelivery(ctx, notificationId, planEnv);
    const target = plan?.targets.find((t) => !attempted.has(t.key));
    if (!target) break;
    attempted.add(target.key);
    const { outcome, ref, retryAfterMs } = await send(ctx, target, config, notificationId, io);
    targets.push({ channel: target.channel, ...outcome });
    switch (outcome.kind) {
      case "sent":
        await recordDelivery(ctx, { notificationId, target: ref, outcome });
        result.sent.push(target.key);
        break;
      case "rejected":
        await recordDelivery(ctx, { notificationId, target: ref, outcome });
        result.rejected.push({ key: target.key, reason: outcome.reason });
        break;
      case "retry":
        result.retry = true;
        if (retryAfterMs !== undefined)
          result.retryAfterMs = Math.max(result.retryAfterMs ?? 0, retryAfterMs);
        break;
      case "unavailable":
        result.unavailable.push({ key: target.key, reason: outcome.reason });
        logUnavailable(target.channel, outcome.reason);
        break;
    }
  }
  // 届け先ごとの結果をログに出す。宛先・本文は含めない
  if (attempted.size > 0)
    console.log(
      JSON.stringify({
        event: "delivery_report",
        notificationId,
        sent: result.sent.length,
        rejected: result.rejected.length,
        retry: targets.filter((t) => t.kind === "retry").length,
        unavailable: result.unavailable.length,
        targets,
      }),
    );
  return result;
}

async function send(
  ctx: AppContext,
  t: DeliveryTarget,
  c: DeliveryConfig,
  notificationId: string,
  io: DeliveryIo,
): Promise<Attempt> {
  switch (t.channel) {
    case "push": {
      const ref = { channel: "push", key: t.key, subscriptionId: t.device.id } as const;
      if (!c.push) return { outcome: NOT_CONFIGURED, ref };
      try {
        const { status, retryAfterMs } = await sendWebPush(
          { subscription: t.device, payload: t.payload, vapid: c.push, now: io.now() },
          io.fetch,
        );
        return {
          outcome: webPushOutcome(status),
          ref,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        };
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
        { idempotencyKey: `${notificationId}/email`, fetch: io.fetch, ...sleepOf(io) },
      );
      return { outcome, ref };
    }
    case "slack":
      return c.slack
        ? sendSlack(ctx, t, c.slack, io)
        : { outcome: NOT_CONFIGURED, ref: slackRef(t, t.memberId) };
  }
}

const sleepOf = (io: DeliveryIo) => (io.sleep ? { sleep: io.sleep } : {});

type SlackTarget = Extract<DeliveryTarget, { channel: "slack" }>;

function slackRef(t: SlackTarget, memberId: string | null): DeliveryTargetRef {
  return { channel: "slack", key: "slack", teamId: t.teamId, email: t.email, memberId };
}

/** DM の枠の時刻まで待つ上限（ms）。これより先なら待たずに retry にして、alarm にやり直させる */
const SLACK_DM_MAX_WAIT_MS = 10_000;

/**
 * メンバーが分からなければ、選んだワークスペースで Nogiku のメールアドレスを引いて保存する。見つかったときだけ、
 * 速さ制限の枠を予約し、その時刻まで待って DM を送る（上限より先なら retry）
 */
async function sendSlack(
  ctx: AppContext,
  t: SlackTarget,
  cfg: MeichanConfig,
  io: DeliveryIo,
): Promise<Attempt> {
  const http = { fetch: io.fetch, ...sleepOf(io) };
  let memberId = t.memberId;
  if (memberId === null) {
    const found = await resolveSlackMember(cfg, { teamId: t.teamId, email: t.email }, http);
    if (found.kind === "retry" || found.kind === "unavailable")
      return { outcome: found, ref: slackRef(t, null) };
    await recordSlackLookup(ctx, { teamId: t.teamId, email: t.email }, found);
    if (found.kind === "not_found")
      return { outcome: { kind: "rejected", reason: "not_found" }, ref: slackRef(t, null) };
    memberId = found.memberId;
  }
  const slot = (await io.reserveSlackDm?.()) ?? { ok: true, retryAfter: 0 };
  if (!slot.ok || slot.retryAfter > SLACK_DM_MAX_WAIT_MS)
    return { outcome: { kind: "retry" }, ref: slackRef(t, memberId) };
  if (slot.retryAfter > 0) await (io.sleep ?? sleepFor)(slot.retryAfter);
  const outcome = await sendSlackDm(
    cfg,
    { teamId: t.teamId, userId: memberId, text: t.text },
    http,
  );
  return { outcome, ref: slackRef(t, memberId) };
}

/** Slack を引き直した結果。引かなかった（めいちゃんなし・宛先なし）は skipped */
export type ResolveSlackResult =
  | SlackLookupResult
  | { kind: "skipped" }
  | { kind: "retry" }
  | { kind: "unavailable"; reason: string };

/**
 * Slack をオンにした・ワークスペースを替えたとき、選んだワークスペースで Nogiku のメールアドレスを引き直す（今の状態によらない）。
 * やり直さない（引けなければ未確認のまま。次に送るときに引く）。retry は返すだけで、予定は立てない
 */
export async function resolveSlackForUser(
  ctx: AppContext,
  userId: string,
  env: DeliveryVars,
  io: Pick<DeliveryIo, "fetch" | "sleep">,
): Promise<ResolveSlackResult> {
  const slack = deliveryConfigFromEnv(env).slack;
  if (!slack) return { kind: "skipped" };
  const target = await slackLookupTarget(ctx, userId);
  if (!target) return { kind: "skipped" };
  const result = await resolveSlackMember(slack, target, io);
  if (result.kind === "found" || result.kind === "not_found")
    await recordSlackLookup(ctx, target, result);
  else if (result.kind === "unavailable") logUnavailable("slack", result.reason);
  else
    console.warn(
      JSON.stringify({
        event: "slack_resolve_deferred",
        teamId: target.teamId,
        email: target.email,
      }),
    );
  return result;
}

/** 運用側の問題（鍵・権限・送信枠）。宛先・メンバー・本文はログに出さない */
function logUnavailable(channel: DeliveryChannel, reason: string): void {
  console.warn(JSON.stringify({ event: "delivery_unavailable", channel, reason }));
}
