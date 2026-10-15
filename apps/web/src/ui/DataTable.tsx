import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { M3eIcon, M3eLinearProgressIndicator, M3ePaginator, M3eSwitch, M3eTooltip } from "./m3e";
import { Select } from "./Field";

/**
 * データ表。M3（2026 年の部品一覧 37 種）にも M3E にも data table が無いため、Material の data table の仕様
 * （m2.material.io/components/data-tables。ax で全文確認、docs/UI_M3E.md §31）を M3 のトークンと M3E の部品で組む。
 * - 見出し 56・行 52・セルの左右 16（列の間 32 以上）・見出しは medium の太さ・区切り線と外枠 1dp・角 4dp・影なし
 * - 行の hover は背景色（on-surface 8%）、選択中の行は secondary-container
 * - 見出しを押すと並べ替え（aria-sort）、並べ替え中の列の名前の横に矢印。既定の並び順の列にも最初から矢印
 * - 長い文字は省略記号で切り、hover（タッチは長押し）で全文をツールチップ（M3E tooltip）に出す（列の `truncate`）
 * - 読み込み中は見出しの下に線の進捗（M3E linear progress）。行が多いときは表の下にページ送り（M3E paginator）
 * - 数値の列は右寄せ。表を操作する部品（絞り込みのチップなど）は表の直上か直下に置く（呼び出し側）
 * - 表は横に溢れたらスクロール（狭い画面でもページは横に動かない）
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
  /** 長い文字を省略記号で切る最大幅（例: "24ch"）。切れたときだけ全文をツールチップに出す */
  truncate?: string;
}

/** 表の行の多さに応じたページ送り。spec の例（25 行）に合わせ、25 を超えたら出す */
const PAGE_SIZES = "25,50,100,all";

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  empty,
  selectedKey,
  onRowClick,
  className,
  loading,
  defaultSort,
  pageSize: initialPageSize = 25,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  label: string;
  empty?: ReactNode;
  selectedKey?: string | null;
  onRowClick?: (row: T) => void;
  className?: string;
  /** 読み込み中（行が届く前）。空の表示の代わりに進捗を出す */
  loading?: boolean;
  /** 最初の並び順（その列の見出しに矢印を出す。行がすでにその順で届くときも指定する） */
  defaultSort?: { key: string; dir: 1 | -1 };
  /** 1 ページの行数（既定 25）。これより多いと表の下にページ送り */
  pageSize?: number;
}) {
  const id = useId();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(defaultSort ?? null);
  const [page, setPage] = useState<{ index: number; size: number | "all" }>({
    index: 0,
    size: initialPageSize,
  });
  // 行の数や並び順が変わったら最初のページへ
  useEffect(() => setPage((p) => ({ ...p, index: 0 })), [rows.length, sort?.key, sort?.dir]);
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const sorted = col?.sort ? [...rows].sort((a, b) => col.sort!(a, b) * sort!.dir) : rows;
  const paged = rows.length > initialPageSize && page.size !== "all";
  const shown = paged
    ? sorted.slice(page.index * (page.size as number), (page.index + 1) * (page.size as number))
    : sorted;
  // 省略記号で切れたセルの全文（hover しているセルにだけ 1 つのツールチップを付ける）
  const [tip, setTip] = useState<{ for: string; text: string } | null>(null);
  const tipRef = useRef<HTMLElement & { show?: () => Promise<void> }>(null);
  // ツールチップは hover の後に付くので、付いたらすぐ出す（離れたら M3E が消す）
  useEffect(() => {
    if (!tip) return;
    const id = requestAnimationFrame(() => void tipRef.current?.show?.());
    return () => cancelAnimationFrame(id);
  }, [tip]);
  const onClipEnter = (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    // 編集できるセルは中の値の部分が省略記号で切れる
    const box = el.querySelector<HTMLElement>(".cell-edit__value") ?? el;
    if (box.scrollWidth > box.clientWidth + 1) setTip({ for: el.id, text: box.textContent ?? "" });
  };
  const clipId = (rk: string, ck: string) => `${id}-${rk}-${ck}`.replace(/[^A-Za-z0-9_-]/g, "_");
  const cellBody = (c: Column<T>, r: T, rk: string) =>
    c.truncate ? (
      <span
        id={clipId(rk, c.key)}
        className="data-table__clip"
        style={{ maxWidth: c.truncate }}
        onPointerEnter={onClipEnter}
      >
        {c.cell(r)}
      </span>
    ) : (
      c.cell(r)
    );
  return (
    <div className={`data-table ${className ?? ""}`} role="region" aria-label={label} tabIndex={0}>
      {loading ? (
        <M3eLinearProgressIndicator
          className="data-table__progress"
          mode="indeterminate"
          aria-label={`${label}を読み込み中`}
        />
      ) : null}
      <table className="data-table__table" aria-busy={loading ? true : undefined}>
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
                {loading ? "読み込み中…" : (empty ?? "データがありません")}
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
                        {cellBody(c, r, key)}
                      </th>
                    ) : (
                      <td
                        key={c.key}
                        className={`data-table__td ${c.numeric ? "data-table__num" : ""}`}
                      >
                        {cellBody(c, r, key)}
                      </td>
                    ),
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {paged || (rows.length > initialPageSize && page.size === "all") ? (
        <M3ePaginator
          className="data-table__paginator"
          aria-label={`${label}のページ`}
          length={rows.length}
          pageIndex={page.index}
          pageSize={page.size}
          pageSizes={PAGE_SIZES}
          itemsPerPageLabel="1 ページの行数"
          previousPageLabel="前のページ"
          nextPageLabel="次のページ"
          firstPageLabel="最初のページ"
          lastPageLabel="最後のページ"
          rangeLabelFormatter={(index: number, size: number | "all", length: number) => {
            if (size === "all" || length === 0) return `${length} 件`;
            const start = index * size + 1;
            return `${start}–${Math.min(length, start + size - 1)} / ${length} 件`;
          }}
          onPage={(e) => {
            const d = (e as unknown as CustomEvent<{ pageIndex: number; pageSize: number | "all" }>)
              .detail;
            setPage({ index: d.pageIndex, size: d.pageSize });
          }}
        />
      ) : null}
      {tip ? (
        <M3eTooltip key={tip.for} ref={tipRef as never} htmlFor={tip.for} touchGestures="auto">
          {tip.text}
        </M3eTooltip>
      ) : null}
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
