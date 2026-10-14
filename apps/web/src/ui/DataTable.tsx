import { useEffect, useRef, useState, type ReactNode } from "react";
import { M3eIcon, M3eSwitch } from "./m3e";
import { Select } from "./Field";

/**
 * データ表（M3 / M3E に data table が無いため、Material の data table の寸法を M3 のトークンで組む）。
 * - 行 52・見出し 56・セルの余白 16・区切り線は outline-variant・外枠は shape medium（MDC data table の値）
 * - 行の hover は on-surface 8% の state layer、選択中の行は secondary-container
 * - 見出しを押すと並べ替え（aria-sort）。表は横に溢れたらスクロール（狭い画面でもページは横に動かない）
 */
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** 並べ替えの比較（指定した列だけ見出しを押せる） */
  sort?: (a: T, b: T) => number;
  numeric?: boolean;
  width?: string;
  /** 行の見出し（読み上げで行を識別する列） */
  rowHeader?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  empty,
  selectedKey,
  onRowClick,
  className,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  label: string;
  empty?: ReactNode;
  selectedKey?: string | null;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const shown = col?.sort ? [...rows].sort((a, b) => col.sort!(a, b) * sort!.dir) : rows;
  return (
    <div className={`data-table ${className ?? ""}`} role="region" aria-label={label} tabIndex={0}>
      <table className="data-table__table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`data-table__th ${c.numeric ? "data-table__num" : ""}`}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={
                    active
                      ? sort!.dir === 1
                        ? "ascending"
                        : "descending"
                      : c.sort
                        ? "none"
                        : undefined
                  }
                >
                  {c.sort ? (
                    <button
                      type="button"
                      className="data-table__sort"
                      onClick={() =>
                        setSort((s) =>
                          s?.key === c.key
                            ? { key: c.key, dir: s.dir === 1 ? -1 : 1 }
                            : { key: c.key, dir: 1 },
                        )
                      }
                    >
                      {c.header}
                      <M3eIcon
                        name={active && sort!.dir === -1 ? "arrow_downward" : "arrow_upward"}
                        className={`data-table__sort-icon ${active ? "data-table__sort-icon--on" : ""}`}
                      />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td className="data-table__empty" colSpan={columns.length}>
                {empty ?? "データがありません"}
              </td>
            </tr>
          ) : (
            shown.map((r) => {
              const key = rowKey(r);
              return (
                <tr
                  key={key}
                  className={`data-table__row ${selectedKey === key ? "data-table__row--selected" : ""} ${onRowClick ? "data-table__row--action" : ""}`}
                  {...(selectedKey === key ? { "aria-selected": true } : {})}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {columns.map((c) =>
                    c.rowHeader ? (
                      <th key={c.key} scope="row" className="data-table__td data-table__rowhead">
                        {c.cell(r)}
                      </th>
                    ) : (
                      <td
                        key={c.key}
                        className={`data-table__td ${c.numeric ? "data-table__num" : ""}`}
                      >
                        {c.cell(r)}
                      </td>
                    ),
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

type SaveState = { saving: boolean; error: string | null };

function useSave<V>(onSave: (v: V) => Promise<void>) {
  const [state, setState] = useState<SaveState>({ saving: false, error: null });
  const run = async (v: V) => {
    setState({ saving: true, error: null });
    try {
      await onSave(v);
      setState({ saving: false, error: null });
      return true;
    } catch (e) {
      setState({ saving: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };
  return { ...state, run };
}

/**
 * 編集できるセル（文字）。押す（または Enter）と入力欄になり、Enter・フォーカスを外すと保存、Esc で取消。
 * 保存中・失敗はセルの中に出す（表を離れずに直せる）。編集できない人には値だけを出す。
 */
export function EditableText({
  value,
  label,
  onSave,
  disabled,
  placeholder,
  validate,
  mono,
}: {
  value: string;
  /** 読み上げ用（例: 「統一表記」） */
  label: string;
  onSave: (next: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  /** 誤りがあれば文言を返す */
  validate?: (next: string) => string | null;
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useSave(onSave);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  if (disabled)
    return (
      <span className={`cell-text ${mono ? "mono" : ""}`}>
        {value || <span className="muted">—</span>}
      </span>
    );
  const commit = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    const err = validate?.(draft) ?? null;
    setInvalid(err);
    if (err) return;
    if (await save.run(draft)) setEditing(false);
  };
  if (!editing)
    return (
      <button
        type="button"
        className={`cell-edit ${mono ? "mono" : ""}`}
        aria-label={`${label}: ${value || "未入力"}（押して編集）`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <span className="cell-edit__value">
          {value || <span className="muted">{placeholder ?? "—"}</span>}
        </span>
        <M3eIcon
          name={save.saving ? "progress_activity" : "edit"}
          className="cell-edit__icon"
          aria-hidden="true"
        />
        {save.error ? <span className="cell-error">{save.error}</span> : null}
      </button>
    );
  return (
    <span className="cell-editing" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        className={`cell-input ${invalid || save.error ? "cell-input--error" : ""} ${mono ? "mono" : ""}`}
        aria-label={label}
        aria-invalid={!!(invalid || save.error)}
        value={draft}
        disabled={save.saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") {
            setDraft(value);
            setInvalid(null);
            setEditing(false);
          }
        }}
      />
      {invalid || save.error ? (
        <span className="cell-error" role="alert">
          {invalid ?? save.error}
        </span>
      ) : null}
    </span>
  );
}

/** 編集できるセル（選択）。M3E select をセルの中にそのまま置く */
export function EditableSelect({
  value,
  label,
  options,
  onSave,
  disabled,
}: {
  value: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  onSave: (next: string) => Promise<void>;
  disabled?: boolean;
}) {
  const save = useSave(onSave);
  if (disabled)
    return (
      <span className="cell-text">{options.find((o) => o.value === value)?.label ?? value}</span>
    );
  return (
    <span className="cell-select" onClick={(e) => e.stopPropagation()}>
      <Select
        aria-label={label}
        value={value}
        disabled={save.saving}
        onChange={(e) => {
          if (e.target.value !== value) void save.run(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {save.error ? (
        <span className="cell-error" role="alert">
          {save.error}
        </span>
      ) : null}
    </span>
  );
}

/** 編集できるセル（オン・オフ）。M3E switch */
export function EditableSwitch({
  checked,
  label,
  onSave,
  disabled,
}: {
  checked: boolean;
  label: string;
  onSave: (next: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  const save = useSave(onSave);
  return (
    <span className="cell-switch" onClick={(e) => e.stopPropagation()}>
      <M3eSwitch
        aria-label={label}
        checked={checked}
        icons="selected"
        {...(disabled || save.saving ? { disabled: true } : {})}
        onChange={(e) => void save.run((e.target as unknown as { checked: boolean }).checked)}
      />
      {save.error ? (
        <span className="cell-error" role="alert">
          {save.error}
        </span>
      ) : null}
    </span>
  );
}
