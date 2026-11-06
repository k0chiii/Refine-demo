import type { AppContext } from "@mf100/application";
import { memberTeamIds, type Principal } from "@mf100/domain";

/**
 * 利用者 ID → ドメインの主体。Convex の lib/principal.ts と同じ組み立て。
 * - orgPermissions は Nogiku Access 連携まで ["*"]（制限なし）
 * - teamIds は所属する局・担当（teams.memberIds）。Convex は購読の再実行を避けて要るときだけ読むが、ここは購読の単位が
 *   テーブルなので毎回読んでよい
 * - 管理者は users.isSystemAdmin（管理画面で付ける。Convex の admin.setSystemAdmin）か、初期ブートストラップの subject
 *   （Nogiku の sub。ID は払い出し値なので、環境変数に書けない）
 */
export async function principalOf(
  db: AppContext,
  user: { id: string; subject: string; isSystemAdmin?: boolean },
  adminSubjects: ReadonlySet<string>,
): Promise<Principal> {
  const [groups, teams] = await Promise.all([db.groups.list(), db.teams.list()]);
  return {
    userId: user.id,
    isSystemAdmin: user.isSystemAdmin === true || adminSubjects.has(user.subject),
    groupIds: groups.filter((g) => g.memberIds.includes(user.id)).map((g) => g.id),
    orgPermissions: ["*"],
    teamIds: memberTeamIds(teams, user.id),
  };
}
