import { countText } from "@mf100/domain";
import { useEffect, useState } from "react";
import { Field, TextInput } from "@/ui/Field";
import { M3eButton, M3eDialog, M3eList, M3eListItem, M3eSwitch } from "@/ui/m3e";

/** リンクの挿入・編集（Ctrl+K）。M3 Dialogs: 操作は 2 つまで。URL を空にして適用するとリンクを外す */
export function LinkDialog({
  open,
  initialText,
  initialUrl,
  hasSelection,
  onApply,
  onClose,
}: {
  open: boolean;
  initialText: string;
  initialUrl: string;
  hasSelection: boolean;
  onApply: (text: string, url: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);
  useEffect(() => {
    if (open) {
      setText(initialText);
      setUrl(initialUrl);
    }
  }, [open, initialText, initialUrl]);
  const bad =
    url.trim() !== "" &&
    !/^(https?:\/\/|mailto:)/i.test(url.trim()) &&
    !/^[\w.-]+\.[a-z]{2,}/i.test(url.trim());
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる">
      <span slot="header">{initialUrl ? "リンクを編集" : "リンクを挿入"}</span>
      <form
        id="link-form"
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!bad) onApply(text, url.trim());
        }}
      >
        {!hasSelection ? (
          <Field label="テキスト">
            <TextInput
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="表示する文字"
            />
          </Field>
        ) : null}
        <Field
          label="URL"
          {...(bad
            ? { error: "https:// で始まる URL を入力してください" }
            : { hint: "空にして適用するとリンクを外します" })}
        >
          <TextInput
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            inputMode="url"
            autoFocus
          />
        </Field>
      </form>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton variant="filled" disabled={bad} onClick={() => onApply(text, url.trim())}>
          適用
        </M3eButton>
      </div>
    </M3eDialog>
  );
}

/** 文字カウント（Google ドキュメント: ツール › 文字カウント。入力中に表示するかを切り替えられる） */
export function WordCountDialog({
  open,
  text,
  selection,
  live,
  onLive,
  onClose,
}: {
  open: boolean;
  text: string;
  /** 選択中の平文（あれば選択範囲も数える） */
  selection: string;
  live: boolean;
  onLive: (on: boolean) => void;
  onClose: () => void;
}) {
  const all = countText(text);
  const sel = selection ? countText(selection) : null;
  const rows: Array<[string, keyof typeof all]> = [
    ["単語数", "words"],
    ["文字数", "characters"],
    ["文字数（空白を除く）", "charactersNoSpaces"],
  ];
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる">
      <span slot="header">文字カウント</span>
      <div className="dialog-body">
        {/* M3 に表は無いので、項目と数を M3 のリストで並べる（数は行の末尾。選択中は 2 行目に選択範囲の数） */}
        <M3eList className="list count-list" aria-label="文字カウント">
          {rows.map(([label, k]) => (
            <M3eListItem key={k} className="list__item">
              {label}
              {sel ? (
                <span slot="supporting-text">選択範囲 {sel[k].toLocaleString("ja-JP")}</span>
              ) : null}
              <span slot="trailing" className="count-list__value">
                {all[k].toLocaleString("ja-JP")}
              </span>
            </M3eListItem>
          ))}
          <M3eListItem className="list__item">
            入力中に文字カウントを表示
            <M3eSwitch
              slot="trailing"
              checked={live}
              onChange={(e: Event) =>
                onLive((e.target as HTMLInputElement & { checked: boolean }).checked)
              }
              aria-label="入力中に文字カウントを表示"
            />
          </M3eListItem>
        </M3eList>
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="filled" onClick={onClose}>
          完了
        </M3eButton>
      </div>
    </M3eDialog>
  );
}

const shortcutGroups: Array<[string, Array<[string, string]>]> = [
  [
    "一般",
    [
      ["元に戻す / やり直す", "Ctrl+Z / Ctrl+Shift+Z"],
      ["リンクを挿入", "Ctrl+K"],
      ["検索 / 検索と置換", "Ctrl+F / Ctrl+H"],
      ["文字カウント", "Ctrl+Shift+C"],
      ["印刷", "Ctrl+P"],
      ["ショートカット一覧", "Ctrl+/"],
    ],
  ],
  [
    "文字書式",
    [
      ["太字 / 斜体 / 下線", "Ctrl+B / Ctrl+I / Ctrl+U"],
      ["取り消し線", "Alt+Shift+5"],
      ["上付き / 下付き", "Ctrl+. / Ctrl+,"],
      ["書式をクリア", "Ctrl+\\"],
    ],
  ],
  [
    "段落書式",
    [
      ["標準テキスト", "Ctrl+Alt+0"],
      ["見出し 1〜3", "Ctrl+Alt+1〜3"],
      ["左 / 中央 / 右 / 両端揃え", "Ctrl+Shift+L / E / R / J"],
      ["番号付き / 箇条書き / チェックリスト", "Ctrl+Shift+7 / 8 / 9"],
      ["インデント減 / 増（リスト）", "Ctrl+[ / Ctrl+]"],
    ],
  ],
  [
    "マークダウン（行頭で入力）",
    [
      ["見出し 1〜3", "# / ## / ###"],
      ["箇条書き / 番号付き", "- / 1."],
      ["チェックリスト", "[ ]"],
      ["引用 / 区切り線", "> / ---"],
      ["太字 / 斜体 / 取り消し線", "**文字** / *文字* / ~~文字~~"],
    ],
  ],
];

/** キーボード ショートカット一覧（Google ドキュメントの Ctrl+/ に相当） */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる">
      <span slot="header">キーボード ショートカット</span>
      <div className="dialog-body shortcuts">
        {shortcutGroups.map(([group, items]) => (
          <section key={group}>
            <h3 className="title-small">{group}</h3>
            <dl className="shortcuts__list">
              {items.map(([label, keys]) => (
                <div key={label} className="shortcuts__row">
                  <dt>{label}</dt>
                  <dd>
                    <kbd>{keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="filled" onClick={onClose}>
          完了
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
