import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { useId, useState } from "react";
import { TextInput } from "./Field";
import { M3eIcon } from "./m3e";

export interface UserPickerProps {
  label: string;
  hint?: string;
  required?: boolean;
  /** 選択済みユーザー ID */
  value: string[];
  onChange: (ids: string[]) => void;
  /** 省略時は複数選択 */
  single?: boolean;
  /** 候補から除外する ID（例: 既に割当済み） */
  exclude?: string[];
  placeholder?: string;
}

/**
 * ユーザー選択 UI（v1）。一度でもログインした Nogiku ユーザーを名前・メールで検索して選ぶ。
 * ユーザー ID の手入力（v0 の暫定）を置き換える。Nogiku Access のユーザー一覧連携後も、
 * `users.search` の実装差し替えだけで済むようにここに閉じる。
 */
export function UserPicker({
  label,
  hint,
  required,
  value,
  onChange,
  single,
  exclude = [],
  placeholder,
}: UserPickerProps) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = useQuery(api.users.byIds, value.length > 0 ? { ids: value } : "skip") ?? [];
  const candidates = useQuery(api.users.search, open ? { text, limit: 8 } : "skip") ?? [];
  const hidden = new Set([...value, ...exclude]);
  const visible = candidates.filter((u) => !hidden.has(u.id));
  const pick = (id: string) => {
    onChange(single ? [id] : [...value, id]);
    setText("");
    if (single) setOpen(false);
  };
  const remove = (id: string) => onChange(value.filter((v) => v !== id));
  const canAdd = !single || value.length === 0;

  // Field（<label>）で包まない: label 内の最初の labelable 要素（チップの「外す」ボタン）に
  // クリックが転送され、選んだ直後に外れてしまうため。
  return (
    <div className="field" role="group" aria-labelledby={`${listId}-label`}>
      <span className="field__label" id={`${listId}-label`}>
        {label}
        {required ? <span className="field__required"> *</span> : null}
      </span>
      <div className="picker">
        {value.length > 0 ? (
          <div className="picker__chips" aria-label={`${label}の選択済み`}>
            {value.map((id) => {
              const u = selected.find((s) => s.id === id);
              return (
                <span key={id} className="chip chip--primary picker__chip">
                  {u?.name ?? "…"}
                  <button
                    type="button"
                    className="picker__remove"
                    aria-label={`${u?.name ?? id} を外す`}
                    onClick={() => remove(id)}
                  >
                    <M3eIcon name="close" style={{ fontSize: 14 }} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}
        {canAdd ? (
          <div className="picker__search">
            <TextInput
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              value={text}
              placeholder={placeholder ?? "名前・メールで検索"}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onChange={(e) => {
                setText(e.target.value);
                setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && visible[0]) {
                  e.preventDefault();
                  pick(visible[0].id);
                }
                if (e.key === "Escape") setOpen(false);
              }}
            />
            {open ? (
              <ul id={listId} role="listbox" className="picker__list">
                {visible.length === 0 ? (
                  <li className="picker__empty muted small">
                    {text ? "該当する委員がいません" : "候補を表示するには文字を入力"}
                  </li>
                ) : (
                  visible.map((u) => (
                    <li key={u.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        className="picker__option"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(u.id)}
                      >
                        <span>{u.name}</span>
                        <span className="muted small">{u.email ?? ""}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}
