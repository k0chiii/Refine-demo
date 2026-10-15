import {
  fromViewportRect,
  toViewportRect,
  type Anchor,
  type NormalizedRect,
  type Viewport,
} from "@mf100/domain";
import { useEffect, useRef, useState, type PointerEvent } from "react";

/** タッチで範囲選択を始めるまでの長押しの時間と、長押しとみなす指のぶれの上限 */
export const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

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
 * - マウス・ペン: ドラッグで範囲、クリックでピン（従来どおり）
 * - タッチ: なぞるとふつうにスクロールする。**長押しすると選択が始まり**、そのまま指を動かすと範囲、離すとその場にピン。
 *   長押しの前に指が動いたらスクロールとして扱い、選択は始めない。短いタップでは何も作らない（ピン・範囲を押すとそのスレッドを開く）
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

  /** タッチの長押しの状態（armed になるまではスクロールに任せる） */
  const press = useRef<{
    id: number;
    cx: number;
    cy: number;
    x: number;
    y: number;
    timer: number;
    armed: boolean;
  } | null>(null);
  const clearPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => clearPress, []);
  // 長押しで選択が始まったら、指を動かしてもページがスクロールしないようにする（touchmove の既定動作を止める）
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onTouchMove = (e: TouchEvent) => {
      if (press.current?.armed) e.preventDefault();
    };
    svg.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => svg.removeEventListener("touchmove", onTouchMove);
  }, []);

  const finish = (d: { x0: number; y0: number; x1: number; y1: number }) => {
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
    if (w < 6 && h < 6) {
      const n = fromViewportRect({ x: d.x0, y: d.y0, w: 1, h: 1 }, viewport);
      onDraft({ point: { x: n.x, y: n.y } });
    } else {
      onDraft({
        rect: fromViewportRect(
          { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w, h },
          viewport,
        ),
      });
    }
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!selecting || e.button !== 0) return;
    // 既存のピン・範囲の上では選択を始めない（クリックはそのスレッドを開く）
    if ((e.target as Element).closest("[data-anchor]")) return;
    const p = toLocal(e);
    if (e.pointerType === "touch") {
      // 2 本目の指（ピンチ）: 長押しの選択はやめる
      if (press.current && press.current.id !== e.pointerId) {
        clearPress();
        setDrag(null);
        return;
      }
      clearPress();
      const id = e.pointerId;
      press.current = {
        id,
        cx: e.clientX,
        cy: e.clientY,
        ...p,
        armed: false,
        timer: window.setTimeout(() => {
          const cur = press.current;
          if (!cur || cur.id !== id) return;
          cur.armed = true;
          try {
            svgRef.current?.setPointerCapture(id);
          } catch {
            // 指がもう離れている
          }
          navigator.vibrate?.(10);
          setDrag({ x0: cur.x, y0: cur.y, x1: cur.x, y1: cur.y });
        }, LONG_PRESS_MS),
      };
      return;
    }
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const cur = press.current;
    if (cur && cur.id === e.pointerId && !cur.armed) {
      // 長押しの前に動いた → スクロール
      if (Math.hypot(e.clientX - cur.cx, e.clientY - cur.cy) > LONG_PRESS_SLOP) clearPress();
      return;
    }
    if (!drag) return;
    const p = toLocal(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const cur = press.current;
    if (cur && cur.id === e.pointerId) {
      const armed = cur.armed;
      clearPress();
      if (!armed) return; // 短いタップ: 何も作らない
    }
    if (!drag) return;
    finish(drag);
    setDrag(null);
  };
  const onPointerCancel = () => {
    clearPress();
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
      onPointerCancel={onPointerCancel}
      // 長押しで出るブラウザのメニュー（画像の保存など）を出さない
      onContextMenu={selecting ? (e) => e.preventDefault() : undefined}
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
              data-anchor={t.id}
              onClick={() => onSelectThread(t.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onSelectThread(t.id)}
              aria-label={`コメント ${t.index}`}
            >
              <rect
                className={`anchor-rect ${cls}`}
                x={px.x}
                y={px.y}
                width={px.w}
                height={px.h}
                rx={2}
              />
              <circle
                cx={px.x}
                cy={px.y}
                r={10}
                className={`anchor-pin ${active ? "anchor-pin--active" : ""}`}
              />
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
              data-anchor={t.id}
              onClick={() => onSelectThread(t.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onSelectThread(t.id)}
              aria-label={`コメント ${t.index}`}
            >
              <circle
                cx={px.x}
                cy={px.y}
                r={active ? 13 : 10}
                className={`anchor-pin ${active ? "anchor-pin--active" : ""}`}
              />
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
