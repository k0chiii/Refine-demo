import { useRef } from "react";

/** M3 の推奨スナップ幅（Scaffold › Panes: 360dp / 412dp） */
export const PANE_SNAPS = [360, 412] as const;
const SNAP_TOLERANCE = 12;
const COLLAPSE_BELOW = 200;
const MIN_PANE = 240;
const STEP = 16;

/**
 * ペインのドラッグハンドル（M3 Layout › Parts of layout › Drag handles、Scaffold › Pane expansion & resizing）。
 * スペーサー（24）の中に置き、タッチ領域（48）は両側のペインに少し重なる。
 * - ドラッグ: 固定ペインの幅を変える。360 / 412 にスナップし、端まで寄せると折りたたむ
 * - 選択（タップ・Enter・Space）: 折りたたみ ⇄ 展開
 * - 矢印キー: 16 ずつ。Home: 既定幅。End: 折りたたむ
 * supporting pane なので temporary resizing（閉じたら既定に戻す）は親が担う。
 */
export function PaneHandle({
  width,
  defaultWidth,
  maxWidth,
  collapsed,
  onResize,
  onToggle,
}: {
  width: number;
  defaultWidth: number;
  maxWidth: number;
  collapsed: boolean;
  onResize: (w: number | null) => void;
  onToggle: () => void;
}) {
  const drag = useRef<{ x: number; w: number; moved: boolean } | null>(null);
  const skipClick = useRef(false); // ドラッグの直後の click を選択扱いにしない
  const rtl = () => getComputedStyle(document.documentElement).direction === "rtl";
  const clamp = (w: number) => Math.min(maxWidth, Math.max(MIN_PANE, w));
  const snap = (w: number) => {
    for (const s of PANE_SNAPS) if (Math.abs(w - s) <= SNAP_TOLERANCE) return s;
    return w;
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: ARIA の window splitter パターン（フォーカスできる separator）
    <div
      className={`ws__handle ${collapsed ? "ws__handle--collapsed" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={collapsed ? "引き出しを開く" : "引き出しの幅を変える（Enter で折りたたむ）"}
      aria-valuemin={0}
      aria-valuemax={maxWidth}
      aria-valuenow={collapsed ? 0 : width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (collapsed) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = (d.x - e.clientX) * (rtl() ? -1 : 1); // 内側（紙面側）へ動かすと広がる
        if (Math.abs(dx) > 8) d.moved = true;
        if (d.moved) onResize(clamp(snap(d.w + dx)));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || !d.moved) return; // 動かしていなければ click（選択）に任せる
        skipClick.current = true;
        const dx = (d.x - e.clientX) * (rtl() ? -1 : 1);
        if (d.w + dx < COLLAPSE_BELOW) {
          onResize(null);
          onToggle();
        }
      }}
      onClick={() => {
        if (skipClick.current) {
          skipClick.current = false;
          return;
        }
        onToggle();
      }}
      onKeyDown={(e) => {
        const wider = rtl() ? "ArrowRight" : "ArrowLeft";
        const narrower = rtl() ? "ArrowLeft" : "ArrowRight";
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        } else if (!collapsed && e.key === wider) {
          e.preventDefault();
          onResize(clamp(snap(width + STEP)));
        } else if (!collapsed && e.key === narrower) {
          e.preventDefault();
          onResize(clamp(snap(width - STEP)));
        } else if (e.key === "Home") {
          e.preventDefault();
          onResize(defaultWidth);
        } else if (!collapsed && e.key === "End") {
          e.preventDefault();
          onResize(null);
          onToggle();
        }
      }}
    />
  );
}
