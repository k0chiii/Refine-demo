import { M3eDialog } from "@/ui/LazyDialog";
import "./ShortcutSheet.css";

type Row = readonly [keys: readonly string[], label: string];

const groups: ReadonlyArray<{ title: string; rows: readonly Row[] }> = [
  {
    title: "コメント",
    rows: [
      [["C"], "全体へのコメントを開く"],
      [["Esc"], "選んだ位置・書きかけをやめる"],
      [["Ctrl", "Enter"], "送る・確定する"],
    ],
  },
  {
    title: "動画",
    rows: [
      [["C"], "全体へのコメントを開く"],
      [["T"], "この時点にコメント"],
      [["Space"], "再生・停止"],
      [["←", "→"], "1 コマ戻る・進む"],
      [["J", "L"], "少し戻る・進む"],
      [["I", "O"], "範囲の始まり・終わり"],
      [["M"], "ミュート"],
      [["F"], "全画面"],
    ],
  },
  {
    title: "表示",
    rows: [[["?"], "このショートカット一覧"]],
  },
];

/** キーボードのショートカット一覧（? で開く） */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる">
      <span slot="header">キーボードショートカット</span>
      <div className="dialog-body shortcuts">
        {groups.map((g) => (
          <section key={g.title} className="shortcuts__group">
            <h3 className="title-small shortcuts__title">{g.title}</h3>
            <dl className="shortcuts__list">
              {g.rows.map(([keys, label]) => (
                <div key={label} className="shortcuts__row">
                  <dt className="shortcuts__keys">
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dt>
                  <dd className="shortcuts__label">{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </M3eDialog>
  );
}
