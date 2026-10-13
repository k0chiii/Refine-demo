import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { useId, useState } from "react";
import { M3eFormField, M3eIcon, M3eInputChip } from "./m3e";

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
 * 外観: 選択済みは M3E input chip（removable）、検索は M3E form-field（outlined）内の native input、
 * 候補は listbox（キーボード: Enter で先頭候補、Esc で閉じる）。
 * Nogiku Access のユーザー一覧連携後も `users.search` の差し替えだけで済むようにここに閉じる。
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
  const inputId = useId();
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

  // <label> で全体を包まない: label 内の最初の labelable 要素（チップの「外す」ボタン）にクリックが転送されるため。
  return (
    <div className="picker" role="group" aria-labelledby={`${listId}-label`}>
      {value.length > 0 ? (
        <div className="picker__chips" role="grid" aria-label={`${label}の選択済み`}>
          {value.map((id) => {
            const u = selected.find((s) => s.id === id);
            return (
              <M3eInputChip
                key={id}
                removable
                removeLabel={`${u?.name ?? id} を外す`}
                onRemove={() => remove(id)}
              >
                <M3eIcon slot="icon" name="person" />
                {u?.name ?? "…"}
              </M3eInputChip>
            );
          })}
        </div>
      ) : null}
      {canAdd ? (
        <div className="picker__search">
          <M3eFormField
            variant="outlined"
            floatLabel="always"
            className="field"
            {...(!hint ? { hideSubscript: "always" } : {})}
          >
            <label slot="label" htmlFor={inputId} id={`${listId}-label`}>
              {label}
              {required ? <span className="field__required"> *</span> : null}
            </label>
            <M3eIcon slot="prefix" name="person_search" />
            <input
              id={inputId}
              className="input"
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
            {hint ? <span slot="hint">{hint}</span> : null}
          </M3eFormField>
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
      ) : (
        <span id={`${listId}-label`} className="field__label">
          {label}
          {hint ? ` — ${hint}` : ""}
        </span>
      )}
    </div>
  );
}
