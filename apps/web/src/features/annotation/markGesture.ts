/**
 * 紙面に印を付ける操作の判定（純粋な関数。AnchorOverlay・SNS の画像の層が使う）。
 * 利用者指示 2026-10-20: クリック・タップはふつうの操作、範囲をなぞる（ドラッグ）と長押しだけがコメントになる。
 * - マウス・ペン: 少し（DRAG_SLOP）動かしたらドラッグ＝範囲。動かさずに MOUSE_HOLD_MS 押し続けると長押し＝ピン
 * - タッチ: 長押し（TOUCH_HOLD_MS）してから動かすと範囲、離すとピン。長押しの前に動いたらスクロールに任せる
 */
export type PointerKind = "touch" | "mouse";

export const kindOf = (pointerType: string): PointerKind =>
  pointerType === "touch" ? "touch" : "mouse";

/** マウスの長押し（押し続けてピンを置く）と、タッチの長押し（範囲の選択を始める）の時間 */
export const MOUSE_HOLD_MS = 500;
export const TOUCH_HOLD_MS = 320;
/** ドラッグと見なす移動量（マウス）と、長押しとみなす指のぶれの上限（タッチ）。px */
export const DRAG_SLOP = 4;
export const TOUCH_SLOP = 10;
/** 離したときに、この大きさより小さい範囲はピンにする。px */
export const POINT_MAX = 6;
/** 長押しの輪を出し始めるまでの待ち（普通のクリック・スクロールで輪が出ないように） */
const CHARGE_DELAY: Record<PointerKind, number> = { touch: 80, mouse: 200 };

export const holdMs = (kind: PointerKind) => (kind === "touch" ? TOUCH_HOLD_MS : MOUSE_HOLD_MS);
export const chargeDelayMs = (kind: PointerKind) => CHARGE_DELAY[kind];

export type MoveOutcome = "wait" | "drag" | "scroll";

/**
 * 押している途中で動いたときの扱い。`held`: 長押しが済んだ（以降は動かしたら範囲）。
 * マウスは SLOP を超えたらドラッグ、タッチは長押しの前に SLOP を超えたらスクロール
 */
export function moveOutcome(kind: PointerKind, held: boolean, dist: number): MoveOutcome {
  if (held) return "drag";
  if (dist <= (kind === "touch" ? TOUCH_SLOP : DRAG_SLOP)) return "wait";
  return kind === "touch" ? "scroll" : "drag";
}

/** なぞり終えた大きさ（px）が範囲か、ピンか */
export const shapeOf = (w: number, h: number): "rect" | "point" =>
  w < POINT_MAX && h < POINT_MAX ? "point" : "rect";
