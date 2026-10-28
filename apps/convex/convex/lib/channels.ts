import type { DeliveryEnv } from "@mf100/application";
import { type ChannelAvailability, DELIVERY_CHANNELS } from "@mf100/domain";
import { type VapidKeys, vapidKeysFromEnv } from "./webpush.ts";

/*
 * 外への通知の経路ごとの秘密（Convex の環境変数）。ここが env を読む唯一の場所で、予約・計画・送信・設定画面がこれを使う。
 * 揃っていない経路は使えない（予約しない・送らない）。メールと Slack はリンクに FRONTEND_URL を使うので、それも要る。
 */

export interface DeliveryConfig {
  /** VAPID_PUBLIC_KEY・VAPID_PRIVATE_KEY・VAPID_SUBJECT */
  push: VapidKeys | null;
  /** RESEND_API_KEY・NOTIFY_EMAIL_FROM（確認済みの送信元ドメイン）・FRONTEND_URL */
  email: { apiKey: string; from: string } | null;
  /** SLACK_BOT_TOKEN（xoxb-）・FRONTEND_URL */
  slack: { botToken: string } | null;
  /** FRONTEND_URL（末尾の / を除く）。メール・Slack のリンクの前につける */
  origin: string | null;
}

export function deliveryConfigFromEnv(env: Record<string, string | undefined>): DeliveryConfig {
  const frontend = env.FRONTEND_URL?.trim().replace(/\/+$/, "");
  const origin = frontend && /^https?:\/\/[^/]/.test(frontend) ? frontend : null;
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.NOTIFY_EMAIL_FROM?.trim();
  const botToken = env.SLACK_BOT_TOKEN?.trim();
  return {
    push: vapidKeysFromEnv(env),
    email: origin && apiKey && from?.includes("@") ? { apiKey, from } : null,
    slack: origin && botToken?.startsWith("xoxb-") ? { botToken } : null,
    origin,
  };
}

/** 秘密の揃った経路 */
export function availableChannels(c: DeliveryConfig): ChannelAvailability {
  return new Set(DELIVERY_CHANNELS.filter((channel) => c[channel] !== null));
}

/** 計画に渡す環境（秘密を含まない） */
export function deliveryEnvOf(c: DeliveryConfig): DeliveryEnv {
  return { available: availableChannels(c), origin: c.origin };
}
