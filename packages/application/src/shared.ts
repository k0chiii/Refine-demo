import {
  allMembersCanView,
  canViewWork,
  DomainError,
  isAllowed,
  memberTeamIds,
  personMatchesText,
  recipientPrincipal,
  requireAllowed,
  resolveGroupMentions,
  splitMentionTokens,
  validateMentions,
  workTeamIdsOf,
  type Principal,
  type Team,
  type Work,
  type WorkAction,
  type WorkPermissionGrant,
} from "@mf100/domain";
import type { AppContext, PersonProfile } from "./ports.ts";

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
  if (!isAllowed(action, { work, grants, principal })) {
    // 閲覧だけは担当の所属でも通る。所属は主体に添えていないので、ここで初めて（非公開の制作物のときだけ）読む
    const member =
      action === "work.view" ? await withTeamMembership(ctx, principal, work) : principal;
    requireAllowed(action, { work, grants, principal: member });
  }
  return { work, grants };
}

/**
 * 担当の所属（teamIds）を、閲覧の判定に要るときだけ主体に添える。
 * Convex は主体を組むときに teams を読まない（毎回全件読むと、どのクエリの読み集合にも teams が入り、
 * 担当の編集のたびに全画面の購読が再実行される。docs/UI_M3E.md §60）。所属が効くのは
 * 非公開・取扱注意の制作物（通常の制作物を関係者だけに戻したときはそれも）で、しかも担当の付いた制作物だけなので、
 * その場合に限って担当の一覧（高々 TEAM_MAX 件）を読む。既に添えてあればそのまま返す。
 */
export async function withTeamMembership(
  ctx: AppContext,
  principal: Principal,
  work: Pick<Work, "confidentiality" | "ownerTeamId" | "productionTeamIds" | "relatedTeamIds">,
): Promise<Principal> {
  if (principal.teamIds !== undefined) return principal;
  if (allMembersCanView(work)) return principal;
  if (workTeamIdsOf(work).length === 0) return principal;
  return { ...principal, teamIds: memberTeamIds(await ctx.teams.list(), principal.userId) };
}

/**
 * 制作物を見られるか（domain の canViewWork）。職責・ACL・関係者で見られなければ、担当の所属を読んで判定し直す。
 * 通常の制作物（委員なら誰でも）では担当を読まない。
 */
export async function canView(
  ctx: AppContext,
  principal: Principal,
  work: Work,
  grants: readonly WorkPermissionGrant[],
): Promise<boolean> {
  if (canViewWork({ work, grants, principal })) return true;
  const member = await withTeamMembership(ctx, principal, work);
  return member !== principal && canViewWork({ work, grants, principal: member });
}

/** メンションの候補の既定の人数（画面の一覧に出す分）と上限 */
export const PEOPLE_SEARCH_LIMIT = 20;
const PEOPLE_SEARCH_LIMIT_MAX = 50;

/**
 * 名簿を打った文字で絞る（ふりがな・漢字の名前・メールの部分一致。空なら全員）。名前順に並べ、limit 人まで。
 * メンションの候補は名簿を丸ごと画面に渡さず、「@」に続けて打った文字でサーバー側で絞る（users.search と同じ形）。
 */
export function searchPeopleByText(
  people: readonly PersonProfile[],
  text: string,
  limit: number = PEOPLE_SEARCH_LIMIT,
): PersonProfile[] {
  return (
    people
      // 表示名（ふりがな）・漢字の名前・メールのどれでも当たる（ひらがなとカタカナは区別しない）
      .filter((p) =>
        personMatchesText({ hurigana: p.name, name: p.nameKanji, email: p.email }, text),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
      .slice(0, Math.max(0, Math.min(limit, PEOPLE_SEARCH_LIMIT_MAX)))
  );
}

/**
 * ID しか分からない人（通知の受信者・メンションの相手）を認可判定にかける主体。
 * 担当の所属（teamIds）を添えるので、非公開の制作物を所属で見られる人を「見られない」側に倒さない（利用者決定 2026-10-17）。
 */
export function principalOf(userId: string, teams: readonly Team[]): Principal {
  return recipientPrincipal(userId, memberTeamIds(teams, userId));
}

/** メンションを確かめた結果 */
export interface CheckedMentions {
  /** 知らせる人: 直接メンションした人と、メンションしたグループの所属する人（見られる人だけ。重なりなし） */
  userIds: string[];
  /** メンションしたグループの ID（本文の「@グループ名」の強調に使う） */
  groupIds: string[];
}

/**
 * コメント・返信のメンションの検査（domain の validateMentions ＋ 名簿）。
 * 非公開の制作物は見られる人（職責・ACL・関係者・担当の所属）だけ。
 * 通常の制作物は委員なら誰でも見られる（WorkViewPolicy）ので、名簿にいる人なら誰でもメンションできる。
 * 「group:ID」はグループのメンション（利用者指示 2026-10-21）。所属する人のうち見られる人に広げる（domain の resolveGroupMentions）。
 * 直接メンションした人の上限（MENTION_MAX）にグループで知らせる人は数えない。
 */
export async function checkMentions(
  ctx: AppContext,
  work: Work,
  grants: readonly WorkPermissionGrant[],
  mentions: readonly string[] | undefined,
  authorId?: string,
): Promise<CheckedMentions> {
  const { userIds: direct, groupIds } = splitMentionTokens(mentions);
  const teams = await ctx.teams.list();
  const ids = validateMentions(direct, work, grants, teams);
  if (ids.length > 0 && allMembersCanView(work)) {
    const known = new Set((await ctx.people.profiles(ids)).map((p) => p.id));
    for (const id of ids)
      if (!known.has(id)) throw new DomainError("mention_not_allowed", { userId: id });
  }
  if (groupIds.length === 0) return { userIds: ids, groupIds: [] };
  let members = resolveGroupMentions(
    groupIds,
    await ctx.groups.list(),
    work,
    grants,
    teams,
    authorId,
  );
  // 名簿にいない人（消えた人）はグループに残っていても知らせない
  if (members.length > 0 && allMembersCanView(work)) {
    const known = new Set((await ctx.people.profiles(members)).map((p) => p.id));
    members = members.filter((id) => known.has(id));
  }
  return { userIds: [...new Set([...ids, ...members])], groupIds };
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
