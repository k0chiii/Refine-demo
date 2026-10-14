import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type AppBarSlotName = "leading" | "title" | "subtitle" | "actions";

/**
 * 共通アプリバー（`_app.tsx`）のスロットへ、いまの画面の見出し・戻る・操作を差し込む（M3 App bars: 「アプリバーは現在のページの
 * 見出し・ナビゲーション・1–2 の必須操作を置き、通知などの全体の操作も含められる」）。
 * 受け皿は `#appbar-<slot>`。描画後に探すので、最初の描画では何も出さない。
 */
export function AppBarSlot({ slot, children }: { slot: AppBarSlotName; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById(`appbar-${slot}`));
  }, [slot]);
  return host ? createPortal(children, host) : null;
}
