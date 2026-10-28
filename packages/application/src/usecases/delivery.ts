import type {
  ChannelAvailability,
  EmailContent,
  NotificationContentPolicy,
  PushDevice,
  PushPayload,
  SettledOutcome,
  SlackLink,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/*
 * 外への通知（端末・登録メールアドレス・Slack の DM）。通知 1 件ごとに、だれの・どの届け先へ・何を送るかを計画し、
 * 送った結果を記録する。送ること自体（暗号化・HTTP）はアダプタ（Convex の action）の仕事で、アクションは内容を知らない。
 * 失敗しても業務データは戻さない（§10-4）。アプリ内の通知が正本（§10-1）。
 */

/** 秘密を含まない、送る側の環境（Convex の lib/channels.ts が作る） */
export interface DeliveryEnv {
  available: ChannelAvailability;
  /** FRONTEND_URL。null なら email・slack は使えない扱い */
  origin: string | null;
  policy?: NotificationContentPolicy;
}

/** 送るものはすべて計画の中で描き終える（アクションは内容を知らない） */
export type DeliveryTarget =
  | { channel: "push"; key: `push:${string}`; device: PushDevice; payload: PushPayload }
  | { channel: "email"; key: "email"; to: string; content: EmailContent }
  | { channel: "slack"; key: "slack"; email: string; memberId: string | null; text: string };

export interface DeliveryPlan {
  notificationId: string;
  targets: DeliveryTarget[];
}

/** 記録に要る最小の手がかり（内容を持たない） */
export type DeliveryTargetRef =
  | { channel: "push"; key: `push:${string}`; subscriptionId: string }
  | { channel: "email"; key: "email" }
  | { channel: "slack"; key: "slack"; email: string; memberId: string | null };

/**
 * 通知 1 件を外へ届ける計画。無い・既読・止めた分類・届け先なしなら null。
 * 決着した届け先は含めない。送る時点の閲覧権限で伏せ直す（presentNotifications）。内容を決めるのは composeNotificationMessage の一度だけ
 */
export async function planDelivery(
  ctx: AppContext,
  notificationId: string,
  env: DeliveryEnv,
): Promise<DeliveryPlan | null> {
  void [ctx, notificationId, env];
  throw new Error("not implemented");
}

/**
 * 決着を記録し、経路ごとの後始末をする（端末: recordPushResult で失敗回数・購読の整理。Slack: 送った結果で状態を移す）。
 * Slack の状態が変わらなければ書かない（同じ人への並んだ配信の書き込みをぶつけない）
 */
export async function recordDelivery(
  ctx: AppContext,
  input: { notificationId: string; target: DeliveryTargetRef; outcome: SettledOutcome },
): Promise<void> {
  void [ctx, input];
  throw new Error("not implemented");
}

/** 登録メールアドレスで Slack を引いた結果 */
export type SlackLookupResult = { kind: "found"; memberId: string } | { kind: "not_found" };

/**
 * 引いた結果を、引いたメールアドレスの行に保存する（slackMembers を書くのは、このファイルの 2 関数だけ）。
 * 状態が変わらなければ書かない
 */
export async function recordSlackLookup(
  ctx: AppContext,
  email: string,
  result: SlackLookupResult,
): Promise<SlackLink> {
  void [ctx, email, result];
  throw new Error("not implemented");
}

/** Slack で引くメールアドレス（Slack をオンにしていて、送れるアドレスがあるときだけ） */
export async function slackLookupEmail(ctx: AppContext, userId: string): Promise<string | null> {
  void [ctx, userId];
  throw new Error("not implemented");
}
