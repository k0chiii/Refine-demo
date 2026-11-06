import type { AppContext } from "@mf100/application";
import { memberTeamIds, type Principal } from "@mf100/domain";
import type { Sql } from "../sqlite/sql.ts";

/** 主体の組み立てに要る分だけ users から読む。JWT の本人は行が無いこともない（発行時に作っている） */
export function loadUser(sql: Sql, id: string): PrincipalUser {
  const [row] = sql.exec(
    "SELECT json_extract(doc, '$.subject') AS subject, json_extract(doc, '$.isSystemAdmin') AS admin, json_extract(doc, '$.orgPermissions') AS perms FROM users WHERE id = ?",
    id,
  );
  // 配列でない（無い・壊れている）ものは「持っていない」。Convex の `user.orgPermissions ?? []` と同じ
  const perms = typeof row?.perms === "string" ? (JSON.parse(row.perms) as unknown) : null;
  return {
    id,
    subject: (row?.subject as string | null) ?? "",
    ...(row?.admin === 1 ? { isSystemAdmin: true } : {}),
    orgPermissions: Array.isArray(perms)
      ? perms.filter((p): p is string => typeof p === "string")
      : [],
  };
}

export interface PrincipalUser {
  id: string;
  subject: string;
  isSystemAdmin?: boolean;
  /** users.orgPermissions（Nogiku Access から同期した分）。NOGIKU_ACCESS_ENABLED のときだけ主体に載る */
  orgPermissions?: string[];
}

/** 初期ブートストラップの管理者（env の subject の列）。関数の実行も alarm の仕事も同じ読み方をする */
const adminSubjectsOf = (env: Env): Set<string> =>
  new Set(
    (env.MF100_SYSTEM_ADMIN_SUBJECTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

/**
 * 利用者 ID → ドメインの主体。Convex の lib/principal.ts と同じ組み立て。
 * - orgPermissions は NOGIKU_ACCESS_ENABLED=true のときだけ users.orgPermissions（無ければ []）。それ以外は ["*"]（制限なし）
 * - teamIds は所属する局・担当（teams.memberIds）。Convex は購読の再実行を避けて要るときだけ読むが、ここは購読の単位が
 *   テーブルなので毎回読んでよい
 * - 管理者は users.isSystemAdmin（管理画面で付ける。Convex の admin.setSystemAdmin）か、初期ブートストラップの subject
 *   （Nogiku の sub。ID は払い出し値なので、環境変数に書けない）
 */
export async function principalOf(
  db: AppContext,
  user: PrincipalUser,
  env: Env,
): Promise<Principal> {
  const [groups, teams] = await Promise.all([db.groups.list(), db.teams.list()]);
  return {
    userId: user.id,
    isSystemAdmin: user.isSystemAdmin === true || adminSubjectsOf(env).has(user.subject),
    groupIds: groups.filter((g) => g.memberIds.includes(user.id)).map((g) => g.id),
    // 連携を入れたのに権限が空の人へ ["*"] を渡すと、groups:manage などが誰にでも開く。Convex の orgPermissionsOf と同じ分岐
    orgPermissions: env.NOGIKU_ACCESS_ENABLED === "true" ? (user.orgPermissions ?? []) : ["*"],
    teamIds: memberTeamIds(teams, user.id),
  };
}
