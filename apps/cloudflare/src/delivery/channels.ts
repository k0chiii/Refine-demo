import type { DeliveryEnv } from "@mf100/application";
import { type ChannelAvailability, DELIVERY_CHANNELS } from "@mf100/domain";
import { type VapidKeys, vapidKeysFromEnv } from "@mf100/platform";

/*
 * 外への通知の経路ごとの秘密（Worker の env）。ここが env を読む唯一の場所で、計画・送信がこれを使う。
 * 揃っていない経路は使えない（計画に入れない・送らない）。メールと Slack はリンクに FRONTEND_URL を使うので、それも要る。
 * Convex の lib/channels.ts と同じ契約（env を Record で受けるので、Worker の env も素のオブジェクトも渡せる）。
 */

export interface DeliveryConfig {
  /** VAPID_PUBLIC_KEY・VAPID_PRIVATE_KEY・VAPID_SUBJECT */
  push: VapidKeys | null;
  /** RESEND_API_KEY・NOTIFY_EMAIL_FROM（確認済みの送信元ドメイン）・FRONTEND_URL */
  email: { apiKey: string; from: string } | null;
  /** SLACK_BASE_URL（めいちゃんの入口。末尾の / を除く）・FRONTEND_URL */
  slack: { baseUrl: string } | null;
  /** FRONTEND_URL（末尾の / を除く）。メール・Slack のリンクの前につける */
  origin: string | null;
}

/** 配信が読む env の項目。Worker の Env も素のオブジェクトも渡せるよう、読む名前だけを並べる */
export type DeliveryVars = Partial<
  Record<
    | "FRONTEND_URL"
    | "RESEND_API_KEY"
    | "NOTIFY_EMAIL_FROM"
    | "SLACK_BASE_URL"
    | "VAPID_PUBLIC_KEY"
    | "VAPID_PRIVATE_KEY"
    | "VAPID_SUBJECT",
    string | undefined
  >
>;

export function deliveryConfigFromEnv(env: DeliveryVars): DeliveryConfig {
  const origin = httpUrlOf(env.FRONTEND_URL);
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.NOTIFY_EMAIL_FROM?.trim();
  const baseUrl = httpUrlOf(env.SLACK_BASE_URL);
  return {
    push: vapidKeysFromEnv(env),
    email: origin && apiKey && from?.includes("@") ? { apiKey, from } : null,
    slack: origin && baseUrl ? { baseUrl } : null,
    origin,
  };
}

/** 前後の空白と末尾の / を除いた http(s) の URL。そうでなければ null */
function httpUrlOf(raw: string | undefined): string | null {
  const url = raw?.trim().replace(/\/+$/, "");
  if (!url || !/^https?:\/\/[^/]/.test(url)) return null;
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

/** 秘密の揃った経路 */
export function availableChannels(c: DeliveryConfig): ChannelAvailability {
  return new Set(DELIVERY_CHANNELS.filter((channel) => c[channel] !== null));
}

/** 計画に渡す環境（秘密を含まない） */
export function deliveryEnvOf(c: DeliveryConfig): DeliveryEnv {
  return { available: availableChannels(c), origin: c.origin };
}
