import { DELIVERY_CHANNELS, type ChannelAvailability } from "@mf100/domain";

type Vars = Readonly<Record<string, string | undefined>>;

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

/**
 * 秘密の揃った経路。Convex の lib/channels.ts の availableChannels(deliveryConfigFromEnv(env)) と同じ判定
 * （メール・Slack はリンクに FRONTEND_URL を使うので、それも要る）。通知の設定画面が「使える届け先」を出すのに引く。
 * 配信そのもの（U6）が入ったらそちらの設定に寄せる
 */
export function availableChannels(env: Env): ChannelAvailability {
  const vars = env as unknown as Vars;
  const origin = httpUrlOf(vars.FRONTEND_URL);
  const usable = {
    push: Boolean(
      vars.VAPID_PUBLIC_KEY?.trim() && vars.VAPID_PRIVATE_KEY?.trim() && vars.VAPID_SUBJECT?.trim(),
    ),
    email: Boolean(
      origin && vars.RESEND_API_KEY?.trim() && vars.NOTIFY_EMAIL_FROM?.trim().includes("@"),
    ),
    slack: Boolean(origin && httpUrlOf(vars.SLACK_BASE_URL)),
  };
  return new Set(DELIVERY_CHANNELS.filter((channel) => usable[channel]));
}
