import type { Work } from "@mf100/domain";

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
