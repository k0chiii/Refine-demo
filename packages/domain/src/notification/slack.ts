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

/** 確かめた時刻から確かめ直す間が過ぎたか（ちょうど過ぎた時刻を含む） */
function isDue(checkedAt: Instant, now: Instant): boolean {
  return now - checkedAt >= SLACK_RECHECK_MS;
}

function memberOf(link: SlackLink): string | null {
  return "memberId" in link ? link.memberId : null;
}

/** 観測が示す状態。今の memberId 以外への送信の結果は null（当てない） */
function observed(
  prev: SlackLink,
  o: SlackObservation,
): Exclude<SlackLink, { state: "unresolved" }> | null {
  switch (o.type) {
    case "lookup_found":
      return { state: "linked", memberId: o.memberId, checkedAt: o.at };
    case "lookup_not_found":
      return { state: "not_found", checkedAt: o.at };
    case "post_ok":
    case "post_cannot_dm":
      if (memberOf(prev) !== o.memberId) return null;
      return {
        state: o.type === "post_ok" ? "linked" : "cannot_dm",
        memberId: o.memberId,
        checkedAt: o.at,
      };
  }
}

/**
 * 遷移（全域。不正な遷移は無い）:
 *   any --lookup_found(m)-->      linked(m)
 *   any --lookup_not_found-->     not_found
 *   linked(m)|cannot_dm(m) --post_ok(m)-->        linked(m)
 *   linked(m)|cannot_dm(m) --post_cannot_dm(m)--> cannot_dm(m)
 *   post_*(m') で m' が今の memberId と違う（古い送信の結果）→ prev のまま
 * 状態とメンバーが同じなら prev そのものを返す（呼ぶ側は === で比べて保存を省く。同じ人への並んだ配信が
 * 行を取り合わない）。ただし確かめた時刻から SLACK_RECHECK_MS が過ぎていれば、確かめた時刻だけ新しくする
 * （でないと slackStep が通知のたびに確かめ直す）
 */
export function nextSlackLink(prev: SlackLink, o: SlackObservation): SlackLink {
  const next = observed(prev, o);
  if (!next) return prev;
  const unchanged =
    prev.state === next.state &&
    memberOf(prev) === memberOf(next) &&
    "checkedAt" in prev &&
    !isDue(prev.checkedAt, o.at);
  return unchanged ? prev : next;
}

/**
 * 今この人に何をするか: unresolved → lookup、linked → post、
 * not_found → 確かめ直すまで skip（過ぎたら lookup）、cannot_dm → 確かめ直すまで skip（過ぎたら post）
 */
export function slackStep(
  link: SlackLink,
  now: Instant,
): { do: "lookup" } | { do: "post"; memberId: string } | { do: "skip" } {
  switch (link.state) {
    case "unresolved":
      return { do: "lookup" };
    case "linked":
      return { do: "post", memberId: link.memberId };
    case "not_found":
      return isDue(link.checkedAt, now) ? { do: "lookup" } : { do: "skip" };
    case "cannot_dm":
      return isDue(link.checkedAt, now) ? { do: "post", memberId: link.memberId } : { do: "skip" };
  }
}
