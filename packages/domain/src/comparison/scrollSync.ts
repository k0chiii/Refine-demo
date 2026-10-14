import { counterpartPage, type PagePair } from "./alignment.ts";
import { normalizeForCompare } from "./similarity.ts";

/**
 * スクロール同期の写像（版比較 §2.2）。全ページの割合を一致させるのではなく、
 * 1) 対応するテキスト行（アンカー）の間を補間 2) ページ内の相対位置 3) ページ対応 の順に使い、
 * 対応ページが無ければ null（同期を止める）を返す。
 */

/** ページ内のテキスト行（rel はページ上端からの割合 0..1） */
export interface PageLine {
  text: string;
  rel: number;
}

/** 対応するページの中で、左右で同じ行の位置の組 */
export interface ScrollAnchor {
  left: number;
  right: number;
}

/** 同じ文字列の行を順序を保って対応させる（LCS）。両端 (0,0)(1,1) を含む単調な組を返す */
export function lineAnchors(left: readonly PageLine[], right: readonly PageLine[]): ScrollAnchor[] {
  const a = left.map((l) => normalizeForCompare(l.text)).map((t) => (t.length >= 2 ? t : ""));
  const b = right.map((l) => normalizeForCompare(l.text)).map((t) => (t.length >= 2 ? t : ""));
  const n = a.length;
  const m = b.length;
  const out: ScrollAnchor[] = [{ left: 0, right: 0 }];
  if (n > 0 && m > 0 && n * m <= 250_000) {
    const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i]![j] =
          a[i] && a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] && a[i] === b[j]) {
        const last = out[out.length - 1]!;
        const pt = { left: left[i]!.rel, right: right[j]!.rel };
        if (pt.left >= last.left && pt.right >= last.right) out.push(pt);
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
      else j++;
    }
  }
  out.push({ left: 1, right: 1 });
  return out;
}

/** 単調な点列の間を線形補間する（from の座標 → to の座標） */
export function interpolate(
  points: readonly ScrollAnchor[],
  x: number,
  from: "left" | "right",
): number {
  const to = from === "left" ? "right" : "left";
  if (points.length === 0) return x;
  if (x <= points[0]![from]) return points[0]![to];
  for (let k = 1; k < points.length; k++) {
    const p = points[k - 1]!;
    const q = points[k]!;
    if (x <= q[from]) {
      const span = q[from] - p[from];
      return span <= 0 ? q[to] : p[to] + ((x - p[from]) / span) * (q[to] - p[to]);
    }
  }
  return points[points.length - 1]![to];
}

export interface PagePosition {
  page: number;
  rel: number;
}

/**
 * 一方の表示位置 → もう一方の表示位置。対応ページが無い（追加・削除ページ）なら null を返し、呼び出し側は同期を止める。
 * anchorsFor が行アンカーを返せばその間を補間し、無ければページ内の相対位置をそのまま使う。
 */
export function mapPosition(
  pos: PagePosition,
  from: "left" | "right",
  pairs: readonly PagePair[],
  anchorsFor?: (leftPage: number, rightPage: number) => readonly ScrollAnchor[] | undefined,
): PagePosition | null {
  const other = counterpartPage(pairs, from, pos.page);
  if (other === null) return null;
  const [lp, rp] = from === "left" ? [pos.page, other] : [other, pos.page];
  const anchors = anchorsFor?.(lp, rp);
  const rel = anchors && anchors.length > 2 ? interpolate(anchors, pos.rel, from) : pos.rel;
  return { page: other, rel: Math.min(1, Math.max(0, rel)) };
}
