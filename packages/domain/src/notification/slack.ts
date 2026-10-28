import type { Instant } from "../shared/time.ts";

/*
 * Slack の DM の宛先。登録メールアドレスで MF100 のワークスペースのメンバーを引く（利用者は何も入力しない）。
 * 引いた結果と、DM を送った結果で状態が移る。保存は slackMembers（メールアドレスごとに 1 行）。
 */

/**
 * 登録メールアドレスで引いた Slack のメンバー。
 * 行が無い = unresolved（導く。メールアドレスが変われば自然に unresolved になる）
 */
export type SlackLink =
  | { state: "unresolved" }
  | { state: "linked"; memberId: string; checkedAt: Instant }
  | { state: "not_found"; checkedAt: Instant }
  | { state: "cannot_dm"; memberId: string; checkedAt: Instant };

/** 外で観測したこと。post_* は memberId を持つので、メンバーを知らない状態には当てられない */
export type SlackObservation =
  | { type: "lookup_found"; memberId: string; at: Instant }
  | { type: "lookup_not_found"; at: Instant }
  | { type: "post_ok"; memberId: string; at: Instant }
  | { type: "post_cannot_dm"; memberId: string; at: Instant };

/** 見つからない・DM できないを確かめ直すまでの間 */
export const SLACK_RECHECK_MS = 24 * 3_600_000;

/**
 * 遷移（全域。不正な遷移は無い）:
 *   any --lookup_found(m)-->      linked(m)
 *   any --lookup_not_found-->     not_found
 *   linked(m)|cannot_dm(m) --post_ok(m)-->        linked(m)
 *   linked(m)|cannot_dm(m) --post_cannot_dm(m)--> cannot_dm(m)
 *   post_*(m') で m' が今の memberId と違う（古い送信の結果）→ prev のまま
 */
export function nextSlackLink(prev: SlackLink, o: SlackObservation): SlackLink {
  void [prev, o];
  throw new Error("not implemented");
}

/**
 * 今この人に何をするか: unresolved → lookup、linked → post、
 * not_found → 確かめ直すまで skip（過ぎたら lookup）、cannot_dm → 確かめ直すまで skip（過ぎたら post）
 */
export function slackStep(
  link: SlackLink,
  now: Instant,
): { do: "lookup" } | { do: "post"; memberId: string } | { do: "skip" } {
  void [link, now];
  throw new Error("not implemented");
}
