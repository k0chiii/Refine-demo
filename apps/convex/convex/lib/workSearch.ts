import type { Work } from "@mf100/domain";
import type { Id } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";

/** works.searchVersion: `workSearch` に検索の行がある印 */
export const WORK_SEARCH_VERSION = 1;

export function workSearchText(
  work: Pick<Work, "title" | "legacyId" | "category" | "purpose" | "tags">,
): string {
  return `${work.title} ${work.legacyId ?? ""} ${work.category} ${work.purpose} ${(work.tags ?? []).join(" ")}`.toLowerCase();
}
function token(chars: string[]): string {
  return `g${chars.map((c) => c.codePointAt(0)!.toString(16)).join("x")}`;
}
/** Latin tokens encode Unicode 1/2-grams: Japanese substring matching never depends on word segmentation. */
export function substringTokens(text: string): string {
  const chars = Array.from(text.toLowerCase());
  const tokens = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    tokens.add(token(chars.slice(i, i + 1)));
    if (i + 1 < chars.length) tokens.add(token(chars.slice(i, i + 2)));
  }
  return [...tokens].join(" ");
}
export function substringQuery(text: string): string {
  return token(Array.from(text.trim().toLowerCase()).slice(0, 2));
}

/**
 * 制作物の検索の行（`workSearch`）を今の題名・目的・分類・タグ・旧 ID・年度・状態に合わせる。
 * 変わらなければ書かない（検索の索引を無駄に更新しない）。works 側の印（searchVersion）は呼び手が付ける
 */
export async function syncWorkSearch(
  db: DatabaseWriter,
  work: Pick<
    Work,
    "id" | "year" | "lifecycle" | "title" | "legacyId" | "category" | "purpose" | "tags"
  >,
): Promise<void> {
  const workId = work.id as Id<"works">;
  const value = {
    workId,
    searchTokens: substringTokens(workSearchText(work)),
    year: work.year,
    lifecycle: work.lifecycle,
  };
  const rows = await db
    .query("workSearch")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .take(5);
  const [first, ...extra] = rows;
  for (const row of extra) await db.delete(row._id);
  if (!first) await db.insert("workSearch", value);
  else if (
    first.searchTokens !== value.searchTokens ||
    first.year !== value.year ||
    first.lifecycle !== value.lifecycle
  )
    await db.patch(first._id, value);
}
