/**
 * 投稿の本文のプレビューの表示用の分割と、選択範囲 → 本文のオフセットの変換（コメントの位置。utf-16 の文字数）。
 * 画面に出す文字は、ハッシュタグ・メンション・URL を色分けするために区切り、X の URL は短く省略して見せる。
 * そのため画面の文字と本文は 1 対 1 ではない。区切りごとに本文での位置（data-s / data-e）を持たせ、
 * 選択やコメントの強調はその位置で行う（画面の文字数に頼らない）。
 */

export interface TextToken {
  start: number;
  end: number;
  kind: "plain" | "tag" | "url";
  /** 途中で分けない区切り（X の省略した URL）。範囲が一部でも重なればまるごと強調し、選択の端は区切りの外へ広げる */
  atomic?: boolean;
}

export interface TextMarkRange {
  id: string;
  start: number;
  end: number;
}

/** 選んだ本文の範囲と、選択の画面での範囲（px。投稿欄をそのそばに出すため）。TextViewer の TextRangeDraft と同じ形 */
export interface TextPick {
  start: number;
  end: number;
  box?: { x: number; y: number; w: number; h: number };
}

export interface TextSegment<M extends TextMarkRange = TextMarkRange> {
  start: number;
  end: number;
  kind: TextToken["kind"];
  atomic: boolean;
  /** この区間にかかるコメント（重なりは複数） */
  marks: M[];
  /** 書きかけのコメントの範囲にかかるか */
  draft: boolean;
}

/** 本文（長さ textLength）を、色分けの区切り（tokens。重ならない前提で、重なれば後のものを捨てる）と、その間の plain に分ける */
export function tokenize(
  textLength: number,
  tokens: readonly (Omit<TextToken, "kind"> & { kind: "tag" | "url" })[],
): TextToken[] {
  const sorted = [...tokens].sort((a, b) => a.start - b.start);
  const out: TextToken[] = [];
  let at = 0;
  for (const t of sorted) {
    const start = Math.max(0, Math.min(t.start, textLength));
    const end = Math.max(start, Math.min(t.end, textLength));
    if (start < at || end === start) continue;
    if (start > at) out.push({ start: at, end: start, kind: "plain" });
    out.push({ ...t, start, end });
    at = end;
  }
  if (at < textLength) out.push({ start: at, end: textLength, kind: "plain" });
  return out;
}

/**
 * 区切りを、コメントの範囲と書きかけの範囲の境目でさらに分ける。
 * 表示する文字（text）の外にはみ出す分は切る（「続きを読む」の前は、見えている分だけ）
 */
export function buildTextSegments<M extends TextMarkRange>(
  textLength: number,
  tokens: readonly TextToken[],
  marks: readonly M[],
  draft: { start: number; end: number } | null,
): TextSegment<M>[] {
  const inRange = (m: { start: number; end: number }, s: number, e: number) =>
    m.start < e && m.end > s;
  const out: TextSegment<M>[] = [];
  for (const tok of tokens) {
    const atomic = tok.atomic === true;
    const cuts = new Set<number>([tok.start, tok.end]);
    if (!atomic) {
      for (const m of marks) for (const p of [m.start, m.end]) cuts.add(p);
      if (draft) for (const p of [draft.start, draft.end]) cuts.add(p);
    }
    const points = [...cuts]
      .filter((p) => p >= tok.start && p <= Math.min(tok.end, textLength))
      .sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i]!;
      const end = points[i + 1]!;
      if (end <= start) continue;
      out.push({
        start,
        end,
        kind: tok.kind,
        atomic,
        marks: marks.filter((m) => inRange(m, start, end)),
        draft: draft !== null && inRange(draft, start, end),
      });
    }
  }
  return out;
}

/**
 * 画面の区切りの中の位置 → 本文のオフセット。
 * 途中で分けない区切り（省略した URL）は文字が対応しないので、始点なら区切りの頭、終点なら区切りの終わりに寄せる
 * （選んだ範囲が URL を欠けずに含むように）。それ以外は区切りの頭 + 画面の文字の位置
 */
export function segmentOffset(
  seg: { start: number; end: number; atomic: boolean },
  local: number,
  side: "start" | "end",
): number {
  if (seg.atomic) return side === "start" ? seg.start : seg.end;
  return Math.max(seg.start, Math.min(seg.start + Math.max(0, local), seg.end));
}

/**
 * 本文の要素（data-s / data-e を持つ区切りが並ぶ）の中の境界点 → 本文のオフセット。
 * 区切りの中の文字（Text）・区切り自身・本文の要素そのもの（子の番号）のどれでも解く。要素の外なら null
 */
export function boundaryOffset(
  root: HTMLElement,
  node: Node,
  offset: number,
  side: "start" | "end",
): number | null {
  const segOf = (el: Element) => ({
    start: Number((el as HTMLElement).dataset.s),
    end: Number((el as HTMLElement).dataset.e),
    atomic: (el as HTMLElement).dataset.atomic === "1",
  });
  if (node === root) {
    const kids = [...root.children].filter((c) => (c as HTMLElement).dataset.s !== undefined);
    const k = kids[offset];
    if (k) return segOf(k).start;
    const last = kids[kids.length - 1];
    return last ? segOf(last).end : 0;
  }
  if (!root.contains(node)) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const seg = el?.closest("[data-s]") ?? null;
  if (!seg || !root.contains(seg)) return null;
  const s = segOf(seg);
  if (node.nodeType === Node.TEXT_NODE) return segmentOffset(s, offset, side);
  // 区切り自身: offset は子の番号（0 は頭、それ以降は終わり）
  return segmentOffset(s, offset <= 0 ? 0 : s.end - s.start, side);
}

/**
 * いまの選択を、本文の範囲に直す。選択が本文の要素にかかっていなければ null。
 * 一部だけ重なる（本文の外から始まる・外で終わる）選択は、本文の端まで（0 から、または表示している文字の終わりまで）で切る
 */
export function selectionToRange(
  root: HTMLElement,
  sel: Selection | null,
  textLength: number,
): { start: number; end: number } | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const hit = range.intersectsNode(root);
  if (!hit) return null;
  const startIn = root.contains(range.startContainer);
  const endIn = root.contains(range.endContainer);
  const start = startIn
    ? boundaryOffset(root, range.startContainer, range.startOffset, "start")
    : 0;
  const end = endIn ? boundaryOffset(root, range.endContainer, range.endOffset, "end") : textLength;
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}
