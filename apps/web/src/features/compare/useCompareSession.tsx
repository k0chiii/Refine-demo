import {
  diffHighlights,
  diffText,
  interpolate,
  mapImagePosition,
  mapPosition,
  paragraphAnchors,
  type DiffHighlight,
  type ScrollAnchor,
  type Viewport,
} from "@mf100/domain";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SYNC_AT,
  type StagePoint,
  type ViewerController,
  type ViewPosition,
} from "@/features/annotation/viewerSync";
import { documentView } from "@/features/writing/documentView";
import type { TextViewerController } from "./textSync";
import { usePdfComparison, type PdfComparison } from "./useComparison";

type Side = "left" | "right";
interface ViewSyncProps {
  controller: { current: ViewerController | null };
  onUserScroll: (pos: ViewPosition) => void;
  onZoomKept: (at: StagePoint, gesture: boolean) => void;
}
interface ArtifactLike {
  id: string;
  type: string;
  fileName: string;
  mimeType?: string;
}

export interface CompareSession {
  active: boolean;
  kind: "pdf" | "document" | "image" | "other";
  syncOn: boolean;
  setSyncOn: (on: boolean) => void;
  diffOn: boolean;
  setDiffOn: (on: boolean) => void;
  /** 同期できない理由（対応ページなし）。表示用 */
  syncNote: string | null;
  pdf: PdfComparison;
  /** PDF ビューアに渡すもの（side ごと） */
  pdfProps: (side: Side) => ViewSyncProps & { onDoc: (d: PDFDocumentProxy) => void };
  /** 画像ビューアに渡すもの（side ごと） */
  imageProps: (side: Side) => ViewSyncProps;
  /** ページの上に重ねる比較用の表示（差分の塗り、対応なしの札） */
  pageOverlay: (side: Side, vp: Viewport, page: number) => ReactNode;
  /** 文章の比較（差分の強調・同期） */
  textProps: (side: Side) => {
    diff?: DiffHighlight[];
    controller: { current: TextViewerController | null };
    onUserScroll: () => void;
  };
  /** 旧版の文章（テキスト・書式付き） */
  otherText: { body: string; html?: string } | null;
  stats: { inserted: number; deleted: number; changed: number; moved: number } | null;
}

/**
 * 版比較の状態（ページ対応・スクロール同期・差分）。Editor から使う。
 * - 同期は「対応する行 → ページ内の位置 → ページ対応」の順に写し、対応ページが無ければ止めて理由を出す
 * - プログラムからのスクロールは各ビューアが利用者の操作として通知しないので、往復のループにならない
 * - 同期を入れたときは、最後に操作していた側の位置を保ち、もう一方だけを動かす
 * - PDF・画像は縦に加えて横の位置も合わせる。倍率は左右で共通で、拡大縮小したら操作した側（ピンチ・Ctrl＋ホイールの側、
 *   ボタンなら最後に操作していた側）の焦点の下の箇所に、もう一方の同じ点を合わせる（ズームでの視点の同期）
 */
