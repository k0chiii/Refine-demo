import { M3eDialog as RawDialog } from "@m3e/react/dialog";
import { useState, type ComponentProps } from "react";

type Props = ComponentProps<typeof RawDialog>;
const events = ["onOpening", "onOpened", "onClosing", "onClosed", "onCancel"] as const;

/**
 * M3E のダイアログを、初めて開くまで描かない（性能。利用者指示 2026-10-15「操作の軽さはめちゃ大事」）。
 * 画面には閉じたダイアログがいくつも置かれていて（情報タブだけで 6 つ。制作物の編集は日付・ユーザー選択を含む）、
 * 閉じていても中身を全部描いていたため、タブを開くだけで 1 秒近く止まっていた（4 倍遅い CPU で 1,040ms）。
 * 一度開いたら描いたままにする（閉じるアニメーションと、2 回目以降をすぐ開くため）。
 *
 * 開閉の合図は、ダイアログ自身が出したものだけを渡す。中の開閉パネル（M3eExpansionPanel）は同じ名前の
 * opening / closed などを bubbles で出し直すので、そのままだと「詳細」を畳んだだけでダイアログの onClosed が走り、
 * 書きかけのダイアログごと閉じていた（MF100 Notion「校正を出すときに一部分を開いて閉じると popup ごと閉じる」）
 */
export function M3eDialog(props: Props) {
  const [mounted, setMounted] = useState(Boolean(props.open));
  if (props.open && !mounted) setMounted(true);
  if (!mounted) return null;
  const own: Partial<Props> = {};
  for (const name of events) {
    const handler = props[name];
    if (handler)
      own[name] = ((e: Event) => {
        if (e.target === e.currentTarget) handler(e as never);
      }) as never;
  }
  return <RawDialog {...props} {...own} />;
}
