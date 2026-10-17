import type { NormalizedRect, Viewport } from "@mf100/domain";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnchorOverlay, type OverlayThread } from "./AnchorOverlay";
import { useStageWidth } from "./useStageWidth";
import { useViewerSync, type ViewerSyncProps } from "./viewerSync";

interface Props extends ViewerSyncProps {
  url: string;
  artifactId: string;
  /** 画像の代替テキスト（どの版のどの添付か。例: 第2版の添付「poster.png」） */
  alt: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  selecting: boolean;
  draft: { rect?: NormalizedRect; point?: { x: number; y: number } } | null;
  onDraft: (d: { rect?: NormalizedRect; point?: { x: number; y: number } } | null) => void;
  /** 幅に合わせた大きさに掛ける倍率（1 ＝ 左右の余白が同じになる幅） */
  scale: number;
  /** 紙面の横に並べる列の幅＋間隔。幅合わせから差し引く */
  besideWidth?: number;
  /** 原寸に対する表示倍率（1 ＝ 100%）を返す */
  onZoom?: (actual: number) => void;
  renderInPage?: (vp: Viewport) => ReactNode;
  renderGutter?: (vp: Viewport) => ReactNode;
  /** 画像を読み込み終えて大きさ・倍率が決まった（失敗したときも）。親はそれまで紙面を隠して読み込み中の指標を出す（§65） */
  onReady?: () => void;
  /** 印を付けないとき（書き込み「なし」）: 印の層は押す・なぞるを通す（画像の長押しなど、紙面そのものの操作が効く） */
  passive?: boolean;
}

/**
 * 画像ビューア。座標は原画像基準の 0..1（表示幅に依存しない）。
 * 倍率を変えても焦点の下の箇所を保ち、版比較では PDF と同じ操作（controller・onUserScroll）で縦・横を同期する。
 */
export function ImageViewer({
  url,
  artifactId,
  alt,
  threads,
  activeThreadId,
  onSelectThread,
  selecting,
  draft,
  onDraft,
  scale,
  besideWidth = 0,
  onZoom,
  renderInPage,
  renderGutter,
  onReady,
  passive = false,
  ...sync
}: Props) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stageRef, stageWidth] = useStageWidth<HTMLDivElement>(true);
  // 最初は舞台の内容幅（横の列を除く）に合わせる。左右の余白が同じになる
  const fit =
    natural && stageWidth > 0 ? Math.max(0.05, (stageWidth - besideWidth) / natural.w) : 0;
  const viewport: Viewport | null =
    natural && fit > 0
      ? { width: natural.w * fit * scale, height: natural.h * fit * scale, rotation: 0 }
      : null;
  useEffect(() => {
    if (fit > 0) onZoom?.(fit * scale);
  }, [fit, scale]);
  // 大きさが決まって倍率が親に伝わった時点で知らせる（親が倍率の数値と紙面を同時に出せるよう、onZoom の後）
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    if (viewport) readyRef.current?.();
  }, [viewport !== null]);
  const imgRef = useRef<HTMLImageElement>(null);
  const { onScroll } = useViewerSync(
    stageRef,
    viewport ? fit * scale : 0,
    () => [imgRef.current],
    sync,
  );
  const mine = threads.filter(
    (t) =>
      (t.anchor.type === "image_rect" || t.anchor.type === "image_pin") &&
      t.anchor.artifactId === artifactId,
  );
  return (
    <div className="viewer">
      <div className="viewer__stage" tabIndex={0} ref={stageRef} onScroll={onScroll}>
        <div className="viewer__page">
          <img
            ref={imgRef}
            src={url}
            alt={alt}
            style={viewport ? { width: viewport.width, height: viewport.height } : undefined}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => onReady?.()}
          />
          {viewport ? (
            <AnchorOverlay
              passive={passive}
              viewport={viewport}
              threads={mine}
              activeThreadId={activeThreadId}
              onSelectThread={onSelectThread}
              selecting={selecting}
              draft={draft}
              onDraft={onDraft}
            />
          ) : null}
          {viewport ? renderInPage?.(viewport) : null}
        </div>
        {viewport && renderGutter ? renderGutter(viewport) : null}
      </div>
    </div>
  );
}
