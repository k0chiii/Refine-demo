import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMedia } from "@/lib/useMedia";
import { M3eFab, M3eIcon } from "@/ui/m3e";
import type { TextRangeDraft } from "./TextViewer";

/**
 * 指で操作する端末での文章の範囲選択（校正画面の文章・リッチ文章）。
 * スマホでは選択のつまみを動かしているあいだに投稿欄が出ると操作できないので、
 * 選択が落ち着いたら（selectionchange の 300ms 後）画面に「コメント」ボタン（M3E の拡張 FAB）を出し、押したときに投稿欄を開く。
 * マウス・キーボードは従来どおり、選び終えた瞬間に投稿欄が出る。
 */
export function useTouchSelection(enabled: boolean, read: () => TextRangeDraft | null) {
  const touch = useMedia("(pointer: coarse)");
  const on = enabled && touch;
  const [candidate, setCandidate] = useState<TextRangeDraft | null>(null);
  useEffect(() => {
    if (!on) {
      setCandidate(null);
      return;
    }
    let timer = 0;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCandidate(read()), 300);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [on, read]);
  return { touch: on, candidate, clear: () => setCandidate(null) };
}

/** 選んだ文字にコメントする拡張 FAB（画面右下。compact の覗き見シートとツールバーの上） */
export function TouchCommentButton({ onCommit }: { onCommit: () => void }) {
  return createPortal(
    <M3eFab
      variant="primary"
      extended
      className="touch-comment"
      // 押し下げで選択が消えないよう、既定動作を止める
      onPointerDown={(e: { preventDefault: () => void }) => e.preventDefault()}
      onMouseDown={(e: { preventDefault: () => void }) => e.preventDefault()}
      onClick={onCommit}
    >
      <M3eIcon slot="icon" name="add_comment" />
      <span slot="label">選んだ文字にコメント</span>
    </M3eFab>,
    document.body,
  );
}
