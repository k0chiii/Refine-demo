import {
  type ChannelAvailability,
  composeNotificationMessage,
  deliverableEmail,
  deliversEvenIfRead,
  type Destination,
  destinationsOf,
  type EmailContent,
  nextSlackLink,
  normalizeNotificationPrefs,
  type NotificationContentPolicy,
  type NotificationMessage,
  type NotificationPrefs,
  type PushDevice,
  type PushPayload,
  type SettledOutcome,
  type SlackLink,
  type SlackMembership,
  type SlackObservation,
  slackAddressOf,
  toEmail,
  toPushPayload,
  toSlackText,
  type UserId,
  wantedChannels,
} from "@mf100/domain";
import type { AppContext, Notification } from "../ports.ts";
import { principalOf } from "../shared.ts";
import { presentNotifications } from "./notifications.ts";
import { recordPushResult } from "./push.ts";

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
  | {
      channel: "slack";
      key: "slack";
      teamId: string;
      email: string;
      memberId: string | null;
      text: string;
    };

export interface DeliveryPlan {
  notificationId: string;
  targets: DeliveryTarget[];
}

/** 記録に要る最小の手がかり（内容を持たない） */
export type DeliveryTargetRef =
  | { channel: "push"; key: `push:${string}`; subscriptionId: string }
  | { channel: "email"; key: "email" }
  | { channel: "slack"; key: "slack"; teamId: string; email: string; memberId: string | null };

/** Slack で引く宛先（選んだワークスペースの team_id と、引くアドレス（slackAddressOf）） */
export interface SlackMemberKey {
  teamId: string;
  email: string;
}

/**
 * 通知 1 件を外へ届ける計画。無い・既読（テスト通知を除く。deliversEvenIfRead）・止めた分類・届け先なしなら null。
 * 決着した届け先は含めない。送る時点の閲覧権限で伏せ直す（presentNotifications）。内容を決めるのは composeNotificationMessage の一度だけ
 */
export async function planDelivery(
  ctx: AppContext,
  notificationId: string,
  env: DeliveryEnv,
): Promise<DeliveryPlan | null> {
  const n = await ctx.notifications.findById(notificationId);
  if (!n || (n.readAt !== undefined && !deliversEvenIfRead(n.kind))) return null;
  // 読むのは、使える経路が要るものだけ（Convex のトランザクションの読み取りを増やさない）
  const available = usableChannels(env);
  if (available.size === 0) return null;
  const prefs = normalizeNotificationPrefs(await ctx.notificationPrefs.find(n.recipientId));
  const devices = available.has("push")
    ? (await ctx.pushSubscriptions.listByUser(n.recipientId)).map(
        ({ id, endpoint, p256dh, auth }): PushDevice => ({ id, endpoint, p256dh, auth }),
      )
    : [];
  const channels = wantedChannels({
    kind: n.kind,
    prefs,
    available,
    hasPushDevice: devices.length > 0,
  });
  if (channels.length === 0) return null;
  const email =
    channels.includes("email") || channels.includes("slack")
      ? await deliverableEmailOf(ctx, n.recipientId)
      : null;
  const slackEmail = channels.includes("slack") ? slackAddressOf(prefs, email) : null;
  const slack = slackEmail ? await slackMembershipOf(ctx, prefs, slackEmail) : null;
  const settled = new Set(await ctx.deliveries.listSettled(n.id));
  const destinations = destinationsOf({
    channels,
    devices,
    email,
    slack,
    now: ctx.clock.now(),
  }).filter((d) => !settled.has(d.key));
  if (destinations.length === 0) return null;
  const message = await composeAtSendTime(ctx, n, prefs.showPreview, env.policy);
  const unread = destinations.some((d) => d.channel === "push")
    ? await ctx.notifications.countUnread(n.recipientId)
    : 0;
  return {
    notificationId: n.id,
    targets: destinations.map((d) => targetOf(d, message, unread, env.origin)),
  };
}

/** 使える経路。メール・Slack は画面へのリンクを載せるので、オリジン（FRONTEND_URL）が無ければ使わない */
function usableChannels(env: DeliveryEnv): ChannelAvailability {
  return env.origin === null
    ? new Set([...env.available].filter((c) => c === "push"))
    : env.available;
}

/** 選んだワークスペースでのその人の宛先。選んでいない・登録が消えたなら null（送らない） */
async function slackMembershipOf(
  ctx: AppContext,
  prefs: NotificationPrefs,
  email: string,
): Promise<SlackMembership | null> {
  const workspace = prefs.slackWorkspaceId
    ? await ctx.slackWorkspaces.findById(prefs.slackWorkspaceId)
    : null;
  if (!workspace) return null;
  return {
    teamId: workspace.teamId,
    email,
    link: await ctx.slackMembers.find(workspace.teamId, email),
  };
}

/** 送ってよい登録メールアドレス（無い・送れない形・試験用のドメインなら null） */
async function deliverableEmailOf(ctx: AppContext, userId: UserId): Promise<string | null> {
  return deliverableEmail((await ctx.people.profiles([userId]))[0]?.email);
}

/**
 * 送る時点で閲覧権限を確かめ直してから、外に出す内容を決める（作った後に ACL が外れたら、送り主・抜粋ごと伏せる）。
 * 「通知に内容を表示」が切ってあれば、送り主と抜粋を載せない
 */
