import type { Instant } from "../shared/time.ts";
import {
  type AccountChannel,
  DELIVERY_CHANNELS,
  type DeliveryChannel,
  isCategoryMuted,
  type NotificationPrefs,
} from "./preferences.ts";
import { EMAIL_SHAPE } from "./email.ts";
import { type SlackLink, type SlackMembership, slackStep } from "./slack.ts";

/*
 * 外への通知の届け先（端末・登録メールアドレス・Slack の DM）。だれに・どの経路で・どこへ送るかを決める（純粋）。
 * 送ること自体と、運用者が秘密を置いたか（env）はアダプタ（Convex）の仕事。
 */

/** 運用者が秘密を置いた経路（Convex の lib/channels.ts が env から作る。domain は env を知らない） */
export type ChannelAvailability = ReadonlySet<DeliveryChannel>;

/** 届け先 1 つの冪等のキー（通知 × キーで一度だけ決着する） */
export type DestinationKey = "email" | "slack" | `push:${string}`;

/** 保存した文字列をキーに戻す。知らない形は null */
export function parseDestinationKey(s: string): DestinationKey | null {
  if (s === "email" || s === "slack") return s;
  const subscriptionId = s.startsWith("push:") ? s.slice("push:".length) : "";
  return subscriptionId ? `push:${subscriptionId}` : null;
}

export interface PushDevice {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type Destination =
  | { channel: "push"; key: `push:${string}`; device: PushDevice }
  | { channel: "email"; key: "email"; to: string }
  /** teamId は選んだワークスペース。memberId が null なら、送る前にそのワークスペースで email を引く */
  | { channel: "slack"; key: "slack"; teamId: string; email: string; memberId: string | null };

/**
 * 種類によらず届けうる経路。adapters の「予約するか」はこれが空でないかだけで決める。
 * push: 使えて端末がある。email・slack: 使えて利用者がオンにしている
 */
export function reachableChannels(input: {
  prefs: NotificationPrefs;
  available: ChannelAvailability;
  hasPushDevice: boolean;
}): DeliveryChannel[] {
  const { prefs, available, hasPushDevice } = input;
  return DELIVERY_CHANNELS.filter(
    (c) => available.has(c) && (c === "push" ? hasPushDevice : prefs.channels.includes(c)),
  );
}

/** この通知を届ける経路（止めた分類なら空。ほかは reachableChannels と同じ） */
export function wantedChannels(input: {
  kind: string;
  prefs: NotificationPrefs;
  available: ChannelAvailability;
  hasPushDevice: boolean;
}): DeliveryChannel[] {
  return isCategoryMuted(input.prefs, input.kind) ? [] : reachableChannels(input);
}

interface DestinationSources {
  devices: readonly PushDevice[];
  email: string | null;
  slack: SlackMembership | null;
  now: Instant;
}

/** 経路ごとの届け先の決め方（経路を足すと、ここに書くまで型が落ちる） */
const DESTINATIONS_OF: {
  [C in DeliveryChannel]: (s: DestinationSources) => Extract<Destination, { channel: C }>[];
} = {
  push: ({ devices }) =>
    devices.map((device) => ({ channel: "push", key: `push:${device.id}`, device })),
  email: ({ email }) => (email ? [{ channel: "email", key: "email", to: email }] : []),
  slack: ({ slack, now }) => {
    if (!slack) return [];
    const step = slackStep(slack.link, now);
    if (step.do === "skip") return [];
    const memberId = step.do === "post" ? step.memberId : null;
    return [{ channel: "slack", key: "slack", teamId: slack.teamId, email: slack.email, memberId }];
  },
};

/**
 * 届け先を決める（純粋）。宛先の無い経路、ワークスペースか引くアドレスの無い Slack（slack が null）、
 * Slack で今は送らない状態（slackStep が skip）は落とす
 */
export function destinationsOf(input: {
  channels: readonly DeliveryChannel[];
  devices: readonly PushDevice[];
  /** メールの宛先（Nogiku のアドレスを deliverableEmail に通したもの） */
  email: string | null;
  /** Slack の宛先（引くアドレスは slackAddressOf のもの） */
  slack: SlackMembership | null;
  now: Instant;
}): Destination[] {
  return DELIVERY_CHANNELS.filter((c) => input.channels.includes(c)).flatMap((c): Destination[] =>
    DESTINATIONS_OF[c](input),
  );
}

/** 送らないドメイン（RFC 2606・6761 の予約名）。そのもの・その下のドメインに送らない */
const RESERVED_DOMAINS = [
  "invalid",
  "test",
  "example",
  "localhost",
  "example.com",
  "example.net",
  "example.org",
];

/**
 * 送ってよいメールアドレス: 形が正しく（@ が 1 つ・空白なし・ドメインに点がある）、予約済みのドメイン
 * （.invalid・.test・.example・.localhost・example.com/net/org）でない。小文字にそろえる。
 * 試験・デモの利用者（*@example.invalid）には送らない
 */
export function deliverableEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase();
  if (!email || !EMAIL_SHAPE.test(email)) return null;
  const domain = email.slice(email.indexOf("@") + 1);
  const reserved = RESERVED_DOMAINS.some((r) => domain === r || domain.endsWith(`.${r}`));
  return reserved ? null : email;
}

/** 送り先が二度と受け付けない理由 */
export type RejectReason =
  | "gone"
  | "invalid_address"
  | "not_found"
  | "cannot_dm"
  | "invalid_content";

/** 1 つの届け先に送った結果（wire の応答は Convex の lib/* がこの形にする。wire の型は外に出さない） */
export type SendOutcome =
  | { kind: "sent"; httpStatus?: number }
  /** この通知 × 届け先では二度と送らない */
  | { kind: "rejected"; reason: RejectReason; httpStatus?: number }
  /** 一時的（429・5xx・つながらない）。記録せず workpool がやり直す */
  | { kind: "retry" }
  /** 運用側の問題（トークン無効・送信枠切れ・送信元ドメイン未確認・env が無い）。記録せず、やり直さず、ログに出す */
  | { kind: "unavailable"; reason: string };

/** 記録して決着する結果 */
export type SettledOutcome = Extract<SendOutcome, { kind: "sent" | "rejected" }>;

/** 設定画面の経路の状態（no_workspace: Slack のワークスペースを選んでいない・選んだ登録が消えた） */
export type ChannelStatus =
  | "ready"
  | "no_address"
  | "no_workspace"
  | "unresolved"
  | "not_found"
  | "cannot_dm";

const SLACK_STATUS: Record<SlackLink["state"], ChannelStatus> = {
  unresolved: "unresolved",
  linked: "ready",
  not_found: "not_found",
  cannot_dm: "cannot_dm",
};

/**
 * email: アドレスがあれば ready。slack: アドレス（slackAddressOf）が無ければ no_address、ワークスペースが無ければ
 * no_workspace、あればそのワークスペースでの状態（linked は ready）
 */
export function channelStatusOf(
  channel: AccountChannel,
  email: string | null,
  slack: SlackMembership | null,
): ChannelStatus {
  if (!email) return "no_address";
  switch (channel) {
    case "email":
      return "ready";
    case "slack":
      return slack ? SLACK_STATUS[slack.link.state] : "no_workspace";
  }
}
