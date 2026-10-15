import { DomainError } from "../shared/DomainError.ts";

/*
 * 通知の配信（Web Push）。利用者決定 2026-10-15「Web Push 進めて」（外部への実データ送信の承認）。
 * 送り先は Apple・Google・Mozilla・Microsoft のプッシュサービス。本文は端末の鍵で暗号化される（RFC 8291）が、
 * サービスを経由するので、載せる内容はここで決めた最小限にする。
 */

/**
 * 端末の通知に載せる内容（ポリシー値。運用で変えられるよう外出しする）。
 * - showWorkTitle: 本文に制作物名を載せるか。false なら決まった文言だけ
 * 非公開（restricted）の制作物の名前と、伏せた通知（今は見られない制作物）の内容は、この値にかかわらず載せない。
 * コメントの抜粋・確認観点などの本文は載せない（ロック画面に出るため）。
 */
export interface PushContentPolicy {
  showWorkTitle: boolean;
}

export const DEFAULT_PUSH_CONTENT_POLICY: PushContentPolicy = { showWorkTitle: true };

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
  if ((n.kind === "feedback_posted" || n.kind === "feedback_mentioned") && n.threadId)
    return `/feedback/${enc(n.threadId)}`;
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
  /** 同じ通知を重ねないための印（通知の ID） */
  tag: string;
  /** アプリのアイコンに出す未読の数 */
  badge: number;
}

/**
 * 端末に送る内容を作る。
 * - 題名は通知の題名（「新しいコメント」などの決まった文言。制作物名などの変わる値は入っていない）
 * - 本文は制作物名だけ（ポリシーで許すとき。非公開・見られない制作物は伏せる）
 * - visible が false（今は見られない制作物の通知）は、題名も決まった文言にする
 */
export function buildPushPayload(input: {
  notification: {
    id: string;
    kind: string;
    title: string;
    workId?: string;
    revisionId?: string;
    threadId?: string;
  };
  /** 通知の制作物（今その人が見られるときだけ渡す。見られない・制作物の無い通知は null） */
  work: { title: string; restricted: boolean } | null;
  /** 制作物の通知なのに、今その人が見られない */
  hidden: boolean;
  unread: number;
  policy?: PushContentPolicy;
}): PushPayload {
  const policy = input.policy ?? DEFAULT_PUSH_CONTENT_POLICY;
  const n = input.notification;
  const base = { tag: n.id, badge: Math.max(0, Math.floor(input.unread)) };
  if (input.hidden)
    return {
      ...base,
      title: "新しい通知",
      body: "MF100 校正システムを開いて確かめてください",
      url: "/",
    };
  const body =
    input.work === null
      ? "MF100 校正システム"
      : input.work.restricted
        ? "非公開の制作物"
        : policy.showWorkTitle
          ? `『${input.work.title}』`
          : "MF100 校正システム";
  return { ...base, title: n.title, body, url: notificationPath(n) };
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