async function composeAtSendTime(
  ctx: AppContext,
  n: Notification,
  showPreview: boolean,
  policy: NotificationContentPolicy | undefined,
): Promise<NotificationMessage> {
  // 受信者の担当の所属も添えて presentNotifications と同じ判定にする
  const [shown] = await presentNotifications(
    ctx,
    principalOf(n.recipientId, await ctx.teams.list()),
    [n],
  );
  const hidden = n.workId !== undefined && shown?.workId === undefined;
  const work = !hidden && n.workId ? await ctx.works.findById(n.workId) : null;
  const notification = shown ?? n;
  const actorName =
    showPreview && (policy?.showPreview ?? true) && !hidden && notification.actorId
      ? await ctx.people.displayName(notification.actorId).catch(() => null)
      : null;
  return composeNotificationMessage({
    notification,
    work: work ? { title: work.title } : null,
    hidden,
    actorName,
    showPreview,
    ...(policy ? { policy } : {}),
  });
}

function targetOf(
  d: Destination,
  m: NotificationMessage,
  unread: number,
  origin: string | null,
): DeliveryTarget {
  if (d.channel === "push") return { ...d, payload: toPushPayload(m, unread) };
  // usableChannels がオリジンの無いときのメール・Slack を落としている
  if (origin === null) throw new Error("delivery_origin_missing");
  return d.channel === "email"
    ? { ...d, content: toEmail(m, origin) }
    : { ...d, text: toSlackText(m, origin) };
}

/**
 * 決着を記録し、経路ごとの後始末をする（端末: recordPushResult で失敗回数・購読の整理。Slack: 送った結果で状態を移す）。
 * Slack の状態が変わらなければ書かない（同じ人への並んだ配信の書き込みをぶつけない）
 */
export async function recordDelivery(
  ctx: AppContext,
  input: { notificationId: string; target: DeliveryTargetRef; outcome: SettledOutcome },
): Promise<void> {
  const { notificationId, target, outcome } = input;
  const at = ctx.clock.now();
  await ctx.deliveries.settle({
    notificationId,
    destination: target.key,
    outcome: outcome.kind,
    ...(outcome.kind === "rejected" ? { reason: outcome.reason } : {}),
    at,
  });
  switch (target.channel) {
    case "push":
      await recordPushResult(ctx, target.subscriptionId, pushStatusOf(outcome));
      return;
    case "email":
      return;
    case "slack": {
      const observation = slackPostObservation(target.memberId, outcome, at);
      if (observation) await observeSlack(ctx, target, observation);
      return;
    }
  }
}

/** recordPushResult は HTTP の状態で数える。状態の無い結果は、同じ扱いになる状態に読み替える */
function pushStatusOf(outcome: SettledOutcome): number {
  if (outcome.httpStatus !== undefined) return outcome.httpStatus;
  if (outcome.kind === "sent") return 201;
  return outcome.reason === "gone" ? 410 : 400;
}

/** DM を送った結果が示すこと。送っていない（メンバーが分からなかった）・ほかの理由で断られたなら無し */
function slackPostObservation(
  memberId: string | null,
  outcome: SettledOutcome,
  at: number,
): SlackObservation | null {
  if (memberId === null) return null;
  if (outcome.kind === "sent") return { type: "post_ok", memberId, at };
  return outcome.reason === "cannot_dm" ? { type: "post_cannot_dm", memberId, at } : null;
}

/** Slack の状態を観測で移す。slackMembers を書くのはここだけで、状態が変わらなければ書かない */
async function observeSlack(
  ctx: AppContext,
  { teamId, email }: SlackMemberKey,
  observation: SlackObservation,
): Promise<SlackLink> {
  const prev = await ctx.slackMembers.find(teamId, email);
  const next = nextSlackLink(prev, observation);
  if (next !== prev && next.state !== "unresolved")
    await ctx.slackMembers.save(teamId, email, next);
  return next;
}

/** 登録メールアドレスで Slack を引いた結果 */
export type SlackLookupResult = { kind: "found"; memberId: string } | { kind: "not_found" };

/** 引いた結果を、引いたワークスペース × メールアドレスの行に保存する（状態が変わらなければ書かない） */
export async function recordSlackLookup(
  ctx: AppContext,
  key: SlackMemberKey,
  result: SlackLookupResult,
): Promise<SlackLink> {
  const at = ctx.clock.now();
  return observeSlack(
    ctx,
    key,
    result.kind === "found"
      ? { type: "lookup_found", memberId: result.memberId, at }
      : { type: "lookup_not_found", at },
  );
}

/**
 * Slack で引く宛先（Slack をオンにしていて、登録にあるワークスペースを選び、引くアドレスがあるときだけ）。
 * アドレスは書いた Slack のメールアドレス、無ければ送ってよい Nogiku のアドレス（§110）
 */
export async function slackLookupTarget(
  ctx: AppContext,
  userId: string,
): Promise<SlackMemberKey | null> {
  const prefs = normalizeNotificationPrefs(await ctx.notificationPrefs.find(userId));
  if (!prefs.channels.includes("slack") || !prefs.slackWorkspaceId) return null;
  const workspace = await ctx.slackWorkspaces.findById(prefs.slackWorkspaceId);
  const email = workspace ? slackAddressOf(prefs, await deliverableEmailOf(ctx, userId)) : null;
  return workspace && email ? { teamId: workspace.teamId, email } : null;
}
