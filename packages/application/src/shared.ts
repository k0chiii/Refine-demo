import {
  allMembersCanView,
  DomainError,
  memberTeamIds,
  recipientPrincipal,
  requireAllowed,
  validateMentions,
  type Principal,
  type Team,
  type Work,
  type WorkAction,
  type WorkPermissionGrant,
} from "@mf100/domain";
import type { AppContext } from "./ports.ts";

export interface LoadedWork {
  work: Work;
  grants: WorkPermissionGrant[];
}

/**
 * 作品の読み出しと認可を 1 箇所に集約する。
 * 権限が無い場合、作品の存在自体を漏らさないよう「見つからない」と同じ扱い（forbidden）で返す（§5.2-10 / A-01）。
 */
export async function loadAuthorizedWork(
  ctx: AppContext,
  principal: Principal,
  workId: string,
  action: WorkAction,
): Promise<LoadedWork> {
  const work = await ctx.works.findById(workId);
  if (!work) throw new DomainError("forbidden", { workId, action });
  const grants = await ctx.acl.listByWork(workId);
  requireAllowed(action, { work, grants, principal });
  return { work, grants };
}

/**
 * ID しか分からない人（通知の受信者・メンションの相手）を認可判定にかける主体。
 * 担当の所属（teamIds）を添えるので、非公開の制作物を所属で見られる人を「見られない」側に倒さない（利用者決定 2026-10-17）。
 */
export function principalOf(userId: string, teams: readonly Team[]): Principal {
  return recipientPrincipal(userId, memberTeamIds(teams, userId));
}

/**
 * コメント・返信のメンションの検査（domain の validateMentions ＋ 名簿）。
 * 非公開の制作物は見られる人（職責・ACL・関係者・担当の所属）だけ。
 * 通常の制作物は委員なら誰でも見られる（WorkViewPolicy）ので、名簿にいる人なら誰でもメンションできる。
 */
export async function checkMentions(
  ctx: AppContext,
  work: Work,
  grants: readonly WorkPermissionGrant[],
  mentions: readonly string[] | undefined,
): Promise<string[]> {
  const ids = validateMentions(mentions, work, grants, await ctx.teams.list());
  if (ids.length > 0 && allMembersCanView(work)) {
    const known = new Set((await ctx.people.profiles(ids)).map((p) => p.id));
    for (const id of ids)
      if (!known.has(id)) throw new DomainError("mention_not_allowed", { userId: id });
  }
  return ids;
}

/** 冪等実行。同じ scope+key の再送には保存済み結果を返す（二重版・二重校了・二重通知を防ぐ）。 */
export async function idempotent<T>(
  ctx: AppContext,
  scope: string,
  key: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (key === undefined || key === "") return fn();
  const hit = await ctx.idempotency.get(scope, key);
  if (hit) return hit.result as T;
  const result = await fn();
  await ctx.idempotency.put(scope, key, result);
  return result;
}
