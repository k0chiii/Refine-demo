import { normalizeForCompare, textSimilarity, visualSimilarity } from "./similarity.ts";

/**
 * ページの自動対応付け（版比較 §2.1）。
 * 1) ページごとのテキスト（PDF.js の抽出・OCR・本文）と縮小画像の特徴を受け取り
 * 2) テキスト類似度（文字 2-gram）と視覚類似度を合成したスコアで
 * 3) 順序を保つシーケンスアラインメント（Needleman–Wunsch、ギャップは 0 点）を解き
 * 4) 残ったページ同士の高い一致を「移動」として拾う
 * 対応が弱いページは無理に対応させない（minScore 未満は対応なし）。
 */

export interface PageFeature {
  /** 1 始まりのページ番号 */
  page: number;
  text: string;
  /** 縮小画像の濃淡（0..1）。無ければ視覚類似度は使わない */
  thumb?: readonly number[];
}

export type AlignmentKind = "match" | "moved" | "inserted" | "deleted" | "manual";
export type AlignmentConfidence = "high" | "medium" | "low";

export interface PagePair {
  /** 旧版のページ（null = 新版にだけある） */
  left: number | null;
  /** 新版のページ（null = 旧版にだけある） */
  right: number | null;
  kind: AlignmentKind;
  score: number;
  confidence: AlignmentConfidence;
}

export interface AlignmentOptions {
  /** これ未満のスコアは対応させない */
  minScore: number;
  /** 移動とみなす下限（順序を外れるので高めにする） */
  moveScore: number;
  /** テキストが少ない（この文字数未満）ページは視覚だけで比べる */
  minTextChars: number;
}

export const defaultAlignmentOptions: AlignmentOptions = {
  minScore: 0.35,
  moveScore: 0.6,
  minTextChars: 12,
};

export function confidenceOf(score: number): AlignmentConfidence {
  return score >= 0.75 ? "high" : score >= 0.5 ? "medium" : "low";
}

/** 2 ページのスコア（0..1）。テキストが十分あればテキスト重視、無ければ視覚だけ */
export function pageScore(
  a: PageFeature,
  b: PageFeature,
  opts: AlignmentOptions = defaultAlignmentOptions,
): number {
  const ta = normalizeForCompare(a.text).length;
  const tb = normalizeForCompare(b.text).length;
  const hasText = ta >= opts.minTextChars && tb >= opts.minTextChars;
  const hasThumb = Boolean(a.thumb?.length && b.thumb?.length);
  const text = hasText ? textSimilarity(a.text, b.text) : 0;
  const visual = hasThumb ? visualSimilarity(a.thumb, b.thumb) : 0;
  if (hasText && hasThumb) return 0.75 * text + 0.25 * visual;
  if (hasText) return text;
  if (hasThumb) return visual * 0.9; // 視覚だけの一致は少し割り引く（白いページ同士が似すぎるため）
  return 0;
}

