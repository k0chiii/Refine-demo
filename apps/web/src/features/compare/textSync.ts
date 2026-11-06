import type { DiffHighlight } from "@mf100/domain";

/** 文章ビューア（テキスト・書式付き）を版比較の同期から操作するための口 */
export interface TextViewerController {
  stage: () => HTMLElement | null;
  /** 平文オフセットの縦位置（舞台の内容基準 px）。描画されていなければ null */
  yOf: (offset: number) => number | null;
  /** 次のスクロールを利用者の操作として扱わない */
  markProgrammatic: () => void;
}

export interface TextCompareProps {
  /** 版比較の差分（このビューアの側のオフセット） */
  diff?: DiffHighlight[];
  controller?: { current: TextViewerController | null };
  onUserScroll?: () => void;
}

/** 平文の範囲（[start,end)）が差分のどれに当たるか（最初の 1 つ） */
export function diffKindAt(
  diff: readonly DiffHighlight[] | undefined,
  start: number,
  end: number,
): DiffHighlight["kind"] | null {
  if (!diff) return null;
  for (const d of diff) if (d.kind !== "change" && d.start < end && d.end > start) return d.kind;
  return null;
}
