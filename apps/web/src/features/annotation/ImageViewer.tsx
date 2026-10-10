import type { NormalizedRect, Viewport } from "@mf100/domain";
import { useState } from "react";
import { M3eIconButton, M3eIcon } from "@/ui/m3e";
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
}: Props) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const viewport: Viewport | null = natural
    ? { width: natural.w * scale, height: natural.h * scale, rotation: 0 }
    : null;
  const mine = threads.filter(
    (t) =>
      (t.anchor.type === "image_rect" || t.anchor.type === "image_pin") &&
      t.anchor.artifactId === artifactId,
  );
  return (
    <div className="viewer">
      <div className="viewer__toolbar" role="toolbar" aria-label="画像操作">
        <M3eIconButton aria-label="縮小" onClick={() => setScale((s) => Math.max(0.2, s - 0.1))}>
          <M3eIcon>zoom_out</M3eIcon>
        </M3eIconButton>
        <span className="small">{Math.round(scale * 100)}%</span>
        <M3eIconButton aria-label="拡大" onClick={() => setScale((s) => Math.min(4, s + 0.1))}>
          <M3eIcon>zoom_in</M3eIcon>
        </M3eIconButton>
        {natural ? (
          <span className="small muted">
            {natural.w}×{natural.h}px
          </span>
        ) : null}
        {selecting ? (
          <span className="chip chip--warn">ドラッグで範囲、クリックでピンを指定</span>
        ) : null}
      </div>
      <div className="viewer__stage">
        <div className="viewer__page">
          <img
            src={url}
            alt="校正対象の画像"
            style={viewport ? { width: viewport.width, height: viewport.height } : undefined}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              setScale(Math.min(1, 900 / img.naturalWidth));
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
        </div>
      </div>
    </div>
  );
}
