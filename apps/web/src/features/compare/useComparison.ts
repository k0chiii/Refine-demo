import { api } from "@mf100/convex/api";
import {
  alignPages,
  applyManualPairs,
  diffHighlights,
  diffText,
  lineAnchors,
  type DiffHighlight,
  type ManualPair,
  type NormalizedRect,
  type PagePair,
  type ScrollAnchor,
} from "@mf100/domain";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { pdfFeatures, rectsForRange, type PdfPageFeature } from "./pdfFeatures";

export interface PageDiffRect extends NormalizedRect {
  kind: DiffHighlight["kind"];
}

export interface PdfComparison {
  status: "idle" | "analyzing" | "ready" | "error";
  /** 表示に使う対応（手動の修正を反映済み） */
  pairs: PagePair[];
  /** 自動で求めた対応（手動の修正前） */
  autoPairs: PagePair[];
  manual: ManualPair[];
  leftCount: number;
  rightCount: number;
  anchorsFor: (leftPage: number, rightPage: number) => ScrollAnchor[] | undefined;
  /** そのページの差分の矩形（side: 旧版 left / 新版 right） */
  diffRects: (side: "left" | "right", page: number) => PageDiffRect[];
  saveManual: (pairs: ManualPair[]) => Promise<void>;
}

/**
 * PDF 同士の版比較（ページ対応・スクロールのアンカー・ページ内の文章差分）。
 * 特徴の抽出はブラウザ内（PDF.js）で行い、AI は使わない。手動の対応は Convex に保存して同じ添付の組で再利用する。
 */
export function usePdfComparison(
  left: { artifactId: string; doc: PDFDocumentProxy | null } | null,
  right: { artifactId: string; doc: PDFDocumentProxy | null } | null,
): PdfComparison {
  const [features, setFeatures] = useState<{
    key: string;
    left: PdfPageFeature[];
    right: PdfPageFeature[];
  } | null>(null);
  const [status, setStatus] = useState<PdfComparison["status"]>("idle");
  const key = left && right ? `${left.artifactId}|${right.artifactId}` : "";
  const override = useQuery(
    api.comparisons.getOverride,
    left && right ? { leftArtifactId: left.artifactId, rightArtifactId: right.artifactId } : "skip",
  );
  const save = useMutation(api.comparisons.saveOverride);

  useEffect(() => {
    if (!left?.doc || !right?.doc) return;
    let cancelled = false;
    setStatus("analyzing");
    void Promise.all([
      pdfFeatures(left.artifactId, left.doc),
      pdfFeatures(right.artifactId, right.doc),
    ])
      .then(([l, r]) => {
        if (cancelled) return;
        setFeatures({ key, left: l, right: r });
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [key, left?.doc, right?.doc]);

  const f = features && features.key === key ? features : null;
  const autoPairs = useMemo(() => (f ? alignPages(f.left, f.right) : []), [f]);
  const manual = override?.pairs ?? [];
  const pairs = useMemo(
    () => applyManualPairs(autoPairs, manual),
    [autoPairs, JSON.stringify(manual)],
  );

  const anchorCache = useMemo(() => new Map<string, ScrollAnchor[]>(), [f]);
  const anchorsFor = useCallback(
    (lp: number, rp: number) => {
      if (!f) return undefined;
      const k = `${lp}:${rp}`;
      let a = anchorCache.get(k);
      if (!a) {
        const L = f.left[lp - 1];
        const R = f.right[rp - 1];
        if (!L || !R) return undefined;
        a = lineAnchors(L.lines, R.lines);
        anchorCache.set(k, a);
      }
      return a;
    },
    [f, anchorCache],
  );

  const diffCache = useMemo(() => new Map<string, PageDiffRect[]>(), [f, pairs]);
  const diffRects = useCallback(
    (side: "left" | "right", page: number): PageDiffRect[] => {
      if (!f) return [];
      const k = `${side}:${page}`;
      const hit = diffCache.get(k);
      if (hit) return hit;
      const pair = pairs.find((p) => (side === "left" ? p.left : p.right) === page);
      const mine = (side === "left" ? f.left : f.right)[page - 1];
      let out: PageDiffRect[] = [];
      if (mine && pair) {
        const otherPage = side === "left" ? pair.right : pair.left;
        const other =
          otherPage !== null ? (side === "left" ? f.right : f.left)[otherPage - 1] : undefined;
        if (!other) {
          // 対応するページが無い: そのページの文章は全部「追加 / 削除」
          out = rectsForRange(mine.items, 0, mine.text.length).map((r) => ({
            ...r,
            kind: side === "left" ? "delete" : "insert",
          }));
        } else {
          const d =
            side === "left" ? diffText(mine.text, other.text) : diffText(other.text, mine.text);
          for (const h of diffHighlights(d, side === "left" ? "old" : "new")) {
            if (h.kind === "change") continue; // 段落全体の枠は描かず、変わった文字だけを塗る
            for (const r of rectsForRange(mine.items, h.start, h.end))
              out.push({ ...r, kind: h.kind });
          }
        }
      }
      diffCache.set(k, out);
      return out;
    },
    [f, pairs, diffCache],
  );

  return {
    status,
    pairs,
    autoPairs,
    manual,
    leftCount: f?.left.length ?? 0,
    rightCount: f?.right.length ?? 0,
    anchorsFor,
    diffRects,
    saveManual: async (next) => {
      if (!left || !right) return;
      await save({
        leftArtifactId: left.artifactId,
        rightArtifactId: right.artifactId,
        pairs: next,
      });
    },
  };
}
