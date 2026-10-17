import {
  fromViewportRect,
  toViewportRect,
  type Anchor,
  type NormalizedRect,
  type Viewport,
} from "@mf100/domain";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { haptic } from "@/lib/haptics";

/** タッチで範囲選択を始めるまでの長押しの時間と、長押しとみなす指のぶれの上限 */
export const LONG_PRESS_MS = 320;
const LONG_PRESS_SLOP = 10;
/** 長押しの手応え: 指が触れてからこの時間だけ待って、指の周りの輪を満たし始める（スクロールのたびに輪が出ないように） */
const CHARGE_DELAY_MS = 80;
/** 指の周りの輪の半径（指先に隠れず、外にはみ出して見える大きさ） */
const CHARGE_R = 56;

export interface OverlayThread {
  id: string;
  anchor: Anchor;
  severity: string;
  index: number;
  /** 相談（FB）。解決するコメントと見分けるため、色（tertiary）と形（角丸の四角）を変える */
  kind?: "comment" | "feedback";
}

/** 支援技術向けの名前（コメント 3 / 相談 2） */
export const overlayLabel = (t: Pick<OverlayThread, "kind" | "index">) =>
  `${t.kind === "feedback" ? "FB" : "コメント"} ${t.index}`;

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
 * - 長押しの手応え（利用者指示 2026-10-16）: 押している間は指の周りの輪が満ちていき（M3 の円形の進捗表示の見た目）、
 *   満ちて選択が始まると輪が弾けて、端末が軽く震える（震えられる端末だけ）。離してコメントの位置を置いたときも軽く震える
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
  /**
   * 長押しの輪（満ちていく途中）と、満ちた瞬間に弾ける輪。key で描き直してアニメーションを始めからにする。
   * 位置は画面の座標（clientX/Y）。紙面の枠で切れないよう、紙面の外の画面全体の層に描く（下の createPortal）
   */
  const [charge, setCharge] = useState<{ x: number; y: number; key: number } | null>(null);
  const [pop, setPop] = useState<{ x: number; y: number; key: number } | null>(null);
  const clearPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setCharge(null);
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

  /** 既存の範囲の面の上から選び始めたときの、その範囲のスレッド（動かさずに離したら、そのスレッドを開く） */
  const startedOn = useRef<string | null>(null);
  /** 選び終えた直後（その直後の click でスレッドを開かない） */
  const drewAt = useRef(0);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!selecting || e.button !== 0) return;
    // ピン・番号（押せる印）の上では選択を始めない（押すとそのスレッドを開く）。
    // 範囲の面の上からは重ねて選べる（同じ場所に別のコメント。利用者指示 2026-10-16）
    const onAnchor = (e.target as Element).closest("[data-anchor]");
    if (onAnchor && !(e.target as Element).classList.contains("anchor-rect")) return;
    startedOn.current = onAnchor?.getAttribute("data-anchor") ?? null;
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
      setCharge({ x: e.clientX, y: e.clientY, key: e.timeStamp });
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
          haptic();
          setCharge(null);
          setPop({ x: cur.cx, y: cur.cy, key: Date.now() });
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
      haptic(); // 位置を置いた手応え（指を離す操作の中なので iPhone でも震えやすい）
    }
    if (!drag) return;
    // 範囲の面の上で、動かさずに離した（マウスのクリック）: 新しく作らず、その範囲のスレッドを開く
    if (
      startedOn.current &&
      e.pointerType !== "touch" &&
      Math.abs(drag.x1 - drag.x0) < 6 &&
      Math.abs(drag.y1 - drag.y0) < 6
    ) {
      onSelectThread(startedOn.current);
      startedOn.current = null;
      setDrag(null);
      return;
    }
    startedOn.current = null;
    drewAt.current = Date.now();
    finish(drag);
    setDrag(null);
  };
  const onPointerCancel = () => {
    clearPress();
    startedOn.current = null;
    setDrag(null);
  };
  /** 印を押してスレッドを開く（範囲を選び終えた直後の click では開かない） */
  const openThread = (id: string) => {
    if (Date.now() - drewAt.current < 400) return;
    onSelectThread(id);
  };

  const visible = threads.filter((t) => (filterPage ? filterPage(t.anchor) : true));

  const overlay = (
    <svg
      ref={svgRef}
      className="viewer__overlay"
      width={viewport.width}
      height={viewport.height}
      // 中に押せるピン・範囲があるので img ではなく group（img の子は支援技術から見えない。§35 I-08）
      role="group"
      aria-label="コメント・相談の位置"
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
        const fb = t.kind === "feedback";
        const cls = `${active ? "anchor-rect--active" : ""} ${t.severity === "critical" ? "anchor-rect--critical" : ""} ${fb ? "anchor-rect--fb" : ""}`;
        const pinCls = `anchor-pin ${active ? "anchor-pin--active" : ""} ${fb ? "anchor-pin--fb" : ""}`;
        // 相談の印は角丸の四角（コメントは丸）。色だけに頼らず形でも見分けられるように
        const pin = (cx: number, cy: number, r: number) =>
          fb ? (
            <rect
              x={cx - r}
              y={cy - r}
              width={r * 2}
              height={r * 2}
              rx={r * 0.45}
              className={pinCls}
            />
          ) : (
            <circle cx={cx} cy={cy} r={r} className={pinCls} />
          );
        if (a.type === "pdf_rect" || a.type === "image_rect") {
          const px = toViewportRect(a.rect, viewport);
          return (
            <g
              key={t.id}
              data-anchor={t.id}
              onClick={() => openThread(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onSelectThread(t.id);
              }}
              aria-label={overlayLabel(t)}
            >
              <rect
                className={`anchor-rect ${cls}`}
                x={px.x}
                y={px.y}
                width={px.w}
                height={px.h}
                rx={2}
              />
              {/* 見た目は小さいピンでも、押せる範囲は 48×48（M3 Accessibility › Target sizes。§35 I-09） */}
              <circle cx={px.x} cy={px.y} r={24} className="anchor-hit" />
              {pin(px.x, px.y, 10)}
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
              onClick={() => openThread(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onSelectThread(t.id);
              }}
              aria-label={overlayLabel(t)}
            >
              <circle cx={px.x} cy={px.y} r={24} className="anchor-hit" />
              {pin(px.x, px.y, active ? 13 : 10)}
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
  const pressLayer =
    charge || pop
      ? createPortal(
          <svg className="press-layer" aria-hidden="true">
            {charge ? (
              <g
                key={charge.key}
                className="press-charge"
                transform={`translate(${charge.x} ${charge.y})`}
                style={
                  {
                    "--press-delay": `${CHARGE_DELAY_MS}ms`,
                    "--press-ms": `${LONG_PRESS_MS - CHARGE_DELAY_MS}ms`,
                  } as CSSProperties
                }
                aria-hidden="true"
              >
                <circle r={CHARGE_R} className="press-charge__track" />
                <circle r={CHARGE_R} pathLength={100} className="press-charge__ring" />
              </g>
            ) : null}
            {pop ? (
              <circle
                key={pop.key}
                cx={pop.x}
                cy={pop.y}
                r={CHARGE_R}
                className="press-pop"
                aria-hidden="true"
                onAnimationEnd={() => setPop(null)}
              />
            ) : null}
          </svg>,
          document.body,
        )
      : null;
  return (
    <>
      {overlay}
      {pressLayer}
    </>
  );
}
