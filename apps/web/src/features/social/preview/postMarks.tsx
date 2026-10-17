import {
  pointFromCrop,
  pointToCrop,
  rectFromCrop,
  rectToCrop,
  type CropBox,
  type NormalizedPoint,
  type NormalizedRect,
} from "@mf100/domain";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { LONG_PRESS_MS, PressLayer } from "@/features/annotation/AnchorOverlay";
import { nextStacked } from "@/features/annotation/stacked";
import { haptic } from "@/lib/haptics";
import { scrollBehavior } from "@/lib/motion";

/**
 * SNS のプレビューの上に重ねるコメントの印と、位置を選ぶ入力（本文の範囲・画像の矩形とピン）。
 * 位置は本文のオフセットと元画像の正規化座標で持ち（domain/social/postAnchor.ts）、ここでは画面に出すときだけ
 * 端末の枠・拡大率・切り抜きに合わせる。印は % で置くので、枠を縮めても全画面でも画像の同じ場所に付く。
 */
export interface PostMarkMeta {
  id: string;
  /** コメントの番号（引き出しのカードと同じ） */
  index: number;
  /** 相談（FB）は色と形（点線・四角）を変える */
  kind?: "comment" | "feedback";
  severity?: string;
}
export interface PostTextMark extends PostMarkMeta {
  start: number;
  end: number;
}
export interface PostImageMark extends PostMarkMeta {
  /** 記録の画像の並びでの位置（0 始まり） */
  imageIndex: number;
  /** 元画像の正規化座標 */
  rect?: NormalizedRect;
  point?: NormalizedPoint;
}
/** 書きかけのコメントの位置（プレビューに点線で出す） */
export type PostDraftView =
  | { kind: "text"; start: number; end: number }
  | { kind: "image"; imageIndex: number; rect?: NormalizedRect; point?: NormalizedPoint };

/** 画面（viewport）の座標での範囲。投稿欄をそのそばに出すために渡す */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PostMarksValue {
  texts: PostTextMark[];
  images: PostImageMark[];
  activeId: string | null;
  /** 開くたびに増える（同じコメントを続けて開いても、その位置へ移して強調し直す） */
  revealKey: number;
  /** 位置を選んでコメントできるか */
  selecting: boolean;
  draft: PostDraftView | null;
  onOpen: (id: string) => void;
  onText: (range: { start: number; end: number }, box: ScreenBox) => void;
  onImage: (
    imageIndex: number,
    shape: { rect: NormalizedRect } | { point: NormalizedPoint },
    box: ScreenBox,
  ) => void;
}

export const PostMarksContext = createContext<PostMarksValue | null>(null);
export const usePostMarks = () => useContext(PostMarksContext);

/** 指が動いたら選び始めと見なさない距離（スクロールに任せる）と、クリックと見なす距離（px） */
const LONG_PRESS_SLOP = 10;
const CLICK_PX = 6;
/** 印の押せる半径（画面の px） */
const HIT_R = 18;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
type P = { x: number; y: number };

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const rectStyle = (r: NormalizedRect) => ({
  left: pct(r.x),
  top: pct(r.y),
  width: pct(r.w),
  height: pct(r.h),
});

/** 印の見た目の種類（クラス）。相談は点線・四角、重大は error 色 */
const markClass = (m: PostMarkMeta, active: boolean) =>
  [
    "sp-mark",
    active ? "is-active" : "",
    m.kind === "feedback" ? "is-fb" : "",
    m.severity === "critical" ? "is-critical" : "",
  ]
    .filter(Boolean)
    .join(" ");

/** この画像の切り抜きの上に置いた印（範囲か点。座標は切り抜きの 0..1） */
interface Placed {
  meta: PostImageMark;
  box?: NormalizedRect;
  clipped?: boolean;
  pt?: NormalizedPoint;
}

/**
 * 画像の上に重ねる層（切り抜きの範囲 = 層の全体）。`crop` は元画像のうち、いま見えている範囲（cropRect）。
 * - マウス・ペン: ドラッグで範囲、クリックでピン。印（範囲の面・ピン）を押すとそのコメントを開く
 * - タッチ: なぞるとふつうにスクロール。長押しすると選択が始まり、動かすと範囲、離すとピン（AnchorOverlay と同じ）。
 *   短いタップは印を開くだけ
 * - キーボード: 層にフォーカス → 矢印で動かし（Shift で細かく）、Enter で始点・もう一度 Enter で終点（同じ場所ならピン）
 * - 切り抜きの外のコメントは描かず、開いたときに「切り抜きの外」と知らせる
 */
