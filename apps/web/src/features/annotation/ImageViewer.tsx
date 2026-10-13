import type { NormalizedRect, Viewport } from "@mf100/domain";
import { useState, type ReactNode } from "react";
import { AnchorOverlay, type OverlayThread } from "./AnchorOverlay";

interface Props {
  url: string;
  artifactId: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  selecting: boolean;
  draft: { rect?: NormalizedRect; point?: { x: number; y: number } } | null;
  onDraft: (d: { rect?: NormalizedRect; point?: { x: number; y: number } } | null) => void;
  /** 表示倍率は親が持つ（1 = 幅 900px に収める） */
  scale: number;
  renderInPage?: (vp: Viewport) => ReactNode;
  renderGutter?: (vp: Viewport) => ReactNode;
}

/** 画像ビューア。座標は原画像基準の 0..1（表示幅に依存しない）。 */
export function ImageViewer({
  url,
  artifactId,
  threads,
  activeThreadId,
  onSelectThread,
  selecting,
  draft,
  onDraft,
  scale,
  renderInPage,
  renderGutter,
}: Props) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const fit = natural ? Math.min(1, 900 / natural.w) : 1;
  const viewport: Viewport | null = natural
    ? { width: natural.w * fit * scale, height: natural.h * fit * scale, rotation: 0 }
    : null;
  const mine = threads.filter(
    (t) =>
      (t.anchor.type === "image_rect" || t.anchor.type === "image_pin") &&
      t.anchor.artifactId === artifactId,
  );
  return (
    <div className="viewer">
      <div className="viewer__stage" tabIndex={0}>
        <div className="viewer__page">
          <img
            src={url}
            alt="校正対象の画像"
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
