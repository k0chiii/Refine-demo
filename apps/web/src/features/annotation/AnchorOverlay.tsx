import {
  fromViewportRect,
  toViewportRect,
  type Anchor,
  type NormalizedRect,
  type Viewport,
} from "@mf100/domain";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { haptic } from "@/lib/haptics";
import { portalHost } from "@/lib/portalHost";
import {
  chargeDelayMs,
  holdMs,
  kindOf,
  moveOutcome,
  shapeOf,
  type PointerKind,
} from "./markGesture";

/** 長押しの手応え: 指の周りの輪の半径（指先に隠れず、外にはみ出して見える大きさ） */
const CHARGE_R = 56;

export interface OverlayThread {
  id: string;
  anchor: Anchor;
  severity: string;
  index: number;
}

/** 支援技術向けの名前（コメント 3） */
export const overlayLabel = (t: Pick<OverlayThread, "index">) => `コメント ${t.index}`;

interface Props {
  viewport: Viewport;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  /** コメントを付けられるか。付けられるとき、なぞって範囲・長押しでピンを確定する（クリックはふつうのクリック） */
  canComment: boolean;
  /** 範囲・ピンを置き始めた（動画は映像を止める） */
  onGestureStart?: () => void;
  onDraft: (draft: { rect?: NormalizedRect; point?: { x: number; y: number } }) => void;
  draft: { rect?: NormalizedRect; point?: { x: number; y: number } } | null;
  filterPage?: (anchor: Anchor) => boolean;
}

type Drag = { x0: number; y0: number; x1: number; y1: number };
/** 長押しの輪（満ちていく途中・弾ける瞬間）。位置は画面の座標 */
export type ChargeMark = { x: number; y: number; key: number; kind: PointerKind };
export type PopMark = { x: number; y: number; key: number };
/** 押している途中（座標 c は画面、x・y は層の中。held: 長押しが済んだ） */
type Press = {
  id: number;
  kind: PointerKind;
  cx: number;
  cy: number;
  x: number;
  y: number;
  held: boolean;
  timer: number;
};

/**
 * PDF / 画像 / 動画の映像の上に重ねる SVG レイヤー。保存値は常に正規化座標で、表示倍率・回転は Viewport で吸収する（A-03）。
 * 印を付ける操作は **紙面の枠（この層の親）** で受ける。層そのものは押す・なぞるを下の紙面（PDF のリンクなど）へ通し、
 * 印そのもの（ピン・番号・範囲の面）だけが押せる。クリック・タップはふつうの操作で、位置付きコメントは次の 2 つだけ
 * （利用者指示 2026-10-20「タップはタップで長押しでコメント。PC もクリックはクリック、範囲選択のときだけコメント」）。
 * - 範囲をなぞる（ドラッグ）: 範囲。マウス・ペンは少し動かしたらすぐ、タッチは長押ししてから動かす（長押しの前はスクロール）
 * - 長押し: 離すとその場にピン（マウスは動かさず押し続ける、タッチは指を置いたまま）。範囲の面の上でもよい
 * 長押しの手応え（利用者指示 2026-10-16）: 押している間は指の周りの輪が満ちていき、満ちて選択が始まると輪が弾けて、
 * 端末が軽く震える（震えられる端末だけ）。離してコメントの位置を置いたときも軽く震える
 */
