import { api } from "@mf100/convex/api";
import { ruleStrictness, ruleStrictnessLabels } from "@mf100/domain";
import type { FunctionReturnType } from "convex/server";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { M3eIcon } from "@m3e/react/icon";
import { M3eTooltip } from "@m3e/react/tooltip";

type Book = FunctionReturnType<typeof api.notation.ruleBook>;
type Rule = Book["rules"][number];

type SortKey = "id" | "correct" | "title" | "cat" | "strictness" | "years";
type Sort = { key: SortKey; dir: 1 | -1 };

/** 列。`hide` のある列は表が狭いときに隠れる（CSS のコンテナクエリ。常に出す列は undefined） */
interface Column {
  key: SortKey | "incorrect" | "status";
  header: string;
  /** 読み上げ用の長い名前（見出しが短いとき） */
  label?: string;
  sort?: (a: Rule, b: Rule) => number;
  numeric?: boolean;
  /** 幅（table-layout: fixed。無い列は残りを等分する） */
  width?: string;
  /** 長い文字を省略記号で切る（切れたときだけ全文をツールチップに出す） */
  truncate?: boolean;
  hide?: "title" | "cat" | "years";
  cell: (r: Rule, book: Book) => ReactNode;
}

const byId = (a: Rule, b: Rule) => a.ruleId.localeCompare(b.ruleId);
const ja = (a: string, b: string) => a.localeCompare(b, "ja");
const minYear = (r: Rule) => (r.years.length ? Math.min(...r.years) : Number.POSITIVE_INFINITY);

