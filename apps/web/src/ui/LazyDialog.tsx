import { M3eDialog as RawDialog } from "@m3e/react/dialog";
import { useState, type ComponentProps } from "react";

/**
 * M3E のダイアログを、初めて開くまで描かない（性能。利用者指示 2026-10-15「操作の軽さはめちゃ大事」）。
 * 画面には閉じたダイアログがいくつも置かれていて（情報タブだけで 6 つ。制作物の編集は日付・ユーザー選択を含む）、
 * 閉じていても中身を全部描いていたため、タブを開くだけで 1 秒近く止まっていた（4 倍遅い CPU で 1,040ms）。
 * 一度開いたら描いたままにする（閉じるアニメーションと、2 回目以降をすぐ開くため）。
 */
export function M3eDialog(props: ComponentProps<typeof RawDialog>) {
  const [mounted, setMounted] = useState(Boolean(props.open));
  if (props.open && !mounted) setMounted(true);
  return mounted ? <RawDialog {...props} /> : null;
}
