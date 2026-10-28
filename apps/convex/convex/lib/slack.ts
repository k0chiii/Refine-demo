import type { SlackLookupResult } from "@mf100/application";
import type { SendOutcome } from "@mf100/domain";
import { retryAfterMs, sleepFor } from "./retryAfter.ts";

/*
 * Slack の DM（MF100 のワークスペースにボットを 1 つ。SLACK_BOT_TOKEN。lib/channels.ts が読む）。
 * Slack は失敗も HTTP 200 の {ok:false,error} で返すので、error を見て SendOutcome などにする。
 * ログに本文とメールアドレスは出さない。
 */

const API = "https://slack.com/api";

interface SlackReply {
  ok?: boolean;
  error?: string;
  user?: { id?: string; deleted?: boolean; is_bot?: boolean };
}

interface SlackOpts {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** トークン・権限の誤り（運用側の問題。やり直さない） */
const TOKEN_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "missing_scope",
  "no_permission",
]);

/** この相手には DM を送れない（24 時間後に送り直す。domain の slack.ts） */
const CANNOT_DM = new Set([
  "channel_not_found",
  "not_in_channel",
  "cannot_dm_bot",
  "user_disabled",
  "is_archived",
  "messages_tab_disabled",
]);

type Unavailable = { kind: "unavailable"; reason: string };

/**
 * 1 回呼ぶ。本文を読めた応答は reply で返し、ratelimited は Retry-After を一度だけ待って呼び直す。
 * HTTP 5xx・JSON でない・つながらない・二度目の ratelimited → retry
 */
async function call(
  token: string,
  url: string,
  init: { method: "GET" } | { method: "POST"; json: unknown },
  opts: SlackOpts | undefined,
): Promise<{ kind: "reply"; body: SlackReply } | { kind: "retry" }> {
  const doFetch = opts?.fetch ?? fetch;
  const sleep = opts?.sleep ?? sleepFor;
  let waited = false;
  for (;;) {
    let res: Response;
    let body: SlackReply;
    try {
      res = await doFetch(
        url,
        init.method === "GET"
          ? { method: "GET", headers: { Authorization: `Bearer ${token}` } }
          : {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json; charset=utf-8",
              },
              body: JSON.stringify(init.json),
            },
      );
      if (res.status >= 500) return { kind: "retry" };
      body = (await res.json()) as SlackReply;
    } catch {
      return { kind: "retry" };
    }
    if (res.status !== 429 && body.error !== "ratelimited") return { kind: "reply", body };
    if (waited) return { kind: "retry" };
    waited = true;
    const ms = retryAfterMs(res.headers.get("Retry-After"));
    if (ms > 0) await sleep(ms);
  }
}

/**
 * 登録メールアドレスでメンバーを引く（users.lookupByEmail）。
 * 見つかった（削除済み・ボットでない）→ found、users_not_found・削除済み・ボット → not_found、
 * トークン・権限の誤り・ほかの ok:false → unavailable、ratelimited → Retry-After を一度だけ待って retry
 */
export async function lookupSlackMember(
  token: string,
  email: string,
  opts?: SlackOpts,
): Promise<SlackLookupResult | { kind: "retry" } | Unavailable> {
  const url = `${API}/users.lookupByEmail?email=${encodeURIComponent(email)}`;
  const r = await call(token, url, { method: "GET" }, opts);
  if (r.kind === "retry") return r;
  const { body } = r;
  if (!body.ok) {
    if (body.error === "users_not_found") return { kind: "not_found" };
    return { kind: "unavailable", reason: body.error ?? "unknown" };
  }
  const user = body.user;
  if (!user?.id || user.deleted || user.is_bot) return { kind: "not_found" };
  return { kind: "found", memberId: user.id };
}

/**
 * DM を送る（chat.postMessage。unfurl_links・unfurl_media は false）。
 * ok → sent、channel_not_found・not_in_channel・cannot_dm_bot・user_disabled・is_archived・messages_tab_disabled → rejected(cannot_dm)、
 * トークン・権限の誤り → unavailable、ratelimited → Retry-After を一度だけ待って retry、ほかの ok:false → rejected(invalid_content)
 */
export async function postSlackDm(
  token: string,
  memberId: string,
  text: string,
  opts?: SlackOpts,
): Promise<SendOutcome> {
  const r = await call(
    token,
    `${API}/chat.postMessage`,
    {
      method: "POST",
      json: { channel: memberId, text, unfurl_links: false, unfurl_media: false },
    },
    opts,
  );
  if (r.kind === "retry") return r;
  const { body } = r;
  if (body.ok) return { kind: "sent", httpStatus: 200 };
  const error = body.error ?? "unknown";
  if (TOKEN_ERRORS.has(error)) return { kind: "unavailable", reason: error };
  if (CANNOT_DM.has(error)) return { kind: "rejected", reason: "cannot_dm", httpStatus: 200 };
  console.warn(JSON.stringify({ event: "slack_post_rejected", error }));
  return { kind: "rejected", reason: "invalid_content", httpStatus: 200 };
}
