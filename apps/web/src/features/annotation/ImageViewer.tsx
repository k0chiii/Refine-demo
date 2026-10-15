import type { NormalizedRect, Viewport } from "@mf100/domain";
import { useEffect, useState, type ReactNode } from "react";
import { AnchorOverlay, type OverlayThread } from "./AnchorOverlay";
import { useStageWidth } from "./useStageWidth";

interface Props {
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
}

/** 画像ビューア。座標は原画像基準の 0..1（表示幅に依存しない）。 */
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
  const mine = threads.filter(
    (t) =>
      (t.anchor.type === "image_rect" || t.anchor.type === "image_pin") &&
      t.anchor.artifactId === artifactId,
  );
  return (
    <div className="viewer">
      <div className="viewer__stage" tabIndex={0} ref={stageRef}>
        <div className="viewer__page">
          <img
            src={url}
            alt={alt}
            style={viewport ? { width: viewport.width, height: viewport.height } : undefined}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
          {viewport ? (
            <AnchorOverlay
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
