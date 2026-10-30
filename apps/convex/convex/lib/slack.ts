import type { SlackLookupResult } from "@mf100/application";
import type { SendOutcome } from "@mf100/domain";
import { retryAfterMs, sleepFor } from "./retryAfter.ts";

/*
 * Slack の DM は「めいちゃん」（五月祭の slackbot）に HTTP で渡す（docs/SLACK_MEICHAN.md）。Slack API と Bot Token は使わない。
 * SLACK_BASE_URL（lib/channels.ts が読む）にパスを連結して JSON だけを POST する（認証ヘッダは付けない）。
 * ワークスペースはリクエストの team_id で決まる（各自が選んだ登録のもの）。ログに送った本文は出さない。
 * メールアドレスは引き当ての失敗のログ（slack_lookup_failed）にだけ出す（利用者承認 2026-10-30「出していいので」）。
 */

export interface MeichanConfig {
  /** 末尾の / を除いためいちゃんの入口 */
  baseUrl: string;
}

interface MeichanOpts {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

type Unavailable = { kind: "unavailable"; reason: string };

/** 一時的な失敗（429・5xx） */
const isTransient = (status: number) => status === 429 || status >= 500;

/** POST する。429 は Retry-After を一度だけ待って呼び直す。つながらなければ null */
async function post(
  cfg: MeichanConfig,
  path: "/userid" | "/dm",
  json: Record<string, string>,
  opts: MeichanOpts | undefined,
): Promise<Response | null> {
  const doFetch = opts?.fetch ?? fetch;
  const sleep = opts?.sleep ?? sleepFor;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(`${cfg.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
    } catch {
      return null;
    }
    if (res.status !== 429 || attempt > 0) return res;
    const ms = retryAfterMs(res.headers.get("Retry-After"));
    if (ms > 0) await sleep(ms);
  }
}

async function userIdOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { userId?: unknown } | null;
    return typeof body?.userId === "string" && body.userId !== "" ? body.userId : null;
  } catch {
    return null;
  }
}

/** めいちゃんの /userid は見つからないとき 404 でなくこの本文の 500 を返す（2026-10-30 に観測。docs/SLACK_MEICHAN.md） */
const MEICHAN_NOT_FOUND_BODY = "Failed to get user id";

/**
 * そのワークスペースで Nogiku のメールアドレス（users.email）のメンバーを引く（POST /userid に { email, team_id }）。
 * 200 で userId → found、200 で userId が無い → unavailable(userid_missing)、
 * 404・本文が「Failed to get user id」の 500 → not_found、
 * 429（二度目）・ほかの 5xx・つながらない → retry、ほか → unavailable(http_<status>)。
 * 200 以外は slack_lookup_failed を 1 行ログに出す。team_id とメールアドレスを載せる（利用者承認 2026-10-30。
 * ほかのログは宛先を出さない。この行だけの例外）
 */
export async function lookupSlackMember(
  cfg: MeichanConfig,
  target: { teamId: string; email: string },
  opts?: MeichanOpts,
): Promise<SlackLookupResult | { kind: "retry" } | Unavailable> {
  const res = await post(cfg, "/userid", { email: target.email, team_id: target.teamId }, opts);
  const failed = { event: "slack_lookup_failed", teamId: target.teamId, email: target.email };
  if (!res) {
    console.warn(JSON.stringify({ ...failed, status: 0 }));
    return { kind: "retry" };
  }
  if (res.status !== 200) {
    const body = await res.text().catch(() => "");
    console.warn(JSON.stringify({ ...failed, status: res.status, body: body.slice(0, 300) }));
    if (res.status === 404 || (res.status === 500 && body.startsWith(MEICHAN_NOT_FOUND_BODY)))
      return { kind: "not_found" };
    if (isTransient(res.status)) return { kind: "retry" };
    return { kind: "unavailable", reason: `http_${res.status}` };
  }
  const userId = await userIdOf(res);
  return userId
    ? { kind: "found", memberId: userId }
    : { kind: "unavailable", reason: "userid_missing" };
}

/**
 * DM を送る（POST /dm に { team_id, user_id, text }）。200 → sent、404 → rejected(cannot_dm)、
 * 429（二度目）・5xx・つながらない → retry、ほか → unavailable(http_<status>)。200 以外は応答の本文の先頭をログに出す
 */
export async function postSlackDm(
  cfg: MeichanConfig,
  dm: { teamId: string; userId: string; text: string },
  opts?: MeichanOpts,
): Promise<SendOutcome> {
  const res = await post(
    cfg,
    "/dm",
    { team_id: dm.teamId, user_id: dm.userId, text: dm.text },
    opts,
  );
  if (res?.status === 200) return { kind: "sent", httpStatus: 200 };
  if (res) await logDmFailed(dm, res);
  if (!res || isTransient(res.status)) return { kind: "retry" };
  if (res.status === 404) return { kind: "rejected", reason: "cannot_dm", httpStatus: 404 };
  return { kind: "unavailable", reason: `http_${res.status}` };
}

async function logDmFailed(dm: { teamId: string; userId: string }, res: Response): Promise<void> {
  const body = await res.text().catch(() => "");
  console.warn(
    JSON.stringify({
      event: "slack_dm_failed",
      teamId: dm.teamId,
      userId: dm.userId,
      status: res.status,
      body: body.slice(0, 300),
    }),
  );
}
