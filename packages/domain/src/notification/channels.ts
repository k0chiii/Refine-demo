import type { Instant } from "../shared/time.ts";
import type { AccountChannel, DeliveryChannel, NotificationPrefs } from "./preferences.ts";
import type { SlackLink } from "./slack.ts";

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
  void s;
  throw new Error("not implemented");
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
  /** memberId が null なら、送る前に登録メールアドレスで引く */
  | { channel: "slack"; key: "slack"; email: string; memberId: string | null };

/**
 * 種類によらず届けうる経路。adapters の「予約するか」はこれが空でないかだけで決める。
 * push: 使えて端末がある。email・slack: 使えて利用者がオンにしている
 */
export function reachableChannels(input: {
  prefs: NotificationPrefs;
  available: ChannelAvailability;
  hasPushDevice: boolean;
}): DeliveryChannel[] {
  void input;
  throw new Error("not implemented");
}

/** この通知を届ける経路（止めた分類なら空。ほかは reachableChannels と同じ） */
export function wantedChannels(input: {
  kind: string;
  prefs: NotificationPrefs;
  available: ChannelAvailability;
  hasPushDevice: boolean;
}): DeliveryChannel[] {
  void input;
  throw new Error("not implemented");
}

/** 届け先を決める（純粋）。宛先の無い経路と、Slack で今は送らない状態（slackStep が skip）は落とす */
export function destinationsOf(input: {
  channels: readonly DeliveryChannel[];
  devices: readonly PushDevice[];
  /** deliverableEmail を通したもの */
  email: string | null;
  slack: SlackLink;
  now: Instant;
}): Destination[] {
  void input;
  throw new Error("not implemented");
}

/**
 * 送ってよいメールアドレス: 形が正しく（@ が 1 つ・空白なし・ドメインに点がある）、予約済みのドメイン
 * （.invalid・.test・.example・.localhost・example.com/net/org）でない。小文字にそろえる。
 * 試験・デモの利用者（*@example.invalid）には送らない
 */
export function deliverableEmail(raw: string | null | undefined): string | null {
  void raw;
  throw new Error("not implemented");
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

/** 設定画面の経路の状態 */
export type ChannelStatus = "ready" | "no_address" | "unresolved" | "not_found" | "cannot_dm";

/** email: アドレスがあれば ready。slack: アドレスが無ければ no_address、あれば Slack の状態（linked は ready） */
export function channelStatusOf(
  channel: AccountChannel,
  email: string | null,
  slack: SlackLink,
): ChannelStatus {
  void [channel, email, slack];
  throw new Error("not implemented");
}
