import {
  allMembersCanView,
  canViewWork,
  DomainError,
  isAccepting,
  isAllowed,
  memberTeamIds,
  personMatchesText,
  recipientPrincipal,
  requireAllowed,
  resolveGroupMentions,
  splitMentionTokens,
  validateMentions,
  type Principal,
  type Revision,
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
  requireAllowed(action, { work, grants, principal });
  return { work, grants };
}

/**
 * 制作物の受付中の版の ID（無ければ null）。制作物の全ての版を読んで探した結果（`find(isAccepting)`）と同じものを、
 * なるべく読まずに返す。
 * - 開いた版が受付中ならそれ（受付中の版は制作物に高々 1 件）。読まない。
 * - そうでなければ制作物の要約（書込みの側が同じ transaction で作り直す）の受付中の版。
 *   ただし要約がこの版を受付中と言うのに、この版が受付中でなければ要約が古いので信じない。
 * - 要約が無い（揃っていない古い制作物）・信じられないときは、全ての版から探す。
 */
export async function acceptingRevisionIdOf(
  ctx: AppContext,
  revision: Revision,
): Promise<string | null> {
  if (isAccepting(revision)) return revision.id;
  const summary = await ctx.workSummaries.findByWork(revision.workId);
  if (summary && summary.accepting?.id !== revision.id) return summary.accepting?.id ?? null;
  const siblings = await ctx.revisions.listByWork(revision.workId);
  return siblings.find(isAccepting)?.id ?? null;
}

/**
 * 本人に付いた許可を制作物ごとに引く関数。初めて要るときに 1 回だけ読む（制作物ごとに ACL を読まない）。
 * 認可（isAllowed・canViewWork）が見るのは本人に当たる許可だけなので、制作物の ACL 全体の代わりに渡せる。
 * 制作物の一覧を回るダッシュボード・通知の一覧が使う（Convex の読み取りの量と、購読が再実行される範囲を減らす）
 */
export function myGrantsLoader(
  ctx: AppContext,
  principal: Principal,
): (workId: string) => Promise<readonly WorkPermissionGrant[]> {
  let byWork: Promise<Map<string, WorkPermissionGrant[]>> | null = null;
  return async (workId) => {
    byWork ??= ctx.acl.listForPrincipal(principal).then((grants) => {
      const m = new Map<string, WorkPermissionGrant[]>();
      for (const g of grants) m.set(g.workId, [...(m.get(g.workId) ?? []), g]);
      return m;
    });
    return (await byWork).get(workId) ?? [];
  };
}

/**
 * 職責だけで許されるなら ACL を読まずに制作物を返す（閲覧・制作者の提出など）。職責で足りないときだけ ACL を読む。
 * 返すのは制作物だけ（ACL を返さない）。心拍・共同編集の確認など、毎回呼ばれて許可の一覧を使わないところ向け
 */
export async function loadWorkAllowing(
  ctx: AppContext,
  principal: Principal,
  workId: string,
  action: WorkAction,
): Promise<Work> {
  const work = await ctx.works.findById(workId);
  if (!work) throw new DomainError("forbidden", { workId, action });
  if (isAllowed(action, { work, grants: [], principal })) return work;
  requireAllowed(action, { work, grants: await ctx.acl.listByWork(workId), principal });
  return work;
}

/** @deprecated 105A: 閲覧は常に可。メンション候補用に主体をそのまま返す */
export async function withTeamMembership(
  _ctx: AppContext,
  principal: Principal,
  _work?: Pick<Work, "ownerTeamId" | "productionTeamIds" | "relatedTeamIds">,
): Promise<Principal> {
  return principal;
}

/** 制作物を見られるか（105A: サインインした委員はすべて見られる） */
export async function canView(
  _ctx: AppContext,
  _principal: Principal,
  work: Work,
  grants: readonly WorkPermissionGrant[],
): Promise<boolean> {
  return canViewWork({ work, grants, principal: _principal });
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

/** システム管理者だけが通る（それ以外は forbidden） */
export function requireSystemAdmin(principal: Principal): void {
  if (!principal.isSystemAdmin) throw new DomainError("forbidden", { reason: "system_admin_only" });
}

/** 所属する人が委員の名簿にいるか。既にいた人は確かめ直さない。code は呼び元の「入力が不正」のコード */
export async function assertMembersExist(
  ctx: AppContext,
  after: readonly string[],
  before: readonly string[],
  code: "group_invalid" | "team_invalid",
): Promise<void> {
  const known = new Set(before);
  const ids = after.filter((id) => !known.has(id));
  if (ids.length === 0) return;
  const found = new Set((await ctx.people.profiles(ids)).map((p) => p.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw new DomainError(code, { field: "memberIds", reason: "unknown_user", userIds: missing });
}
