import {
  fromViewportRect,
  toViewportRect,
  type Anchor,
  type NormalizedRect,
  type Viewport,
} from "@mf100/domain";
import { useRef, useState, type PointerEvent } from "react";

export interface OverlayThread {
  id: string;
  anchor: Anchor;
  severity: string;
  index: number;
}

interface Props {
  viewport: Viewport;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  /** 選択モードのとき、ドラッグで矩形、クリックでピンを確定する */
  selecting: boolean;
  onDraft: (draft: { rect?: NormalizedRect; point?: { x: number; y: number } }) => void;
  draft: { rect?: NormalizedRect; point?: { x: number; y: number } } | null;
  filterPage?: (anchor: Anchor) => boolean;
}

/**
 * PDF / 画像の上に重ねる SVG レイヤー。保存値は常に正規化座標で、表示倍率・回転は Viewport で吸収する（A-03）。
 */
export function AnchorOverlay({
  viewport,
  threads,
  activeThreadId,
  onSelectThread,
  selecting,
  onDraft,
  draft,
  filterPage,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const toLocal = (e: PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - rect.left, 0), viewport.width),
      y: Math.min(Math.max(e.clientY - rect.top, 0), viewport.height),
    };
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!selecting || e.button !== 0) return;
    const p = toLocal(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = toLocal(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    if (w < 6 && h < 6) {
      const n = fromViewportRect({ x: drag.x0, y: drag.y0, w: 1, h: 1 }, viewport);
      onDraft({ point: { x: n.x, y: n.y } });
    } else {
      onDraft({
        rect: fromViewportRect(
          { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w, h },
          viewport,
        ),
      });
    }
    setDrag(null);
  };

  const visible = threads.filter((t) => (filterPage ? filterPage(t.anchor) : true));

  return (
    <svg
      ref={svgRef}
      className="viewer__overlay"
      width={viewport.width}
      height={viewport.height}
      role="img"
      aria-label="コメント位置レイヤー"
      style={{ cursor: selecting ? "crosshair" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {visible.map((t) => {
        const a = t.anchor;
        const active = t.id === activeThreadId;
        const cls = `${active ? "anchor-rect--active" : ""} ${t.severity === "critical" ? "anchor-rect--critical" : ""}`;
        if (a.type === "pdf_rect" || a.type === "image_rect") {
          const px = toViewportRect(a.rect, viewport);
          return (
            <g
              key={t.id}
              onClick={() => onSelectThread(t.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onSelectThread(t.id)}
              aria-label={`指摘 ${t.index}`}
            >
              <rect
                className={`anchor-rect ${cls}`}
                x={px.x}
                y={px.y}
                width={px.w}
                height={px.h}
                rx={2}
              />
              <circle cx={px.x} cy={px.y} r={10} className="anchor-pin" />
              <text className="anchor-label" x={px.x} y={px.y + 4} textAnchor="middle">
                {t.index}
              </text>
            </g>
          );
        }
        if (a.type === "pdf_pin" || a.type === "image_pin") {
          const px = toViewportRect({ x: a.point.x, y: a.point.y, w: 0.0001, h: 0.0001 }, viewport);
          return (
            <g
              key={t.id}
              onClick={() => onSelectThread(t.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onSelectThread(t.id)}
              aria-label={`指摘 ${t.index}`}
            >
              <circle cx={px.x} cy={px.y} r={active ? 13 : 10} className="anchor-pin" />
              <text className="anchor-label" x={px.x} y={px.y + 4} textAnchor="middle">
                {t.index}
              </text>
            </g>
          );
        }
        return null;
      })}
      {draft?.rect
        ? (() => {
            const px = toViewportRect(draft.rect, viewport);
            return <rect className="anchor-draft" x={px.x} y={px.y} width={px.w} height={px.h} />;
          })()
        : null}
      {draft?.point
        ? (() => {
            const px = toViewportRect(
              { x: draft.point.x, y: draft.point.y, w: 0.0001, h: 0.0001 },
              viewport,
            );
            return <circle className="anchor-draft" cx={px.x} cy={px.y} r={10} />;
          })()
        : null}
      {drag ? (
        <rect
          className="anchor-draft"
          x={Math.min(drag.x0, drag.x1)}
          y={Math.min(drag.y0, drag.y1)}
          width={Math.abs(drag.x1 - drag.x0)}
          height={Math.abs(drag.y1 - drag.y0)}
        />
      ) : null}
    </svg>
  );
}