const COLUMNS: Column[] = [
  {
    key: "id",
    header: "ID",
    label: "ルール ID",
    width: "96px",
    sort: byId,
    cell: (r) => r.ruleId,
  },
  {
    key: "correct",
    header: "統一表記",
    truncate: true,
    sort: (a, b) => ja(a.correct[0] ?? "", b.correct[0] ?? "") || byId(a, b),
    cell: (r) => (
      <>
        <span className="rule-table__correct">{r.correct[0]}</span>
        {r.correct.length > 1 ? (
          <span className="muted">、{r.correct.slice(1).join("、")}</span>
        ) : null}
      </>
    ),
  },
  {
    key: "incorrect",
    header: "誤表記",
    truncate: true,
    cell: (r) =>
      r.incorrect.length || r.patterns.length ? (
        [
          ...r.incorrect,
          ...r.patterns.map((p) => (
            <code key={`/${p}/`} className="rule-table__pattern">
              /{p}/
            </code>
          )),
        ].flatMap((x, i) => (i ? ["・", x] : [x]))
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    key: "title",
    header: "ルール名",
    truncate: true,
    hide: "title",
    sort: (a, b) => ja(a.title, b.title) || byId(a, b),
    cell: (r) => r.title,
  },
  {
    key: "cat",
    header: "カテゴリ",
    width: "160px",
    truncate: true,
    hide: "cat",
    sort: (a, b) => a.categoryCode.localeCompare(b.categoryCode) || byId(a, b),
    cell: (r, book) => {
      const c = book.categories.find((x) => x.code === r.categoryCode);
      return (
        <>
          {r.categoryCode}
          {c ? <span className="muted"> {c.name}</span> : null}
        </>
      );
    },
  },
  {
    key: "strictness",
    header: "厳格さ",
    width: "84px",
    sort: (a, b) =>
      ruleStrictness.indexOf(a.strictness) - ruleStrictness.indexOf(b.strictness) || byId(a, b),
    cell: (r) => ruleStrictnessLabels[r.strictness],
  },
  {
    key: "years",
    header: "年度",
    label: "適用する年度（MF の回）",
    numeric: true,
    width: "88px",
    hide: "years",
    sort: (a, b) => minYear(a) - minYear(b) || byId(a, b),
    cell: (r) =>
      r.years.length ? (
        r.years.map((y) => `MF${y}`).join(", ")
      ) : (
        <span className="muted">全年度</span>
      ),
  },
  {
    key: "status",
    header: "状態",
    width: "68px",
    cell: (r) => (r.enabled ? "有効" : "無効"),
  },
];

/**
 * ルールの表（600 以上。利用者決定 2026-10-17「表記ルールは表形式に」。docs/UI_M3E.md §54）。
 * M3・M3E に表の部品は無いので、Material の data table の仕様（M2）の寸法・振る舞いを M3 のトークンと M3E の部品で組む。
 * - 見出し 56・行 52・セルの左右 16。見出しは title-small、本文は body-medium。見出しは表の上に貼り付く
 * - 行は押す（Enter・Space）と詳細を開くだけ（single-action。行の中に別の操作は置かない）。選んだ行は secondary-container の
 *   面と先頭の primary の印（手がかり 2 つ）と `aria-selected`。hover は on-surface 8% の state layer
 * - 見出しを押すと並べ替え（`aria-sort`）。並べ替え中の列は矢印を常に出し、ほかの列は hover で出す。既定は ID 順
 * - 数値（年度）は右寄せ・等幅の数字。長い文字は省略記号で切り、切れたセルだけ hover（タッチは長押し）で M3E tooltip に全文
 * - 列の幅は固定（table-layout: fixed）。ID・カテゴリ・厳格さ・年度・状態は決まった幅、統一表記・誤表記・ルール名が残りを分ける
 * - 表が狭いとき（詳細を開いた expanded など）は ルール名 → 年度 → カテゴリ の順に列を隠し、それでも収まらなければ横にスクロール。
 *   隠れた内容は詳細のペインに出る。「状態」の列は「無効も表示」のときだけ（それ以外はすべて有効で並べる意味が無い）
 * - キーボード: 行は Tab で 1 つ（選んだ行か先頭）に止まり、↑↓・Home・End・PageUp／PageDown で行を移る
 */
export function RuleTable({
  book,
  rules,
  selected,
  showStatus,
  onOpen,
  empty,
}: {
  book: Book;
  rules: readonly Rule[];
  selected: string | null;
  /** 「状態」（有効／無効）の列を出す */
  showStatus: boolean;
  onOpen: (ruleId: string) => void;
  empty: ReactNode;
}) {
  const id = useId();
  const [sort, setSort] = useState<Sort>({ key: "id", dir: 1 });
  const columns = useMemo(
    () => COLUMNS.filter((c) => c.key !== "status" || showStatus),
    [showStatus],
  );
  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    return col?.sort ? [...rules].sort((a, b) => col.sort!(a, b) * sort.dir) : rules;
  }, [rules, sort]);

  // 省略記号で切れたセルの全文（hover しているセルにだけ 1 つのツールチップを付ける）
  const [tip, setTip] = useState<{ for: string; text: string } | null>(null);
  const tipRef = useRef<HTMLElement & { show?: () => Promise<void> }>(null);
  useEffect(() => {
    if (!tip) return;
    const raf = requestAnimationFrame(() => void tipRef.current?.show?.());
    return () => cancelAnimationFrame(raf);
  }, [tip]);
  const onClipEnter = (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (el.scrollWidth > el.clientWidth + 1) setTip({ for: el.id, text: el.textContent ?? "" });
  };
  const clipId = (rk: string, ck: string) => `${id}-${rk}-${ck}`.replace(/[^A-Za-z0-9_-]/g, "_");

  // 行のキーボード操作（roving tabindex）
  const focusRow = (from: HTMLElement, step: number | "first" | "last") => {
    const rows = [
      ...(from.closest("tbody")?.querySelectorAll<HTMLTableRowElement>("tr[data-id]") ?? []),
    ];
    const i = rows.indexOf(from as HTMLTableRowElement);
    if (i < 0) return;
    const j =
      step === "first"
        ? 0
        : step === "last"
          ? rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, i + step));
    rows[j]?.focus();
  };
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    const row = e.currentTarget;
    switch (e.key) {
      case "Enter":
      case " ":
        onOpen(row.dataset.id!);
        break;
      case "ArrowDown":
        focusRow(row, 1);
        break;
      case "ArrowUp":
        focusRow(row, -1);
        break;
      case "PageDown":
        focusRow(row, 10);
        break;
      case "PageUp":
        focusRow(row, -10);
        break;
      case "Home":
        focusRow(row, "first");
        break;
      case "End":
        focusRow(row, "last");
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  // Tab で止まる行: 選んだ行。無ければ先頭
  const tabStop = sorted.some((r) => r.ruleId === selected)
    ? selected
    : (sorted[0]?.ruleId ?? null);

  const cellBody = (c: Column, r: Rule) =>
    c.truncate ? (
      <span id={clipId(r.ruleId, c.key)} className="rule-table__clip" onPointerEnter={onClipEnter}>
        {c.cell(r, book)}
      </span>
    ) : (
      c.cell(r, book)
    );
  const colClass = (c: Column) =>
    `${c.numeric ? "rule-table__num" : ""} ${c.hide ? `rule-table__col--${c.hide}` : ""}`;

  return (
    <div className="rule-table">
      <table className="rule-table__table" aria-label="ルール">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`rule-table__th ${colClass(c)}`}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      className={`rule-table__sort ${active ? "rule-table__sort--on" : ""}`}
                      aria-label={`${c.label ?? c.header}で並べ替え`}
                      onClick={() =>
                        setSort((s) =>
                          s.key === c.key
                            ? { key: s.key, dir: s.dir === 1 ? -1 : 1 }
                            : { key: c.key as SortKey, dir: 1 },
                        )
                      }
                    >
                      {c.header}
                      <M3eIcon
                        aria-hidden="true"
                        name={active && sort.dir === -1 ? "arrow_downward" : "arrow_upward"}
                        className="rule-table__sort-icon"
                      />
                    </button>
                  ) : (
                    <span
                      className="rule-table__label"
                      {...(c.label ? { "aria-label": c.label } : {})}
                    >
                      {c.header}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td className="rule-table__empty" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((r) => {
              const isSel = r.ruleId === selected;
              return (
                <tr
                  key={r.ruleId}
                  data-id={r.ruleId}
                  className={`rule-table__row ${isSel ? "rule-table__row--selected" : ""} ${r.enabled ? "" : "rule-table__row--off"}`}
                  aria-selected={isSel}
                  tabIndex={r.ruleId === tabStop ? 0 : -1}
                  onClick={() => onOpen(r.ruleId)}
                  onKeyDown={onRowKey}
                >
                  {columns.map((c) =>
                    c.key === "id" ? (
                      <th
                        key={c.key}
                        scope="row"
                        className={`rule-table__td rule-table__rowhead ${colClass(c)}`}
                      >
                        {cellBody(c, r)}
                      </th>
                    ) : (
                      <td key={c.key} className={`rule-table__td ${colClass(c)}`}>
                        {cellBody(c, r)}
                      </td>
                    ),
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {tip ? (
        <M3eTooltip key={tip.for} ref={tipRef as never} htmlFor={tip.for} touchGestures="auto">
          {tip.text}
        </M3eTooltip>
      ) : null}
    </div>
  );
}
