import { PROOFREADER_ID, PROOFREADER_NAME, personDisplayName } from "@mf100/domain";
import type { Sql } from "../sqlite/sql.ts";

// apps/convex/convex/lib/users.ts の写し。ここは helper だけで、`users:*` の公開関数は持たない（別の単位）

export interface UserSummary {
  id: string;
  name: string;
  email: string | null;
}

/** 画面・通知に出す名前（ふりがな。無い人は漢字の名前。domain の personDisplayName） */
export function userDisplayName(user: { name?: string; hurigana?: string }): string {
  return personDisplayName(user);
}

/**
 * ID から表示用の利用者を引く。system と bot:（自動校正など）は users に行が無いので固定の名前、
 * 行が無い ID は「（不明なユーザー）」（Convex の resolveUsers と同じ）。SQLite は同期なので 1 回の SELECT でまとめて引く
 */
export function resolveUsers(sql: Sql, ids: Iterable<string>): Map<string, UserSummary> {
  const out = new Map<string, UserSummary>();
  const lookup: string[] = [];
  for (const id of new Set(ids)) {
    if (id === "system") out.set(id, { id, name: "システム", email: null });
    else if (id.startsWith("bot:"))
      out.set(id, { id, name: id === PROOFREADER_ID ? PROOFREADER_NAME : "システム", email: null });
    else lookup.push(id);
  }
  const rows =
    lookup.length === 0
      ? []
      : sql.exec(
          `SELECT id, json_extract(doc, '$.name') AS name, json_extract(doc, '$.hurigana') AS hurigana, email
           FROM users WHERE id IN (SELECT value FROM json_each(?))`,
          JSON.stringify(lookup),
        );
  const found = new Map(rows.map((r) => [r.id as string, r]));
  for (const id of lookup) {
    const r = found.get(id);
    out.set(id, {
      id,
      name:
        (r &&
          userDisplayName({
            ...(typeof r.name === "string" ? { name: r.name } : {}),
            ...(typeof r.hurigana === "string" ? { hurigana: r.hurigana } : {}),
          })) ||
        "（不明なユーザー）",
      email: (r?.email as string | null | undefined) ?? null,
    });
  }
  return out;
}
