import { QuestionHead } from "./Field";
import { api } from "@mf100/convex/api";
import { useId, useRef, useState } from "react";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useStableQuery } from "@/lib/useStableQuery";
import { M3eAutocomplete } from "@m3e/react/autocomplete";
import { M3eInputChip } from "@m3e/react/chips";
import { M3eFormField } from "@m3e/react/form-field";
import { M3eIcon } from "@m3e/react/icon";
import { M3eOption } from "@m3e/react/option";

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
 * 外観: 質問文（Google フォーム風）の下に、選択済みは M3E input chip（removable）、検索は下線だけの M3E form-field 内の native input、
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
  // 選ぶ・外すたびに byIds の引数が変わる。素の useQuery だと結果が届くまでの間チップが全部「…」に戻る（描き直したように見える）ので、
  // 前回の結果を保つ。検索も同じ（1 文字打つたびに候補が空→「検索しています…」→一覧、と変わらないように）
  const selected =
    useStableQuery(api.users.byIds, value.length > 0 ? { ids: value } : "skip") ?? [];
  // 一度名前が分かった人は、結果が来る前でも名前を出す（追加した直後のチップ）
  const names = useRef(new Map<string, string>());
  for (const u of selected) names.current.set(u.id, u.name);
  // 検索語は打ち止めてから問い合わせる（1 文字ごとに購読を作り直さない。空にしたときはすぐ）
  const searchText = useDebouncedValue(text, 200, (t) => t === "");
  const rawCandidates = useStableQuery(
    api.users.search,
    open ? { text: searchText, limit: 8 } : "skip",
  );
  const candidates = rawCandidates ?? [];
  const hidden = new Set([...value, ...exclude]);
  const visible = candidates.filter((u) => !hidden.has(u.id));
  const pick = (id: string) => {
    onChange(single ? [id] : [...value, id]);
    setText("");
  };
  const remove = (id: string) => onChange(value.filter((v) => v !== id));
  const canAdd = !single || value.length === 0;

  // <label> で全体を包まない: label 内の最初の labelable 要素（チップの「外す」ボタン）にクリックが転送されるため。
  return (
    <div className="picker q" role="group" aria-labelledby={`${listId}-label`}>
      <QuestionHead
        htmlFor={inputId}
        labelId={`${listId}-label`}
        label={label}
        required={required}
        hint={hint}
        hintId={`${listId}-hint`}
      />
      {value.length > 0 ? (
        <div className="picker__chips" role="grid" aria-label={`${label}の選択済み`}>
          {value.map((id) => {
            const name = selected.find((s) => s.id === id)?.name ?? names.current.get(id);
            return (
              <M3eInputChip
                key={id}
                removable
                removeLabel={`${name ?? id} を外す`}
                onRemove={() => remove(id)}
              >
                {name ?? "…"}
              </M3eInputChip>
            );
          })}
        </div>
      ) : null}
      {canAdd ? (
        <div className="picker__search">
          <M3eFormField variant="filled" className="field q__field" hideSubscript="always">
            <M3eIcon slot="prefix" name="person_search" />
            <input
              id={inputId}
              className="input"
              value={text}
              placeholder={placeholder ?? "名前・メールで検索"}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setText(e.target.value);
                setOpen(true);
              }}
            />
          </M3eFormField>
          {/* 候補は M3E autocomplete（キーボード操作・読み上げは M3E 側）。絞り込みはサーバーの検索に任せる */}
          <M3eAutocomplete
            htmlFor={inputId}
            filter="none"
            autoActivate
            hideSelectionIndicator
            loading={open && rawCandidates === undefined}
            loadingLabel="検索しています…"
            noDataLabel={text ? "該当するユーザーがいません" : "候補を表示するには文字を入力"}
            onChange={(e) => {
              const id = (e.target as unknown as { value: string | null }).value;
              if (id) pick(id);
            }}
          >
            {visible.map((u) => (
              <M3eOption key={u.id} value={u.id} className="picker__option">
                {u.name}
                {u.generation ? <span className="muted small"> {u.generation} 代</span> : null}
                {u.email ? <span className="muted small"> {u.email}</span> : null}
              </M3eOption>
            ))}
          </M3eAutocomplete>
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
