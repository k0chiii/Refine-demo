import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type AppBarSlotName = "leading" | "title" | "subtitle" | "actions";

const APP_NAME = "校正システム";
/** 見出しへフォーカスを移した最後の画面（同じ画面の再描画では動かさない。文字の選択などを邪魔しない） */
let focusedPath: string | null = null;
/** インストールした PWA として独立した窓で開いているか（ブラウザのタブではない） */
const installed = () =>
  matchMedia("(display-mode: standalone), (display-mode: window-controls-overlay)").matches;

/**
 * 共通アプリバー（`_app.tsx`）のスロットへ、いまの画面の見出し・戻る・操作を差し込む（M3 App bars: 「アプリバーは現在のページの
 * 見出し・ナビゲーション・1–2 の必須操作を置き、通知などの全体の操作も含められる」）。
 * 受け皿は `#appbar-<slot>`。描画後に探すので、最初の描画では何も出さない（探すのは描画の直後・画面に出る前の layout effect。
 * passive effect だと、見出し・戻るが 1 フレーム遅れて現れ、読み込み中の画面が何段にも見えた。§61）。
 *
 * 見出し（title）は画面ごとのページタイトル（document.title）にもする。画面を移ったときに、フォーカスが行き場を失って
 * body にあるなら見出しへ移し、スクリーンリーダーに画面の切り替わりを伝える（WCAG 2.4.2・M3 Accessibility。§35 A-05）
 * `title` を渡すと受け皿に title 属性を付ける（見出しが省略記号で切れても、ポインタを載せれば全文を読める）。
 */
export function AppBarSlot({
  slot,
  title,
  children,
}: {
  slot: AppBarSlotName;
  title?: string;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(document.getElementById(`appbar-${slot}`));
  }, [slot]);
  useEffect(() => {
    if (slot !== "title" || !host) return;
    const id = requestAnimationFrame(() => {
      const text = host.textContent?.trim();
      // インストールした PWA は、窓のタイトルにアプリ名を自分で前に付ける（「校正システム - ホーム」）。二重にしない
      document.title = !text ? APP_NAME : installed() ? text : `${text} – ${APP_NAME}`;
      // 長い見出しは切り詰めて表示するので、全文をツールチップでも読めるようにする
      host.title = title ?? text ?? "";
      host.tabIndex = -1;
      const path = location.pathname;
      if (focusedPath === path) return;
      focusedPath = path;
      if (document.activeElement === document.body || document.activeElement === null)
        host.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  });
  useEffect(() => {
    if (!host || title === undefined || slot === "title") return;
    host.title = title;
    return () => host.removeAttribute("title");
  }, [host, title, slot]);
  return host ? createPortal(children, host) : null;
}
