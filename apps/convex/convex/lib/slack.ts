import type { SlackLookupResult } from "@mf100/application";
import type { SendOutcome } from "@mf100/domain";

/*
 * Slack の DM（MF100 のワークスペースにボットを 1 つ。SLACK_BOT_TOKEN。lib/channels.ts が読む）。
 * Slack は失敗も HTTP 200 の {ok:false,error} で返すので、error を見て SendOutcome などにする。
 */

/**
 * 登録メールアドレスでメンバーを引く（users.lookupByEmail）。
 * 見つかった（削除済み・ボットでない）→ found、users_not_found・削除済み・ボット → not_found、
 * トークン・権限の誤り → unavailable、ratelimited → Retry-After を一度だけ待って retry
 */
export async function lookupSlackMember(
  token: string,
  email: string,
  opts?: { fetch?: typeof fetch },
): Promise<SlackLookupResult | { kind: "retry" } | { kind: "unavailable"; reason: string }> {
  void [token, email, opts];
  throw new Error("not implemented");
}

/**
 * DM を送る（chat.postMessage。unfurl_links・unfurl_media は false）。
 * ok → sent、channel_not_found・not_in_channel・cannot_dm_bot・user_disabled・is_archived → rejected(cannot_dm)、
 * トークン・権限の誤り → unavailable、ratelimited → Retry-After を一度だけ待って retry、ほかの ok:false → rejected(invalid_content)
 */
export async function postSlackDm(
  token: string,
  memberId: string,
  text: string,
  opts?: { fetch?: typeof fetch },
): Promise<SendOutcome> {
  void [token, memberId, text, opts];
  throw new Error("not implemented");
}
