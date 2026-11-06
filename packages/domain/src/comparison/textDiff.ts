import { normalizeForCompare, textSimilarity } from "./similarity.ts";

/**
 * 文章差分（版比較 §2.3）。段落単位で対応させ、変わった段落の中は文字単位で比べる（日本語は単語境界が無いため）。
 * 段落の移動（同じ段落が別の位置へ）も検出する。結果は元の文章のオフセットで返し、表示側が重ねて描く（元ファイルは変えない）。
 */

export interface Paragraph {
  start: number;
  end: number;
  text: string;
  key: string;
}

export function splitParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  let start = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    const key = normalizeForCompare(line);
    if (key.length > 0) out.push({ start, end, text: line, key });
    start = end + 1;
  }
  return out;
}

export type DiffBlockType = "equal" | "insert" | "delete" | "change" | "move";

export interface InlineRange {
  start: number;
  end: number;
}

export interface DiffBlock {
  type: DiffBlockType;
  /** 旧版の範囲（insert は null） */
  old: InlineRange | null;
  /** 新版の範囲（delete は null） */
  new: InlineRange | null;
  /** change の中で消えた文字（旧版オフセット）・増えた文字（新版オフセット） */
  removed?: InlineRange[];
  added?: InlineRange[];
}

export interface TextDiff {
  blocks: DiffBlock[];
  stats: { inserted: number; deleted: number; changed: number; moved: number };
}

/** 2 列の LCS で一致した添字の組（a[i] === b[j]） */
function lcsPairs<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean,
): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = eq(a[i]!, b[j]!)
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/** 文字単位の差分（段落の中）。大きすぎる組は段落全体の置換として扱う */
export function inlineDiff(
  oldText: string,
  newText: string,
  oldBase = 0,
  newBase = 0,
): { removed: InlineRange[]; added: InlineRange[] } {
  const a = Array.from(oldText);
  const b = Array.from(newText);
  if (a.length * b.length > 4_000_000)
    return {
      removed: [{ start: oldBase, end: oldBase + oldText.length }],
      added: [{ start: newBase, end: newBase + newText.length }],
    };
  // 文字列の UTF-16 オフセットに戻すための累積長
  const ao = [0];
  for (const ch of a) ao.push(ao[ao.length - 1]! + ch.length);
  const bo = [0];
  for (const ch of b) bo.push(bo[bo.length - 1]! + ch.length);
  const pairs = lcsPairs(a, b, (x, y) => x === y);
  // 一致の連続（run）にまとめる
  const runs: Array<{ i: number; j: number; len: number }> = [];
  for (const [i, j] of pairs) {
    const last = runs[runs.length - 1];
    if (last && last.i + last.len === i && last.j + last.len === j) last.len++;
    else runs.push({ i, j, len: 1 });
  }
  // 読みやすさの整形: 変更に挟まれた 1 文字だけの一致は一致として扱わない（「て」「いりま」のような細切れを防ぐ）
  const kept = runs.filter((r, k) => {
    if (r.len > 1) return true;
    const prev = runs[k - 1];
    const next = runs[k + 1];
    const gapBefore = prev ? r.i - (prev.i + prev.len) + (r.j - (prev.j + prev.len)) : r.i + r.j;
    const gapAfter = next
      ? next.i - (r.i + 1) + (next.j - (r.j + 1))
      : a.length - (r.i + 1) + (b.length - (r.j + 1));
    return gapBefore === 0 || gapAfter === 0;
  });
  const removed: InlineRange[] = [];
  const added: InlineRange[] = [];
  let pi = 0;
  let pj = 0;
  const push = (list: InlineRange[], s: number, e: number) => {
    if (e <= s) return;
    const last = list[list.length - 1];
    if (last && last.end === s) last.end = e;
    else list.push({ start: s, end: e });
  };
  for (const r of [...kept, { i: a.length, j: b.length, len: 0 }]) {
    push(removed, oldBase + ao[pi]!, oldBase + ao[r.i]!);
    push(added, newBase + bo[pj]!, newBase + bo[r.j]!);
    pi = r.i + r.len;
    pj = r.j + r.len;
  }
  return { removed, added };
}

