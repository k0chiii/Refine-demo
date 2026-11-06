import type { AppContext } from "@mf100/application";
import { memberTeamIds, type Principal } from "@mf100/domain";
import type { Sql } from "../sqlite/sql.ts";

/** 主体の組み立てに要る分だけ users から読む。JWT の本人は行が無いこともない（発行時に作っている） */
export function loadUser(
  sql: Sql,
  id: string,
): { id: string; subject: string; isSystemAdmin?: boolean } {
  const [row] = sql.exec(
    "SELECT json_extract(doc, '$.subject') AS subject, json_extract(doc, '$.isSystemAdmin') AS admin FROM users WHERE id = ?",
    id,
  );
  return {
    id,
    subject: (row?.subject as string | null) ?? "",
    ...(row?.admin === 1 ? { isSystemAdmin: true } : {}),
  };
}

/** 初期ブートストラップの管理者（env の subject の列）。関数の実行も alarm の仕事も同じ読み方をする */
export const adminSubjectsOf = (env: Env): Set<string> =>
  new Set(
    (env.MF100_SYSTEM_ADMIN_SUBJECTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

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
