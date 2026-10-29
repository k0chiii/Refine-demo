import { DomainError } from "../shared/DomainError.ts";
import type { Instant } from "../shared/time.ts";

/*
 * Slack の DM の宛先。ワークスペースは管理者が登録し、各自が選ぶ（docs/UI_M3E.md §105）。
 * 選んだワークスペースで登録メールアドレスのメンバーを引く（めいちゃんの /userid）。利用者はメールアドレスを入力しない。
 * 引いた結果と、DM を送った結果で状態が移る。保存は slackMembers（ワークスペース × メールアドレスで 1 行）。
 */

/** Slack のワークスペース（管理者が登録する。めいちゃんに渡す team_id の出どころ） */
export interface SlackWorkspace {
  id: string;
  name: string;
  /** Slack のチーム ID（T で始まる。ブラウザ版 Slack の URL の app.slack.com/client/Txxxx/… の Txxxx） */
  teamId: string;
}

/** ワークスペースの名前の長さの上限（文字数） */
export const SLACK_WORKSPACE_NAME_MAX = 80;

const TEAM_ID = /^T[A-Z0-9]{2,}$/;

/**
 * 登録の入力を確かめて整える。名前は前後の空白を除いて 1〜80 文字。team_id は全角・小文字・前後の空白をならして
 * T で始まる英数字にそろえる。外れたら slack_workspace_invalid（details.field に name か teamId）
 */
export function validateSlackWorkspace(input: { name: string; teamId: string }): {
  name: string;
  teamId: string;
} {
  const name = input.name.trim();
  if (name === "" || Array.from(name).length > SLACK_WORKSPACE_NAME_MAX)
    throw new DomainError("slack_workspace_invalid", { field: "name" });
  const teamId = input.teamId.normalize("NFKC").trim().toUpperCase();
  if (!TEAM_ID.test(teamId)) throw new DomainError("slack_workspace_invalid", { field: "teamId" });
  return { name, teamId };
}

/**
 * 登録メールアドレスで引いた Slack のメンバー。
 * 行が無い = unresolved（導く。メールアドレスが変われば自然に unresolved になる）
 */
export type SlackLink =
  | { state: "unresolved" }
  | { state: "linked"; memberId: string; checkedAt: Instant }
  | { state: "not_found"; checkedAt: Instant }
  | { state: "cannot_dm"; memberId: string; checkedAt: Instant };

/** 選んだワークスペースでのその人の宛先（ワークスペースを選んでいない・登録が消えたときは null で表す） */
export interface SlackMembership {
  teamId: string;
  link: SlackLink;
}

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
