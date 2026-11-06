import type { Identity } from "../identity.ts";
import { randomId } from "./docs.ts";
import type { Sql } from "./sql.ts";

/**
 * サインインした人を名簿（users）に置き、利用者 ID（users.id）を返す。Convex の auth.ts upsertNogikuUser と同じ役。
 * 本人の特定は subject（Nogiku の sub）→ users.id。ID と subject を分けるのは、sub が変わっても（IdP の付け替え）
 * 業務データが指す ID を動かさないため。無ければ行を作る（id は randomUUID）。
 * Access の claim に無い項目（ふりがな・組織権限）は消さない: 持っている doc に上書きで重ねるだけ
 */
export function upsertUser(sql: Sql, identity: Identity): string {
  const patch = {
    subject: identity.subject,
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.email ? { email: identity.email } : {}),
  };
  const [row] = sql.exec(
    `INSERT INTO users (id, doc) VALUES (?, ?)
     ON CONFLICT (subject) DO UPDATE SET doc = json_patch(doc, excluded.doc)
     RETURNING id`,
    randomId("users"),
    JSON.stringify(patch),
  );
  return row!.id as string;
}