export function ImageMarkLayer({ imageIndex, crop }: { imageIndex: number; crop: CropBox }) {
  const ctx = useContext(PostMarksContext);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: P; b: P } | null>(null);
  const [kbd, setKbd] = useState<{ at: P; from?: P } | null>(null);
  const [charge, setCharge] = useState<{ x: number; y: number; key: number } | null>(null);
  const [pop, setPop] = useState<{ x: number; y: number; key: number } | null>(null);
  const down = useRef<{ id: number; x: number; y: number; hit: string[] } | null>(null);
  const press = useRef<{ id: number; timer: number; armed: boolean } | null>(null);
  const handledAt = useRef(0);
  const selecting = ctx?.selecting ?? false;

  const mine: Placed[] = (ctx?.images ?? [])
    .filter((m) => m.imageIndex === imageIndex)
    .flatMap((m): Placed[] => {
      if (m.rect) {
        const r = rectToCrop(m.rect, crop);
        return r ? [{ meta: m, box: r.rect, clipped: r.clipped }] : [];
      }
      if (m.point) {
        const p = pointToCrop(m.point, crop);
        return p ? [{ meta: m, pt: p }] : [];
      }
      return [];
    });
  const draftView = ((): { box?: NormalizedRect; pt?: NormalizedPoint } | null => {
    const d = ctx?.draft;
    if (!d || d.kind !== "image" || d.imageIndex !== imageIndex) return null;
    if (d.rect) {
      const r = rectToCrop(d.rect, crop);
      return r ? { box: r.rect } : null;
    }
    if (d.point) {
      const p = pointToCrop(d.point, crop);
      return p ? { pt: p } : null;
    }
    return null;
  })();
  const activeId = ctx?.activeId ?? null;
  const offCrop =
    activeId !== null &&
    (ctx?.images ?? []).some((m) => m.id === activeId && m.imageIndex === imageIndex) &&
    !mine.some((m) => m.meta.id === activeId);

  // 開いたコメントがこの画像にあれば、その画像へ送り、見える所へスクロールして強調する
  const lastReveal = useRef<number | null>(null);
  const revealKey = ctx?.revealKey ?? 0;
  useEffect(() => {
    if (lastReveal.current === revealKey) return;
    const el = ref.current;
    const has =
      activeId !== null &&
      (ctx?.images ?? []).some((m) => m.id === activeId && m.imageIndex === imageIndex);
    if (!el || !has) return;
    lastReveal.current = revealKey;
    // カルーセル・ストーリーズ: 横に並べた枠を、この画像の位置へ送る
    const slide = el.closest(".sp-ig__slide, .sp-story__slide");
    const track = slide?.parentElement;
    if (slide && track) {
      const i = [...track.children].indexOf(slide);
      track.scrollTo({ left: i * track.clientWidth, behavior: scrollBehavior() });
    }
    (el.closest(".sp-ig__media, .sp-story") ?? el).scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: scrollBehavior(),
    });
  }, [revealKey, activeId, imageIndex]);

  // 長押しで選択が始まったら、指を動かしてもページがスクロールしないようにする
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (press.current?.armed) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);
  const clearPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setCharge(null);
  };
  useEffect(() => clearPress, []);

  if (!ctx) return null;

  const rectOf = () => ref.current?.getBoundingClientRect();
  const toP = (e: { clientX: number; clientY: number }): P => {
    const r = rectOf();
    if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((e.clientX - r.left) / r.width),
      y: clamp01((e.clientY - r.top) / r.height),
    };
  };
  /** 切り抜きの座標 → 画面の座標の範囲 */
  const screenBox = (a: P, b: P): ScreenBox => {
    const r = rectOf() ?? new DOMRect();
    return {
      left: r.left + Math.min(a.x, b.x) * r.width,
      right: r.left + Math.max(a.x, b.x) * r.width,
      top: r.top + Math.min(a.y, b.y) * r.height,
      bottom: r.top + Math.max(a.y, b.y) * r.height,
    };
  };
  /** この点にかかる印（小さい順 = 重なったら内側が先） */
  const hitsAt = (p: P): string[] => {
    const r = rectOf();
    if (!r) return [];
    return mine
      .flatMap((m) => {
        if (m.box) {
          const b = m.box;
          return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
            ? [{ id: m.meta.id, area: b.w * b.h }]
            : [];
        }
        if (m.pt) {
          const d = Math.hypot((p.x - m.pt.x) * r.width, (p.y - m.pt.y) * r.height);
          return d <= HIT_R ? [{ id: m.meta.id, area: 0 }] : [];
        }
        return [];
      })
      .sort((a, b) => a.area - b.area)
      .map((h) => h.id);
  };
  const open = (ids: string[]) => {
    const id = nextStacked(ids, activeId);
    if (id) ctx.onOpen(id);
  };
  /** 選び終えた形（クリック = ピン、ドラッグ = 矩形）を元画像の座標にして渡す */
  const commit = (a: P, b: P, asPoint: boolean) => {
    const box = screenBox(a, b);
    if (asPoint) ctx.onImage(imageIndex, { point: pointFromCrop(a, crop) }, box);
    else
      ctx.onImage(
        imageIndex,
        {
          rect: rectFromCrop(
            {
              x: Math.min(a.x, b.x),
              y: Math.min(a.y, b.y),
              w: Math.abs(b.x - a.x),
              h: Math.abs(b.y - a.y),
            },
            crop,
          ),
        },
        box,
      );
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" && e.button !== 0) return;
    // 印のボタンは自分で扱う
    if ((e.target as Element).closest("[data-mark-btn]")) return;
    const p = toP(e);
    const hit = hitsAt(p);
    if (e.pointerType === "touch") {
      // 2 本目の指（ピンチ）: 長押しの選択はやめる
      if (press.current && press.current.id !== e.pointerId) {
        clearPress();
        setDrag(null);
        return;
      }
      clearPress();
      const id = e.pointerId;
      down.current = { id, x: e.clientX, y: e.clientY, hit };
      if (!selecting) return;
      setCharge({ x: e.clientX, y: e.clientY, key: e.timeStamp });
      press.current = {
        id,
        armed: false,
        timer: window.setTimeout(() => {
          const cur = press.current;
          if (!cur || cur.id !== id) return;
          cur.armed = true;
          try {
            ref.current?.setPointerCapture(id);
          } catch {
            // 指がもう離れている
          }
          haptic();
          setCharge(null);
          setPop({
            x: down.current?.x ?? e.clientX,
            y: down.current?.y ?? e.clientY,
            key: Date.now(),
          });
          setDrag({ a: p, b: p });
        }, LONG_PRESS_MS),
      };
      return;
    }
    // マウス・ペン: 選ぶとき・印の上のときは、カルーセルのドラッグ送りに渡さない
    if (!selecting && hit.length === 0) return;
    e.stopPropagation();
    down.current = { id: e.pointerId, x: e.clientX, y: e.clientY, hit };
    ref.current?.setPointerCapture(e.pointerId);
    if (selecting) setDrag({ a: p, b: p });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    if (!d || d.id !== e.pointerId) return;
    if (press.current && !press.current.armed) {
      // 長押しの前に動いた → スクロール
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > LONG_PRESS_SLOP) clearPress();
      return;
    }
    if (drag) setDrag({ a: drag.a, b: toP(e) });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    if (!d || d.id !== e.pointerId) return;
    down.current = null;
    const armed = press.current?.armed === true;
    clearPress();
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    const end = toP(e);
    if (e.pointerType === "touch" && !armed) {
      // 短いタップ: 印の上なら開く（何も作らない）
      if (dist < CLICK_PX && d.hit.length) {
        handledAt.current = performance.now();
        open(d.hit);
      }
      setDrag(null);
      return;
    }
    handledAt.current = performance.now();
    const a = drag?.a ?? end;
    setDrag(null);
    if (e.pointerType === "touch") {
      haptic(); // 位置を置いた手応え
      commit(a, end, dist < CLICK_PX);
      return;
    }
    if (dist < CLICK_PX) {
      // クリック: 印の上ならそのコメントを開く。何もなければピン
      if (d.hit.length) open(d.hit);
      else if (selecting) commit(a, a, true);
      return;
    }
    if (selecting) commit(a, end, false);
  };
  const onPointerCancel = () => {
    clearPress();
    down.current = null;
    setDrag(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 0.01 : 0.05;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      setKbd((k) => {
        const at = k?.at ?? { x: 0.5, y: 0.5 };
        return { ...k, at: { x: clamp01(at.x + dx), y: clamp01(at.y + dy) } };
      });
    };
    if (e.key === "ArrowLeft") move(-step, 0);
    else if (e.key === "ArrowRight") move(step, 0);
    else if (e.key === "ArrowUp") move(0, -step);
    else if (e.key === "ArrowDown") move(0, step);
    else if (e.key === "Escape" && kbd) {
      e.preventDefault();
      e.stopPropagation();
      setKbd(null);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!kbd) setKbd({ at: { x: 0.5, y: 0.5 } });
      else if (!kbd.from) setKbd({ ...kbd, from: kbd.at });
      else {
        const same =
          Math.abs(kbd.from.x - kbd.at.x) < 0.01 && Math.abs(kbd.from.y - kbd.at.y) < 0.01;
        commit(kbd.from, kbd.at, same);
        setKbd(null);
      }
    }
  };

  const shape = (a: P, b: P) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  });

  return (
    <div
      ref={ref}
      className={`sp-marks ${selecting ? "is-drawable" : ""}`}
      data-mark-layer=""
      {...(selecting
        ? {
            tabIndex: 0,
            role: "group",
            "aria-label": `${imageIndex + 1} 枚目の画像にコメントを付ける。矢印キーで位置を動かし、Enter で始点、もう一度 Enter で終点（同じ場所ならピン）を決めます`,
            onKeyDown,
            onBlur: () => setKbd(null),
          }
        : {})}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={selecting ? (e) => e.preventDefault() : undefined}
      onClick={(e) => {
        // 位置を選んだ・印を開いた直後のクリックは、ストーリーズの「タップで送る」などに渡さない
        if (performance.now() - handledAt.current < 400) e.stopPropagation();
      }}
    >
      {mine.map((m) => {
        const active = m.meta.id === activeId;
        const label = `${m.meta.kind === "feedback" ? "FB" : "コメント"} ${m.meta.index}（${imageIndex + 1} 枚目の画像${m.meta.point ? "のピン" : "の範囲"}）`;
        const button = (
          <button
            type="button"
            data-mark-btn=""
            className="sp-mark__pin"
            aria-label={label}
            title={label}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              ctx.onOpen(m.meta.id);
            }}
          >
            <span
              key={active ? ctx.revealKey : "idle"}
              className="sp-mark__flash"
              aria-hidden="true"
            />
            <span className="sp-mark__num">{m.meta.index}</span>
          </button>
        );
        if (m.box)
          return (
            <div
              key={m.meta.id}
              className={`${markClass(m.meta, active)} sp-mark--rect ${m.clipped ? "is-clipped" : ""}`}
              style={rectStyle(m.box)}
            >
              <span className="sp-mark__fill" aria-hidden="true" />
              {button}
            </div>
          );
        if (m.pt)
          return (
            <div
              key={m.meta.id}
              className={`${markClass(m.meta, active)} sp-mark--point`}
              style={{ left: pct(m.pt.x), top: pct(m.pt.y) }}
            >
              {button}
            </div>
          );
        return null;
      })}
      {draftView?.box ? (
        <div
          className="sp-mark sp-mark--rect is-draft"
          style={rectStyle(draftView.box)}
          aria-hidden="true"
        >
          <span className="sp-mark__fill" />
        </div>
      ) : null}
      {draftView?.pt ? (
        <div
          className="sp-mark sp-mark--point is-draft"
          style={{ left: pct(draftView.pt.x), top: pct(draftView.pt.y) }}
          aria-hidden="true"
        >
          <span className="sp-mark__pin" />
        </div>
      ) : null}
      {drag ? (
        <div
          className="sp-mark sp-mark--rect is-draft"
          style={rectStyle(shape(drag.a, drag.b))}
          aria-hidden="true"
        >
          <span className="sp-mark__fill" />
        </div>
      ) : null}
      {kbd ? (
        <>
          {kbd.from ? (
            <div
              className="sp-mark sp-mark--rect is-draft"
              style={rectStyle(shape(kbd.from, kbd.at))}
              aria-hidden="true"
            >
              <span className="sp-mark__fill" />
            </div>
          ) : null}
          <i
            className="sp-marks__cursor"
            style={{ left: pct(kbd.at.x), top: pct(kbd.at.y) }}
            aria-hidden="true"
          />
        </>
      ) : null}
      {offCrop ? (
        <span className="sp-marks__off" role="status">
          このコメントの位置は、プレビューの切り抜きの外です
        </span>
      ) : null}
      <PressLayer charge={charge} pop={pop} onPopEnd={() => setPop(null)} />
    </div>
  );
}