export function diffText(oldText: string, newText: string): TextDiff {
  const a = splitParagraphs(oldText);
  const b = splitParagraphs(newText);
  const matched = lcsPairs(a, b, (x, y) => x.key === y.key);
  const blocks: DiffBlock[] = [];
  const range = (p: Paragraph): InlineRange => ({ start: p.start, end: p.end });
  let i = 0;
  let j = 0;
  const flushGap = (ie: number, je: number) => {
    const olds = a.slice(i, ie);
    const news = b.slice(j, je);
    // 隙間の中で似ている段落を順序どおりに組んで「変更」にする
    let k = 0;
    for (const o of olds) {
      let best = -1;
      let bestScore = 0.5;
      for (let t = k; t < news.length; t++) {
        const s = textSimilarity(o.text, news[t]!.text);
        if (s >= bestScore) {
          bestScore = s;
          best = t;
        }
      }
      if (best < 0) {
        blocks.push({ type: "delete", old: range(o), new: null });
        continue;
      }
      for (let t = k; t < best; t++)
        blocks.push({ type: "insert", old: null, new: range(news[t]!) });
      const n = news[best]!;
      blocks.push({
        type: "change",
        old: range(o),
        new: range(n),
        ...inlineDiff(o.text, n.text, o.start, n.start),
      });
      k = best + 1;
    }
    for (let t = k; t < news.length; t++)
      blocks.push({ type: "insert", old: null, new: range(news[t]!) });
  };
  for (const [mi, mj] of matched) {
    flushGap(mi, mj);
    blocks.push({ type: "equal", old: range(a[mi]!), new: range(b[mj]!) });
    i = mi + 1;
    j = mj + 1;
  }
  flushGap(a.length, b.length);
  // 移動: 削除された段落と同じ内容の追加段落を組む
  const keyOf = (r: InlineRange, src: string) => normalizeForCompare(src.slice(r.start, r.end));
  for (const del of blocks.filter((x) => x.type === "delete")) {
    const k = keyOf(del.old!, oldText);
    const ins = blocks.find((x) => x.type === "insert" && keyOf(x.new!, newText) === k);
    if (!ins) continue;
    del.type = "move";
    del.new = ins.new;
    blocks.splice(blocks.indexOf(ins), 1);
  }
  const stats = { inserted: 0, deleted: 0, changed: 0, moved: 0 };
  for (const x of blocks) {
    if (x.type === "insert") stats.inserted++;
    else if (x.type === "delete") stats.deleted++;
    else if (x.type === "change") stats.changed++;
    else if (x.type === "move") stats.moved++;
  }
  return { blocks, stats };
}

/** 表示用: 片側（旧版 / 新版）に重ねる強調範囲 */
export interface DiffHighlight extends InlineRange {
  kind: "insert" | "delete" | "change" | "move";
}

export function diffHighlights(diff: TextDiff, side: "old" | "new"): DiffHighlight[] {
  const out: DiffHighlight[] = [];
  for (const b of diff.blocks) {
    if (b.type === "equal") continue;
    if (b.type === "change") {
      for (const r of side === "old" ? (b.removed ?? []) : (b.added ?? []))
        out.push({ ...r, kind: side === "old" ? "delete" : "insert" });
      const whole = side === "old" ? b.old : b.new;
      if (whole) out.push({ ...whole, kind: "change" });
      continue;
    }
    const r = side === "old" ? b.old : b.new;
    if (!r) continue;
    out.push({ ...r, kind: b.type === "move" ? "move" : side === "old" ? "delete" : "insert" });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** 段落の対応（スクロール同期用）: 旧版オフセット ↔ 新版オフセット */
export function paragraphAnchors(diff: TextDiff): Array<{ old: number; new: number }> {
  return diff.blocks
    .filter((b) => b.old && b.new && b.type !== "move")
    .map((b) => ({ old: b.old!.start, new: b.new!.start }));
}
