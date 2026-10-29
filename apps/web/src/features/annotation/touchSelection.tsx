import { useEffect, useRef } from "react";
import { useMedia } from "@/lib/useMedia";
import { useSelectionMode } from "./selectionMode";
import type { TextRangeDraft } from "./TextViewer";

/**
 * 指で操作する端末での文章の範囲選択（校正画面の文章・リッチ文章・SNS のプレビュー）。
 * スマホでは選択のつまみを動かしているあいだに投稿欄が出ると操作できないので、
 * 選択が落ち着いたら（selectionchange の 300ms 後）その範囲で `onCommit` を呼ぶ（選ぶ ＝ コメント。§106）。
 * 文字の選択を「文字」（`SelectionMode` の text）にしているあいだは止まり、端末の選択（コピーなど）に任せる。
 * マウス・キーボードは従来どおり、選び終えた瞬間に投稿欄が出る。指で操作する端末かを返す
 */
export function useTouchSelection(
  enabled: boolean,
  read: () => TextRangeDraft | null,
  onCommit: (d: TextRangeDraft) => void,
) {
  const touch = useMedia("(pointer: coarse)");
  const comment = useSelectionMode() === "comment";
  const on = enabled && touch && comment;
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    if (!on) return;
    let last: TextRangeDraft | null = null;
    const settle = () => {
      const d = read();
      // 選択が消えたら忘れる（同じ範囲をもう一度選べば、また開く）
      if (!d) last = null;
      else if (d.start !== last?.start || d.end !== last.end) {
        last = d;
        commit.current(d);
      }
    };
    // 選んだまま「コメント」に戻したときは、その選択で開く
    settle();
    let timer = 0;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 300);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [on, read]);
  return enabled && touch;
}
