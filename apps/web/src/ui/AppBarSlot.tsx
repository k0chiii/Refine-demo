import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type AppBarSlotName = "leading" | "title" | "subtitle" | "actions";

const APP_NAME = "MF100 校正システム";
/** 見出しへフォーカスを移した最後の画面（同じ画面の再描画では動かさない。文字の選択などを邪魔しない） */
let focusedPath: string | null = null;

/**
 * 共通アプリバー（`_app.tsx`）のスロットへ、いまの画面の見出し・戻る・操作を差し込む（M3 App bars: 「アプリバーは現在のページの
 * 見出し・ナビゲーション・1–2 の必須操作を置き、通知などの全体の操作も含められる」）。
 * 受け皿は `#appbar-<slot>`。描画後に探すので、最初の描画では何も出さない。
 *
 * 見出し（title）は画面ごとのページタイトル（document.title）にもする。画面を移ったときに、フォーカスが行き場を失って
 * body にあるなら見出しへ移し、スクリーンリーダーに画面の切り替わりを伝える（WCAG 2.4.2・M3 Accessibility。§35 A-05）
 */
export function AppBarSlot({ slot, children }: { slot: AppBarSlotName; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById(`appbar-${slot}`));
  }, [slot]);
  useEffect(() => {
    if (slot !== "title" || !host) return;
    const id = requestAnimationFrame(() => {
      const text = host.textContent?.trim();
      document.title = text ? `${text} – ${APP_NAME}` : APP_NAME;
      // 長い見出しは切り詰めて表示するので、全文をツールチップでも読めるようにする
      host.title = text ?? "";
      host.tabIndex = -1;
      const path = location.pathname;
      if (focusedPath === path) return;
      focusedPath = path;
      if (document.activeElement === document.body || document.activeElement === null)
        host.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  });
  return host ? createPortal(children, host) : null;
}
