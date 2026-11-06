import type { Identity } from "../identity.ts";
import type { Sql } from "./sql.ts";

/**
 * サインインした人を名簿（users）に置く。Convex の auth.ts upsertNogikuUser と同じ役。
 * Access の claim に無い項目（ふりがな・組織権限）は消さない: 持っている doc に上書きで重ねるだけ
 */
export function upsertUser(sql: Sql, identity: Identity): void {
  const patch = JSON.stringify({
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.email ? { email: identity.email } : {}),
  });
  sql.exec(
    "INSERT INTO users (id, doc) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET doc = json_patch(doc, excluded.doc)",
    identity.subject,
    patch,
  );
}
