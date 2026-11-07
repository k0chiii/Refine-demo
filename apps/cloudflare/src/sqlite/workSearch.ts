import type { Work } from "@mf100/domain";

// apps/convex/convex/lib/workSearch.ts の token の作り方をそのまま写したもの。
// 同じ入力から同じ token を作ることが差分テストの前提なので、手を入れずに揃える

export function workSearchText(
  work: Pick<Work, "title" | "legacyId" | "category" | "purpose" | "tags">,
): string {
  return `${work.title} ${work.legacyId ?? ""} ${work.category} ${work.purpose} ${(work.tags ?? []).join(" ")}`.toLowerCase();
}

function token(chars: string[]): string {
  return `g${chars.map((c) => c.codePointAt(0)!.toString(16)).join("x")}`;
}

/** 英数だけの token に 1/2-gram を符号化する。日本語の部分一致が分かち書きに頼らない */
export function substringTokens(text: string): string {
  const chars = Array.from(text.toLowerCase());
  const tokens = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    tokens.add(token(chars.slice(i, i + 1)));
    if (i + 1 < chars.length) tokens.add(token(chars.slice(i, i + 2)));
  }
  return [...tokens].join(" ");
}

/** 検索語の先頭 2 文字の token（3 文字以上は候補を絞るだけで、本文での包含は呼び手が確かめる） */
export function substringQuery(text: string): string {
  return token(Array.from(text.trim().toLowerCase()).slice(0, 2));
}