export function AnchorOverlay({
  viewport,
  threads,
  activeThreadId,
  onSelectThread,
  canComment,
  onGestureStart,
  onDraft,
  draft,
  filterPage,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragRect, setDragRect] = useState<Drag | null>(null);
  /**
   * 長押しの輪（満ちていく途中）と、満ちた瞬間に弾ける輪。key で描き直してアニメーションを始めからにする。
   * 位置は画面の座標（clientX/Y）。紙面の枠で切れないよう、紙面の外の画面全体の層に描く（下の createPortal）
   */
  const [charge, setCharge] = useState<ChargeMark | null>(null);
  const [pop, setPop] = useState<PopMark | null>(null);
  const live = useRef({ viewport, onDraft, onGestureStart });
  live.current = { viewport, onDraft, onGestureStart };

  useEffect(() => {
    const svg = svgRef.current;
    const host = svg?.parentElement;
    if (!svg || !host || !canComment) return;
    let press: Press | null = null;
    let drag: Drag | null = null;
    /** なぞり終えた・置いた直後（その直後の click を、リンク・スレッドを開く・再生などに渡さない） */
    let drewAt = 0;

    const toLocal = (cx: number, cy: number) => {
      const r = svg.getBoundingClientRect();
      const vp = live.current.viewport;
      return {
        x: Math.min(Math.max(cx - r.left, 0), vp.width),
        y: Math.min(Math.max(cy - r.top, 0), vp.height),
      };
    };
    const noSelect = (e: Event) => e.preventDefault();
    const clearPress = () => {
      if (press) window.clearTimeout(press.timer);
      press = null;
      setCharge(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("selectstart", noSelect);
    };
    const capture = (id: number) => {
      try {
        host.setPointerCapture(id);
      } catch {
        // 指がもう離れている
      }
    };
    const finish = (d: Drag) => {
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      const { viewport: vp, onDraft: emit } = live.current;
      if (shapeOf(w, h) === "point") {
        const n = fromViewportRect({ x: d.x0, y: d.y0, w: 1, h: 1 }, vp);
        emit({ point: { x: n.x, y: n.y } });
      } else {
        emit({
          rect: fromViewportRect({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w, h }, vp),
        });
      }
    };

    function onDown(e: PointerEvent) {
      if (e.pointerType !== "touch" && e.button !== 0) return;
      const t = e.target as Element;
      if (t.closest(".compose-pop, .thread-pop")) return;
      // ピン・番号（押せる印）の上では始めない（押すとそのスレッドを開く）。範囲の面の上からは重ねて付けられる
      if (t.closest("[data-anchor]") && !t.classList.contains("anchor-rect")) return;
      // 2 本目の指（ピンチ）: 長押しの選択はやめる
      if (press && press.id !== e.pointerId) {
        clearPress();
        drag = null;
        setDragRect(null);
        return;
      }
      clearPress();
      const id = e.pointerId;
      const kind = kindOf(e.pointerType);
      press = {
        id,
        kind,
        cx: e.clientX,
        cy: e.clientY,
        ...toLocal(e.clientX, e.clientY),
        held: false,
        timer: 0,
      };
      setCharge({ x: e.clientX, y: e.clientY, key: e.timeStamp, kind });
      press.timer = window.setTimeout(() => {
        const cur = press;
        if (!cur || cur.id !== id) return;
        cur.held = true;
        capture(id);
        haptic();
        setCharge(null);
        setPop({ x: cur.cx, y: cur.cy, key: Date.now() });
        drag = { x0: cur.x, y0: cur.y, x1: cur.x, y1: cur.y };
        setDragRect(drag);
        live.current.onGestureStart?.();
      }, holdMs(kind));
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      // なぞっている間に紙面の外の文字が選ばれないように
      document.addEventListener("selectstart", noSelect);
    }
    function onMove(e: PointerEvent) {
      const cur = press;
      if (!cur || cur.id !== e.pointerId) return;
      if (!drag) {
        const out = moveOutcome(
          cur.kind,
          cur.held,
          Math.hypot(e.clientX - cur.cx, e.clientY - cur.cy),
        );
        if (out === "wait") return;
        if (out === "scroll") {
          clearPress(); // 長押しの前に動いた → スクロール
          return;
        }
        // マウス: 少し動かしたら、押した所から範囲を始める
        window.clearTimeout(cur.timer);
        setCharge(null);
        capture(cur.id);
        drag = { x0: cur.x, y0: cur.y, x1: cur.x, y1: cur.y };
        live.current.onGestureStart?.();
      }
      const p = toLocal(e.clientX, e.clientY);
      drag = { ...drag, x1: p.x, y1: p.y };
      setDragRect(drag);
    }
    function onUp(e: PointerEvent) {
      const cur = press;
      if (!cur || cur.id !== e.pointerId) return;
      const d = drag;
      const dist = Math.hypot(e.clientX - cur.cx, e.clientY - cur.cy);
      clearPress();
      drag = null;
      setDragRect(null);
      if (d) {
        drewAt = Date.now();
        if (cur.held) haptic(); // 位置を置いた手応え（指を離す操作の中なので iPhone でも震えやすい）
        finish(d);
      }
    }
    function onCancel() {
      clearPress();
      drag = null;
      setDragRect(null);
    }
    // 長押しで指が動かせるあいだは、ページがスクロールしないようにする（touchmove の既定動作を止める）
    const onTouchMove = (e: TouchEvent) => {
      if (press?.held) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (Date.now() - drewAt > 400 || (e.target as Element).closest(".compose-pop")) return;
      e.stopPropagation();
      e.preventDefault();
    };
    // 長押しで出るブラウザのメニュー（画像の保存など）を出さない。リンクや画像をなぞっても、ブラウザの「ドラッグして移す」にしない
    const onContextMenu = (e: Event) => {
      if (press?.kind === "touch") e.preventDefault();
    };
    const onDragStart = (e: Event) => {
      if (!(e.target as Element).closest(".compose-pop")) e.preventDefault();
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("click", onClick, true);
    host.addEventListener("contextmenu", onContextMenu);
    host.addEventListener("dragstart", onDragStart);
    return () => {
      clearPress();
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("click", onClick, true);
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("dragstart", onDragStart);
    };
  }, [canComment]);

  const visible = threads.filter((t) => (filterPage ? filterPage(t.anchor) : true));

  const overlay = (
    <svg
      ref={svgRef}
      className="viewer__overlay"
      width={viewport.width}
      height={viewport.height}
      // 中に押せるピン・範囲があるので img ではなく group（img の子は支援技術から見えない。§35 I-08）
      role="group"
      aria-label="コメントの位置"
    >
      {visible.map((t) => {
        const a = t.anchor;
        const active = t.id === activeThreadId;
        const cls = `${active ? "anchor-rect--active" : ""} ${t.severity === "critical" ? "anchor-rect--critical" : ""}`;
        const pinCls = `anchor-pin ${active ? "anchor-pin--active" : ""}`;
        const pin = (cx: number, cy: number, r: number) => (
          <circle cx={cx} cy={cy} r={r} className={pinCls} />
        );
        if (a.type === "pdf_rect" || a.type === "image_rect") {
          const px = toViewportRect(a.rect, viewport);
          return (
            <g
              key={t.id}
              data-anchor={t.id}
              onClick={() => onSelectThread(t.id)}
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
              onClick={() => onSelectThread(t.id)}
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
      {dragRect ? (
        <rect
          className="anchor-draft"
          x={Math.min(dragRect.x0, dragRect.x1)}
          y={Math.min(dragRect.y0, dragRect.y1)}
          width={Math.abs(dragRect.x1 - dragRect.x0)}
          height={Math.abs(dragRect.y1 - dragRect.y0)}
        />
      ) : null}
    </svg>
  );
  const pressLayer = <PressLayer charge={charge} pop={pop} onPopEnd={() => setPop(null)} />;
  return (
    <>
      {overlay}
      {pressLayer}
    </>
  );
}

/**
 * 長押しの手応えの輪（満ちていく輪と、満ちた瞬間に弾ける輪）。位置は画面の座標（clientX/Y）。
 * 紙面の枠で切れないよう、紙面の外の画面全体の層に描く。SNS のプレビューの画像でも同じものを使う
 */
export function PressLayer({
  charge,
  pop,
  onPopEnd,
}: {
  charge: ChargeMark | null;
  pop: PopMark | null;
  onPopEnd: () => void;
}) {
  if (!charge && !pop) return null;
  const delay = charge ? chargeDelayMs(charge.kind) : 0;
  return createPortal(
    <svg className="press-layer" aria-hidden="true">
      {charge ? (
        <g
          key={charge.key}
          className="press-charge"
          transform={`translate(${charge.x} ${charge.y})`}
          style={
            {
              "--press-delay": `${delay}ms`,
              "--press-ms": `${charge ? holdMs(charge.kind) - delay : 0}ms`,
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
          onAnimationEnd={onPopEnd}
        />
      ) : null}
    </svg>,
    portalHost(),
  );
}