export function useCompareSession(opts: {
  active: boolean;
  left: ArtifactLike | null;
  right: ArtifactLike | null;
  leftBlob: Blob | null;
  /** 新版（表示中の版）の平文（文章のとき） */
  rightText: string | null;
}): CompareSession {
  const { active, left, right, leftBlob } = opts;
  const [syncOn, setSyncOnRaw] = useState(true);
  const [diffOn, setDiffOn] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [docs, setDocs] = useState<{
    left: PDFDocumentProxy | null;
    right: PDFDocumentProxy | null;
  }>({ left: null, right: null });
  // PDF・画像のビューア（左右とも同じ種類）
  const viewCtl = {
    left: useRef<ViewerController | null>(null),
    right: useRef<ViewerController | null>(null),
  };
  const textCtl = {
    left: useRef<TextViewerController | null>(null),
    right: useRef<TextViewerController | null>(null),
  };
  const lastSide = useRef<Side>("right");
  const frame = useRef(0);
  /** 拡大縮小で基準にする側と焦点（同じ描画で左右から届くので、まとめて 1 回だけ合わせる） */
  const zoomLead = useRef<{ side: Side; at: StagePoint } | null>(null);

  const kind: CompareSession["kind"] =
    !left || !right
      ? "other"
      : left.type === "pdf" && right.type === "pdf"
        ? "pdf"
        : left.type === "document" && right.type === "document"
          ? "document"
          : left.type === "image" && right.type === "image"
            ? "image"
            : "other";

  // 添付が替わった側だけ PDF の文書を忘れる（ビューアは読み込んだときにしか onDoc を呼ばないので、
  // 替わっていない側まで消すと、比べる相手を替えた後にページの対応が二度と解析されない）
  useEffect(() => {
    setDocs((cur) => (cur.left === null ? cur : { ...cur, left: null }));
  }, [left?.id]);
  useEffect(() => {
    setDocs((cur) => (cur.right === null ? cur : { ...cur, right: null }));
  }, [right?.id]);
  useEffect(() => {
    setSyncNote(null);
  }, [left?.id, right?.id]);

  const pdf = usePdfComparison(
    active && kind === "pdf" && left ? { artifactId: left.id, doc: docs.left } : null,
    active && kind === "pdf" && right ? { artifactId: right.id, doc: docs.right } : null,
  );

  // 旧版の文章
  const [otherText, setOtherText] = useState<{ id: string; body: string; html?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!active || kind !== "document" || !left || !leftBlob) return;
    let cancelled = false;
    void leftBlob
      .text()
      .then((t) => documentView(left, t))
      .then((view) => {
        if (!cancelled) setOtherText({ id: left.id, ...view });
      });
    return () => {
      cancelled = true;
    };
  }, [active, kind, left?.id, leftBlob]);
  const other = otherText && left && otherText.id === left.id ? otherText : null;
  const textDiff = useMemo(
    () => (other && opts.rightText !== null ? diffText(other.body, opts.rightText) : null),
    [other, opts.rightText],
  );

  // ---------- 同期
  const syncPdf = (from: Side, pos: ViewPosition, at: StagePoint = SYNC_AT) => {
    const mapped = mapPosition(pos, from, pdf.pairs, pdf.anchorsFor);
    if (!mapped) {
      setSyncNote(
        from === "right"
          ? `新版 ${pos.page} ページは旧版に対応するページがありません（追加）。同期を止めています`
          : `旧版 ${pos.page} ページは新版に対応するページがありません（削除）。同期を止めています`,
      );
      return;
    }
    setSyncNote(null);
    viewCtl[from === "left" ? "right" : "left"].current?.scrollToPosition(mapped, at);
  };
  const syncImage = (from: Side, pos: ViewPosition, at: StagePoint = SYNC_AT) => {
    viewCtl[from === "left" ? "right" : "left"].current?.scrollToPosition(
      mapImagePosition(pos),
      at,
    );
  };
  /** 一方の舞台の at の点にある箇所を、もう一方の同じ点に合わせる */
  const syncView = (from: Side, at: StagePoint = SYNC_AT) => {
    const pos = viewCtl[from].current?.getPosition(at);
    if (!pos) return;
    if (kind === "pdf") syncPdf(from, pos, at);
    else if (kind === "image") syncImage(from, pos, at);
  };
  const syncText = (from: Side) => {
    if (!textDiff) return;
    const src = textCtl[from].current;
    const dst = textCtl[from === "left" ? "right" : "left"].current;
    const sStage = src?.stage();
    const dStage = dst?.stage();
    if (!src || !dst || !sStage || !dStage) return;
    const points: ScrollAnchor[] = [{ left: 0, right: 0 }];
    for (const a of paragraphAnchors(textDiff)) {
      const yl = textCtl.left.current?.yOf(a.old);
      const yr = textCtl.right.current?.yOf(a.new);
      if (yl === null || yl === undefined || yr === null || yr === undefined) continue;
      const last = points[points.length - 1]!;
      if (yl >= last.left && yr >= last.right) points.push({ left: yl, right: yr });
    }
    const line = sStage.scrollTop + sStage.clientHeight * 0.4;
    const target = interpolate(points, line, from);
    dst.markProgrammatic();
    dStage.scrollTop = Math.max(0, target - dStage.clientHeight * 0.4);
  };
  const onScroll = (from: Side, pos?: ViewPosition) => {
    lastSide.current = from;
    if (!syncOn) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (kind === "pdf" && pos) syncPdf(from, pos);
      else if (kind === "image" && pos) syncImage(from, pos);
      else if (kind === "document") syncText(from);
    });
  };
  // 倍率が変わった: 両方のビューアがそれぞれ焦点を保った後（同じ描画の layout effect）に、基準の側へもう一方を合わせる。
  // マイクロタスクで待つので画面に出る前に揃い、プログラムからのスクロールなので往復しない
  const onZoomKept = (side: Side, at: StagePoint, gesture: boolean) => {
    const first = zoomLead.current === null;
    if (gesture) zoomLead.current = { side, at };
    else if (first) zoomLead.current = { side: lastSide.current, at };
    if (gesture) lastSide.current = side;
    if (!first) return;
    queueMicrotask(() => {
      const lead = zoomLead.current;
      zoomLead.current = null;
      if (!lead || !syncOn || (kind !== "pdf" && kind !== "image")) return;
      cancelAnimationFrame(frame.current);
      syncView(lead.side, lead.at);
    });
  };
  const setSyncOn = useCallback(
    (on: boolean) => {
      setSyncOnRaw(on);
      setSyncNote(null);
      if (!on) return;
      // 最後に操作していた側を基準に、もう一方だけを合わせる（閲覧位置が飛ばない）
      const from = lastSide.current;
      requestAnimationFrame(() => {
        if (kind === "pdf" || kind === "image") syncView(from);
        else if (kind === "document") syncText(from);
      });
    },
    [kind, pdf.pairs, textDiff],
  );

  const pageOverlay = (side: Side, vp: Viewport, page: number): ReactNode => {
    if (!active || kind !== "pdf" || pdf.status !== "ready") return null;
    const pair = pdf.pairs.find((p) => (side === "left" ? p.left : p.right) === page);
    const otherPage = pair ? (side === "left" ? pair.right : pair.left) : null;
    const label =
      otherPage === null
        ? side === "left"
          ? "新版に対応するページなし（削除）"
          : "旧版に対応するページなし（追加）"
        : pair?.kind === "moved"
          ? `${side === "left" ? "新版" : "旧版"} ${otherPage} ページへ移動`
          : pair?.kind === "manual"
            ? `${side === "left" ? "新版" : "旧版"} ${otherPage} ページ（手動）`
            : pair && pair.confidence !== "high"
              ? `${side === "left" ? "新版" : "旧版"} ${otherPage} ページ（推定・${pair.confidence === "medium" ? "中" : "低"}）`
              : null;
    const rects = diffOn ? pdf.diffRects(side, page) : [];
    return (
      <>
        {rects.length > 0 ? (
          <div className="diff-layer" aria-hidden="true">
            {rects.map((r, i) => (
              <span
                key={i}
                className={`diff-box diff-box--${r.kind}`}
                style={{
                  left: r.x * vp.width,
                  top: r.y * vp.height,
                  width: r.w * vp.width,
                  height: r.h * vp.height,
                }}
              />
            ))}
          </div>
        ) : null}
        {label ? (
          <span className={`page-pair-chip ${otherPage === null ? "page-pair-chip--none" : ""}`}>
            {label}
          </span>
        ) : null}
      </>
    );
  };

  return {
    active,
    kind,
    syncOn,
    setSyncOn,
    diffOn,
    setDiffOn,
    syncNote,
    pdf,
    pdfProps: (side) => ({
      onDoc: (d) => setDocs((cur) => (cur[side] === d ? cur : { ...cur, [side]: d })),
      controller: viewCtl[side],
      onUserScroll: (pos) => onScroll(side, pos),
      onZoomKept: (at, gesture) => onZoomKept(side, at, gesture),
    }),
    imageProps: (side) => ({
      controller: viewCtl[side],
      onUserScroll: (pos) => onScroll(side, pos),
      onZoomKept: (at, gesture) => onZoomKept(side, at, gesture),
    }),
    pageOverlay,
    textProps: (side) => ({
      ...(diffOn && textDiff
        ? { diff: diffHighlights(textDiff, side === "left" ? "old" : "new") }
        : {}),
      controller: textCtl[side],
      onUserScroll: () => onScroll(side),
    }),
    otherText: other
      ? { body: other.body, ...(other.html !== undefined ? { html: other.html } : {}) }
      : null,
    stats: kind === "document" ? (textDiff?.stats ?? null) : null,
  };
}
