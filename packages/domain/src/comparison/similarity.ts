/**
 * 版比較の類似度（純粋関数）。日本語は単語境界が無いので、文字 2-gram の Dice 係数で比べる。
 * 縮小画像は 0..1 の濃淡ベクトル（例: 16×16）で、平均絶対差から類似度を出す。
 */

/** 比較用の正規化: 互換文字の統一（全角英数→半角など）、空白・改行の除去 */
export function normalizeForCompare(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

function bigrams(text: string): Map<string, number> {
  const chars = Array.from(text);
  const out = new Map<string, number>();
  if (chars.length === 1) out.set(chars[0]!, 1);
  for (let i = 0; i < chars.length - 1; i++) {
    const g = chars[i]! + chars[i + 1]!;
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** 文字 2-gram の Dice 係数（0..1）。どちらかが空なら 0 */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let inter = 0;
  let total = 0;
  for (const [g, n] of ga) {
    inter += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total === 0 ? 0 : (2 * inter) / total;
}

/** 濃淡ベクトルの類似度（0..1）。長さが違う・空なら 0 */
export function visualSimilarity(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i]! - b[i]!);
  return Math.max(0, 1 - diff / a.length);
}
