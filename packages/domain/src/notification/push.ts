import { DomainError } from "../shared/DomainError.ts";
import type { NotificationContentPolicy } from "./message.ts";

/*
 * 通知の配信（Web Push）。利用者決定 2026-10-15「Web Push 進めて」（外部への実データ送信の承認）。
 * 送り先は Apple・Google・Mozilla・Microsoft のプッシュサービス。本文は端末の鍵で暗号化される（RFC 8291）が、
 * サービスを経由するので、載せる内容は message.ts で決めた最小限にする。
 */

/**
 * 端末の通知に載せる内容のポリシー値（旧名。中身は NotificationContentPolicy）。
 * 端末に載せる抜粋は notify が渡した短い抜粋だけ（確認観点・理由・締切などの本文は載せない）。
 */
export type PushContentPolicy = NotificationContentPolicy;

/**
 * 受け付けるプッシュサービス（購読の送り先。利用者が送ってくる URL なので、ここに無い宛先には送らない）。
 * 末尾一致（サブドメインを含む）。
 */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  "fcm.googleapis.com", // Chrome・Edge（Android）・Samsung Internet
  "push.apple.com", // Safari（iOS 16.4+ のホーム画面のアプリ・macOS）
  "push.services.mozilla.com", // Firefox
  "notify.windows.com", // Edge（Windows）
];

export interface PushSubscriptionInput {
  endpoint: string;
  /** 端末の公開鍵（P-256、非圧縮 65 バイト）の base64url */
  p256dh: string;
  /** 認証用の秘密（16 バイト）の base64url */
  auth: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+=*$/;

function base64urlBytes(s: string): number {
  const body = s.replace(/=+$/, "");
  return Math.floor((body.length * 3) / 4);
}

/** 購読の形を確かめる（宛先は既知のプッシュサービスの https だけ。鍵は長さまで見る） */
export function validatePushSubscription(input: PushSubscriptionInput): PushSubscriptionInput {
  // URL の解析は環境に頼らず自前で行う（domain は DOM・Node の型を持たない）
  const m = /^https:\/\/([^/?#]+)(?:[/?#]|$)/.exec(input.endpoint);
  const authority = m?.[1] ?? "";
  const host = authority.replace(/:\d+$/, "").toLowerCase();
  const known = PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!m || authority.includes("@") || !/^[a-z0-9.-]+$/.test(host) || !known)
    throw new DomainError("push_subscription_invalid", { field: "endpoint" });
  if (input.endpoint.length > 2048)
    throw new DomainError("push_subscription_invalid", { field: "endpoint" });
  if (!BASE64URL.test(input.p256dh) || base64urlBytes(input.p256dh) !== 65)
    throw new DomainError("push_subscription_invalid", { field: "p256dh" });
  if (!BASE64URL.test(input.auth) || base64urlBytes(input.auth) !== 16)
    throw new DomainError("push_subscription_invalid", { field: "auth" });
  return { endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth };
}

/** 通知から開く画面（アプリ内の通知を押したときと同じ行き先） */
export function notificationPath(n: {
  kind: string;
  workId?: string;
  revisionId?: string;
  threadId?: string;
}): string {
  const enc = encodeURIComponent;
  if (n.revisionId)
    return `/revisions/${enc(n.revisionId)}${n.threadId ? `?thread=${enc(n.threadId)}` : ""}`;
  if (n.workId) return `/works/${enc(n.workId)}`;
  if (n.kind === "rule_proposed" || n.kind === "rule_proposal_decided")
    return "/notation?view=proposals";
  return "/";
}

export interface PushPayload {
  title: string;
  body: string;
  /** 押したときに開く画面（同じオリジンのパス） */
  url: string;
  /** 通知の ID（最新の 1 件。押したら既読にする） */
  id: string;
  /**
   * 同じ会話の通知をまとめる印（スレッド → 制作物 → 通知の ID の順）。
   * 同じ印の通知は端末で置き換わり、積み重ならない（Slack・LINE と同じ）
   */
  tag: string;
  /** アプリのアイコンに出す未読の数 */
  badge: number;
  /** 通知ができた時刻（ミリ秒）。端末の通知に出す時刻 */
  createdAt: number;
}

/** 通知をまとめる印: 同じスレッド、なければ同じ制作物、なければその通知だけ */
export function pushTagOf(n: { id: string; workId?: string; threadId?: string }): string {
  return n.threadId ?? n.workId ?? n.id;
}

/** 送った結果で購読をどうするか（宛先が無くなった・続けて失敗したら消す） */
export const PUSH_MAX_FAILURES = 5;

export function pushOutcome(
  status: number,
  failureCount: number,
): { action: "keep" | "delete"; failureCount: number } {
  if (status >= 200 && status < 300) return { action: "keep", failureCount: 0 };
  if (status === 404 || status === 410) return { action: "delete", failureCount };
  const next = failureCount + 1;
  return { action: next >= PUSH_MAX_FAILURES ? "delete" : "keep", failureCount: next };
}
