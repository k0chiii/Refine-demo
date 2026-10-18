import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { M3ePaginator, type M3ePaginatorElement } from "@m3e/react/paginator";
import { M3eIcon } from "@m3e/react/icon";

/**
 * アプリの表の共通の外形（docs/UI_M3E.md §75）。M3・M3E に表の部品が無いので、native `<table>` と CSS（`.mf-table*`）で組み、
 * 中の操作（並べ替えの見出し・ページ送り・チェック・メニュー）に M3E の部品を使う。
 * - 外枠は outline-variant の線と medium の角（M3E の paginator の見本・api-viewer と同じ）。見出しの行は surface-container（白ではない）
 * - 見出し 56・行 52（2 行の行は 64、`dense` は 44）・左右 16。見出しは title-small、本文は body-medium
 * - 見出しは表の上に貼り付く（`scrollMaxHeight` で縦に収めたとき）。下の `footer` は貼り付いた表の外（ページ送り）
 * - 横に溢れたら表の中だけ横にスクロールする（ページは動かさない）。狭い幅で列を隠すかは各表のコンテナクエリ
 */
export function DataTable({
  label,
  className = "",
  lines,
  dense,
  fixed,
  footer,
  children,
}: {
  /** 表の名前（`aria-label`） */
  label: string;
  className?: string;
  /** 1 つのセルに 2 行（本文と補足）を置く表 */
  lines?: 2;
  dense?: boolean;
  /** 列の幅を固定する（`<th style={{ width }}>`。幅の無い列は残りを等分する） */
  fixed?: boolean;
  /** 表の下の帯（ページ送りなど） */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`mf-table ${lines === 2 ? "mf-table--lines2" : ""} ${dense ? "mf-table--dense" : ""} ${fixed ? "mf-table--fixed" : ""} ${className}`}
    >
      <div className="mf-table__scroll">
        <table className="mf-table__table" aria-label={label}>
          {children}
        </table>
      </div>
      {footer ? <div className="mf-table__footer">{footer}</div> : null}
    </div>
  );
}

export type SortDir = "asc" | "desc";

/**
 * 見出しのセル。`sort` があれば押せる見出し（`aria-sort`。M3 の並べ替えの矢印: 並べ替え中の列は常に、ほかは hover・フォーカスで出す）。
 * 数値の列（`numeric`）は右寄せで、矢印は文字の左。`label` は読み上げ用の名前（見出しが短いとき）
 */
export function ColumnHeader({
  className = "",
  numeric,
  label,
  sort,
  style,
  children,
}: {
  className?: string;
  numeric?: boolean;
  label?: string;
  sort?: { active: boolean; dir: SortDir; onSort: () => void };
  style?: CSSProperties | undefined;
  children: ReactNode;
}) {
  return (
    <th
      scope="col"
      className={`mf-table__th ${numeric ? "mf-table__num" : ""} ${className}`}
      style={style}
      aria-sort={sort?.active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      {sort ? (
        <button
          type="button"
          className={`mf-table__sort ${sort.active ? "mf-table__sort--on" : ""}`}
          {...(label ? { "aria-label": `${label}で並べ替え` } : {})}
          onClick={sort.onSort}
        >
          {children}
          <M3eIcon
            aria-hidden="true"
            name={sort.active && sort.dir === "desc" ? "arrow_downward" : "arrow_upward"}
            className="mf-table__sort-icon"
          />
        </button>
      ) : (
        <span className="mf-table__label" {...(label ? { "aria-label": label } : {})}>
          {children}
        </span>
      )}
    </th>
  );
}

/** 表の下のページ送り（M3E paginator。見本と同じ: 件数の選択・範囲・前後の矢印。件数が最小のページより少なければ出さない） */
export function TablePager({
  length,
  pageIndex,
  pageSize,
  pageSizes = "10,25,50,100",
  onPage,
  compact,
}: {
  length: number;
  pageIndex: number;
  pageSize: number;
  pageSizes?: string;
  onPage: (pageIndex: number, pageSize: number) => void;
  /** 件数の選択を隠す（スマホ） */
  compact?: boolean;
}) {
  // 範囲の表記（rangeLabelFormatter）は M3E の側で再描画の対象になっていないので、渡したあと描き直させる
  const ref = useRef<M3ePaginatorElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.rangeLabelFormatter = rangeLabel;
    el.requestUpdate();
  }, []);
  return (
    <M3ePaginator
      ref={ref}
      length={length}
      pageIndex={pageIndex}
      pageSize={pageSize}
      pageSizes={pageSizes}
      hidePageSize={compact ?? false}
      showFirstLastButtons={!compact}
      itemsPerPageLabel="件数"
      previousPageLabel="前のページ"
      nextPageLabel="次のページ"
      firstPageLabel="最初のページ"
      lastPageLabel="最後のページ"
      onPage={(e) => {
        const d = e.detail;
        onPage(d.pageIndex, typeof d.pageSize === "number" ? d.pageSize : length);
      }}
    />
  );
}

const rangeLabel = (pageIndex: number, pageSize: number | "all", length: number) => {
  if (length === 0) return "0";
  const size = pageSize === "all" ? length : pageSize;
  const from = pageIndex * size + 1;
  return `${from}–${Math.min(length, from + size - 1)} / ${length}`;
};

/** 1 ページ分に切る（件数が変わって範囲を超えたら最後のページに寄せる） */
export function pageSlice<T>(rows: readonly T[], pageIndex: number, pageSize: number) {
  const last = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const index = Math.min(pageIndex, last);
  return { index, rows: rows.slice(index * pageSize, (index + 1) * pageSize) };
}
