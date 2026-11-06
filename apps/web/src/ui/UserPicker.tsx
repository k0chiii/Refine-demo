import { subscriptProps } from "./Field";
import { api } from "@mf100/convex/api";
import { expandMemberGroups, searchMemberGroups } from "@mf100/domain";
import { useQuery } from "convex/react";
import { useId, useRef, useState } from "react";
import { isImeKeyEvent } from "@/lib/ime";
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
  /** 見るだけ（外す・追加はできない。権限が無い人に、いまの選択だけを見せる） */
  readOnly?: boolean;
  /**
   * グループも候補に出す（利用者指示 2026-10-21）。グループを選ぶと、そのときの所属する人をまとめて加える
   * （まだ選んでいない・除外していない人だけ）。複数選択のときだけ
   */
  groups?: boolean;
}

/** 候補の値のうちグループを指すもの（人の ID とは紛れない） */
const GROUP_OPTION = "group:";

/**
 * ユーザー選択 UI（v1）。一度でもログインした Nogiku ユーザーを名前（ふりがな・漢字）・メールで検索して選ぶ。
 * `groups` を付けると、グループを選んで所属する人をまとめて加えられる（校正者の割り当て）。
 * 外観: M3E の outlined form-field（浮くラベル）の中に、選択済みの M3E input chip（removable）と検索の native input を並べる。
 * 候補は listbox（キーボード: Enter で先頭候補、Esc で閉じる）。日本語入力の確定の Enter は候補の決定にしない（下の onKeyDownCapture）。
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
  readOnly,
  groups: withGroups,
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
  // グループ（数は多くないので一覧を丸ごと引き、画面で絞る）。加えられる人が残っているグループだけ出す
  const allGroups = useQuery(api.groups.list, withGroups && !single && open ? {} : "skip");
  const groupHits = searchMemberGroups(allGroups ?? [], text)
    .map((g) => ({ ...g, adds: g.memberIds.filter((id) => !hidden.has(id)) }))
    .filter((g) => g.adds.length > 0)
    .slice(0, 3);
  const pick = (id: string) => {
    if (id.startsWith(GROUP_OPTION)) {
      const gid = id.slice(GROUP_OPTION.length);
      const adds = expandMemberGroups([gid], allGroups ?? []).filter((m) => !hidden.has(m));
      onChange([...value, ...adds]);
    } else onChange(single ? [id] : [...value, id]);
    setText("");
  };
  const remove = (id: string) => onChange(value.filter((v) => v !== id));
  const canAdd = !readOnly && (!single || value.length === 0);

  // <label> で全体を包まない: label 内の最初の labelable 要素（チップの「外す」ボタン）にクリックが転送されるため。
  return (
    <div
      className="picker"
      role="group"
      aria-labelledby={`${listId}-label`}
      // M3E の autocomplete は入力欄の Enter で選んでいる候補を決めるが、日本語入力の確定の Enter と区別しない。
      // iPhone はひらがなを「確定」キーで確定するので、打ち終えた直後の古い候補の先頭（別の人・グループ）が入っていた
      // （利用者報告 2026-10-25）。確定のキーは入力欄（M3E の listener）まで届かせない。既定の動き（確定そのもの）は止めない
      onKeyDownCapture={(e) => {
        if (isImeKeyEvent(e.nativeEvent)) e.stopPropagation();
      }}
    >
      <M3eFormField
        variant="outlined"
        className="field"
        floatLabel="always"
        {...subscriptProps(Boolean(hint), false)}
      >
        <label slot="label" id={`${listId}-label`} {...(canAdd ? { htmlFor: inputId } : {})}>
          {label}
        </label>
        <div className="picker__inner">
          {value.length > 0 ? (
            <div className="picker__chips" role="grid" aria-label={`${label}の選択済み`}>
              {value.map((id) => {
                const name = selected.find((s) => s.id === id)?.name ?? names.current.get(id);
                return (
                  <M3eInputChip
                    key={id}
                    {...(readOnly
                      ? {}
                      : {
                          removable: true,
                          removeLabel: `${name ?? id} を外す`,
                          onRemove: () => remove(id),
                        })}
                  >
                    {name ?? "…"}
                  </M3eInputChip>
                );
              })}
            </div>
          ) : null}
          {canAdd ? (
            <input
              id={inputId}
              className="input picker__input"
              value={text}
              placeholder={
                placeholder ??
                (withGroups && !single ? "名前・メール・グループで検索" : "名前・メールで検索")
              }
              {...(required && value.length === 0 ? { required: true } : {})}
              {...(hint ? { "aria-describedby": `${listId}-hint` } : {})}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setText(e.target.value);
                setOpen(true);
              }}
            />
          ) : null}
        </div>
        {hint ? (
          <span slot="hint" id={`${listId}-hint`}>
            {hint}
          </span>
        ) : null}
      </M3eFormField>
      {canAdd ? (
        <>
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
            {groupHits.map((g) => (
              <M3eOption key={g.id} value={`${GROUP_OPTION}${g.id}`} className="picker__option">
                <M3eIcon name="group" className="picker__group-icon" />
                {g.name}
                <span className="muted small">
                  {" "}
                  グループ・
                  {g.adds.length < g.memberIds.length
                    ? `あと ${g.adds.length} 人`
                    : `${g.memberIds.length} 人`}
                </span>
              </M3eOption>
            ))}
            {visible.map((u) => (
              <M3eOption key={u.id} value={u.id} className="picker__option">
                {u.name}
                {u.generation ? <span className="muted small"> {u.generation} 代</span> : null}
                {u.email ? <span className="muted small"> {u.email}</span> : null}
              </M3eOption>
            ))}
          </M3eAutocomplete>
        </>
      ) : null}
    </div>
  );
}