export function alignPages(
  left: readonly PageFeature[],
  right: readonly PageFeature[],
  opts: AlignmentOptions = defaultAlignmentOptions,
): PagePair[] {
  const n = left.length;
  const m = right.length;
  const score: number[][] = left.map((l) => right.map((r) => pageScore(l, r, opts)));
  // dp[i][j] = 先頭 i, j ページまでの最大得点（一致 1 組 = score - minScore、ギャップ 0）
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from<number>({ length: m + 1 }).fill(0),
  );
  const from: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from<number>({ length: m + 1 }).fill(0),
  ); // 0 diag, 1 up, 2 left
  for (let i = 1; i <= n; i++) from[i]![0] = 1;
  for (let j = 1; j <= m; j++) from[0]![j] = 2;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = score[i - 1]![j - 1]!;
      const diag = s >= opts.minScore ? dp[i - 1]![j - 1]! + (s - opts.minScore) + 1e-6 : -Infinity;
      const up = dp[i - 1]![j]!;
      const lf = dp[i]![j - 1]!;
      // 同点なら「新版に追加」を後ろに回す（削除 → 追加の順に並べる）
      if (diag >= up && diag >= lf) {
        dp[i]![j] = diag;
        from[i]![j] = 0;
      } else if (up > lf) {
        dp[i]![j] = up;
        from[i]![j] = 1;
      } else {
        dp[i]![j] = lf;
        from[i]![j] = 2;
      }
    }
  }
  const pairs: PagePair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const f = i > 0 && j > 0 ? from[i]![j]! : i > 0 ? 1 : 2;
    if (f === 0) {
      const s = score[i - 1]![j - 1]!;
      pairs.push({
        left: left[i - 1]!.page,
        right: right[j - 1]!.page,
        kind: "match",
        score: s,
        confidence: confidenceOf(s),
      });
      i--;
      j--;
    } else if (f === 1) {
      pairs.push({
        left: left[i - 1]!.page,
        right: null,
        kind: "deleted",
        score: 0,
        confidence: "high",
      });
      i--;
    } else {
      pairs.push({
        left: null,
        right: right[j - 1]!.page,
        kind: "inserted",
        score: 0,
        confidence: "high",
      });
      j--;
    }
  }
  pairs.reverse();
  // 順序から外れた「移動」: 対応の無い旧ページと新ページで、十分に高い一致を貪欲に組む
  const loneLeft = pairs.filter((p) => p.right === null).map((p) => p.left!);
  const loneRight = pairs.filter((p) => p.left === null).map((p) => p.right!);
  const candidates: Array<{ l: number; r: number; s: number }> = [];
  for (const l of loneLeft)
    for (const r of loneRight) {
      const s = score[left.findIndex((x) => x.page === l)]![right.findIndex((x) => x.page === r)]!;
      if (s >= opts.moveScore) candidates.push({ l, r, s });
    }
  candidates.sort((a, b) => b.s - a.s);
  const usedL = new Set<number>();
  const usedR = new Set<number>();
  const moves: Array<{ l: number; r: number; s: number }> = [];
  for (const c of candidates) {
    if (usedL.has(c.l) || usedR.has(c.r)) continue;
    usedL.add(c.l);
    usedR.add(c.r);
    moves.push(c);
  }
  if (moves.length === 0) return pairs;
  const out = pairs.filter(
    (p) => !(p.right === null && usedL.has(p.left!)) && !(p.left === null && usedR.has(p.right!)),
  );
  for (const mv of moves) {
    // 新版の順序の位置に差し込む
    const at = out.findIndex((p) => p.right !== null && p.right > mv.r);
    const pair: PagePair = {
      left: mv.l,
      right: mv.r,
      kind: "moved",
      score: mv.s,
      confidence: confidenceOf(mv.s),
    };
    if (at < 0) out.push(pair);
    else out.splice(at, 0, pair);
  }
  return out;
}

/** 手動の対応（利用者が直したもの）。対応なしは片方が null */
export interface ManualPair {
  left: number | null;
  right: number | null;
}

/**
 * 手動の対応で自動の結果を上書きする。手動で触れたページは自動の組から外し、手動の組を優先する。
 * 新版の順序で並べ直す（新版に無い旧ページは直前の位置に置く）。
 */
export function applyManualPairs(
  auto: readonly PagePair[],
  manual: readonly ManualPair[],
): PagePair[] {
  if (manual.length === 0) return [...auto];
  const touchedL = new Set(manual.map((p) => p.left).filter((x): x is number => x !== null));
  const touchedR = new Set(manual.map((p) => p.right).filter((x): x is number => x !== null));
  const kept: PagePair[] = [];
  for (const p of auto) {
    const lHit = p.left !== null && touchedL.has(p.left);
    const rHit = p.right !== null && touchedR.has(p.right);
    if (!lHit && !rHit) kept.push(p);
    else if (lHit && !rHit && p.right !== null)
      kept.push({ left: null, right: p.right, kind: "inserted", score: 0, confidence: "high" });
    else if (rHit && !lHit && p.left !== null)
      kept.push({ left: p.left, right: null, kind: "deleted", score: 0, confidence: "high" });
  }
  for (const m of manual)
    kept.push({
      left: m.left,
      right: m.right,
      kind:
        m.left !== null && m.right !== null ? "manual" : m.left === null ? "inserted" : "deleted",
      score: 1,
      confidence: "high",
    });
  const key = (p: PagePair) => (p.right ?? (p.left ?? 0) - 0.5) * 1000 + (p.left ?? 0);
  return kept.sort((a, b) => key(a) - key(b));
}

/** 旧版のページ → 新版のページ（対応なしは null） */
export function counterpartPage(
  pairs: readonly PagePair[],
  side: "left" | "right",
  page: number,
): number | null {
  const p = pairs.find((x) => (side === "left" ? x.left : x.right) === page);
  if (!p) return null;
  return side === "left" ? p.right : p.left;
}
