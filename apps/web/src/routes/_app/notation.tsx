import { api } from "@mf100/convex/api";
import { rulesToCsv, rulesToJson, ruleStrictnessLabels, type RuleDraft } from "@mf100/domain";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { CategoriesPanel } from "@/features/notation/CategoriesPanel";
import { ImportDialog } from "@/features/notation/ImportDialog";
import { ProposalsPanel } from "@/features/notation/ProposalsPanel";
import { draftOf, emptyDraft, RuleEditor } from "@/features/notation/RuleEditor";
import { RuleTable } from "@/features/notation/RuleTable";
import { RuleTester } from "@/features/notation/RuleTester";
import { useWindowClass } from "@/lib/useMedia";
import { ActionSheet } from "@/ui/ActionSheet";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { PaneTabs } from "@/ui/PaneTabs";
import { Field, Select } from "@/ui/Field";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eFilterChip, M3eFilterChipSet } from "@m3e/react/chips";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eActionList, M3eListAction } from "@m3e/react/list";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";
import { M3eSearchBar } from "@m3e/react/search";

type Tab = "rules" | "proposals" | "categories" | "try";

export const Route = createFileRoute("/_app/notation")({
  validateSearch: (s: Record<string, unknown>): { view?: Tab } =>
    s.view === "proposals" || s.view === "categories" || s.view === "try" ? { view: s.view } : {},
  component: Notation,
});

/**
 * 表記ルール（表記統一）。ルールの一覧・検索・編集・無効化・履歴・取り込み・書き出し、変更提案、カテゴリ。
 * 誰でも閲覧・提案でき、編集と承認はカテゴリ管理者（権限はサーバーが判定。画面の出し分けは補助）。
 * 一覧と詳細（利用者指示 2026-10-16「UI はマテリアルデザインにあるものだけで」、利用者決定 2026-10-17「表記ルールは表形式に」）。
 * - 600 以上は表（`RuleTable`。M3 に表は無いので M2 data table の寸法を M3 のトークンと M3E の部品で組む。§54）。
 *   599 以下は M3E のリスト（M3: 表はスマホに向かない）。どちらも行は押すと詳細を開くだけ（行の中に選択欄やスイッチを
 *   置かない: M3 Lists の single-action・Cards の「押せる面の上に操作を置かない」）。カテゴリ・厳格さ・有効／無効は詳細で直す
 * - 840 以上は表（残り全部）と詳細（右に 360、1200 以上は 412。M3 Supporting pane）を並べる。839 以下は詳細をダイアログで開く
 *   （599 以下は全画面）
 */
function Notation() {
  const { view: tab = "rules" } = Route.useSearch();
  const navigate = useNavigate();
  const book = useQuery(api.notation.ruleBook, {});
  const open = useQuery(api.notation.proposals, { status: "open" });
  const win = useWindowClass();
  // 一覧と詳細を並べる幅（M3 Window size classes: expanded 以上は 2 ペイン）
  const twoPane = win === "expanded" || win === "large";
  const [text, setText] = useState("");
  const [cat, setCat] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [onlyThisYear, setOnlyThisYear] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<RuleDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [moreSheet, setMoreSheet] = useState(false);

  const rules = useMemo(() => {
    if (!book) return [];
    const q = text.trim().normalize("NFKC").toLowerCase();
    return book.rules.filter(
      (r) =>
        (showDisabled || r.enabled) &&
        (!cat || r.categoryCode === cat) &&
        (!onlyThisYear || r.years.length === 0 || r.years.includes(100)) &&
        (!q ||
          [r.ruleId, r.title, r.description, ...r.correct, ...r.incorrect, ...r.patterns]
            .join("\n")
            .normalize("NFKC")
            .toLowerCase()
            .includes(q)),
    );
  }, [book, text, cat, showDisabled, onlyThisYear]);

  const setTab = (t: Tab) =>
    void navigate({ to: "/notation", search: t === "rules" ? {} : { view: t }, replace: true });
  const title = <AppBarSlot slot="title">表記ルール</AppBarSlot>;
  if (!book)
    return (
      <>
        {title}
        <Loading label="表記ルールを読み込んでいます" />
      </>
    );
  const canEditAny = Object.values(book.roles).some((r) => r !== "member");
  const current = selected ? (book.rules.find((r) => r.ruleId === selected) ?? null) : null;
  const download = (name: string, body: string, type: string) => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportList = rules.map(draftOf);
  const moreActions = [
    ...(canEditAny
      ? [
          {
            icon: "upload_file",
            label: "取り込み（CSV・JSON）",
            onSelect: () => setImporting(true),
          },
        ]
      : []),
    {
      icon: "download",
      label: "表示中のルールを CSV で書き出す",
      onSelect: () => download("notation-rules.csv", "\ufeff" + rulesToCsv(exportList), "text/csv"),
    },
    {
      icon: "data_object",
      label: "JSON で書き出す（完全）",
      onSelect: () =>
        download(
          "notation-rules.json",
          rulesToJson(exportList, book.categories),
          "application/json",
        ),
    },
  ];
  const openCount = (open ?? []).filter((p) => p.canDecide).length;

  const detail = creating ? (
    <RuleEditor book={book} rule={null} initial={creating} onDone={() => setCreating(null)} />
  ) : current ? (
    <RuleEditor book={book} rule={current} onDone={() => setSelected(null)} />
  ) : null;
  const showPane = twoPane && detail !== null;

  return (
    <div className="notation">
      {title}
      <PaneTabs
        label="表記ルール"
        className="notation__tabs"
        value={tab}
        onChange={setTab}
        items={[
          { id: "rules", label: "ルール" },
          { id: "proposals", label: "提案", count: openCount },
          { id: "categories", label: "カテゴリ" },
          { id: "try", label: "試す" },
        ]}
      />
      {tab === "proposals" ? (
        <ProposalsPanel book={book} />
      ) : tab === "categories" ? (
        <CategoriesPanel book={book} />
      ) : tab === "try" ? (
        <RuleTester book={book} />
      ) : (
        <div className={`notation__ld ${showPane ? "notation__ld--two" : ""}`}>
          <div className={`notation__list ${win !== "compact" ? "notation__list--table" : ""}`}>
            <div className="row notation__toolbar">
              <M3eSearchBar
                className="search notation__search"
                clearable
                onClear={() => setText("")}
              >
                <M3eIcon slot="leading" name="search" />
                <input
                  slot="input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="表記・ID・説明で検索"
                  aria-label="ルールを検索"
                />
              </M3eSearchBar>
              <M3eButton
                variant={win === "compact" ? "tonal" : "filled"}
                className="notation__add"
                onClick={() => {
                  setSelected(null);
                  setCreating(emptyDraft(cat || book.categories[0]?.code || "A1"));
                }}
              >
                <M3eIcon slot="icon" name="add" />
                {canEditAny ? "追加" : "追加を提案"}
              </M3eButton>
              {/* compact の「操作」はボトムシート（ボタンはアプリバーの操作）、medium 以上はメニュー（M3 Breakpoints。§35 L-09） */}
              {win === "compact" ? (
                <>
                  <AppBarSlot slot="actions">
                    <M3eIconButton
                      aria-label="取り込み・書き出し"
                      title="取り込み・書き出し"
                      onClick={() => setMoreSheet(true)}
                    >
                      <M3eIcon name="more_vert" />
                    </M3eIconButton>
                  </AppBarSlot>
                  <ActionSheet
                    open={moreSheet}
                    onClose={() => setMoreSheet(false)}
                    title="取り込み・書き出し"
                    items={moreActions}
                  />
                </>
              ) : (
                <>
                  <M3eIconButton aria-label="取り込み・書き出し" title="取り込み・書き出し">
                    <M3eIcon name="more_vert" />
                    <M3eMenuTrigger htmlFor="notation-more" />
                  </M3eIconButton>
                  <M3eMenu id="notation-more">
                    {moreActions.map((a) => (
                      <M3eMenuItem key={a.label} onClick={a.onSelect}>
                        <M3eIcon slot="icon" name={a.icon} />
                        {a.label}
                      </M3eMenuItem>
                    ))}
                  </M3eMenu>
                </>
              )}
            </div>
            <div className="row notation__filters">
              <Field label="カテゴリ" className="notation__cat">
                <Select
                  aria-label="カテゴリで絞り込み"
                  value={cat || "all"}
                  onChange={(e) => setCat(e.target.value === "all" ? "" : e.target.value)}
                >
                  <option value="all">すべてのカテゴリ</option>
                  {book.categories.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <M3eFilterChipSet aria-label="絞り込み">
                <M3eFilterChip selected={onlyThisYear} onClick={() => setOnlyThisYear((x) => !x)}>
                  MF100 に適用
                </M3eFilterChip>
                <M3eFilterChip selected={showDisabled} onClick={() => setShowDisabled((x) => !x)}>
                  無効も表示
                </M3eFilterChip>
              </M3eFilterChipSet>
              <span className="small muted">{rules.length} 件</span>
            </div>
            {win !== "compact" ? (
              <RuleTable
                book={book}
                rules={rules}
                selected={creating ? null : selected}
                showStatus={showDisabled}
                onOpen={(ruleId) => {
                  setCreating(null);
                  setSelected(ruleId);
                }}
                empty={text ? `「${text}」に一致するルールはありません` : "ルールがありません"}
              />
            ) : rules.length === 0 ? (
              <div className="empty">
                {text ? `「${text}」に一致するルールはありません` : "ルールがありません"}
              </div>
            ) : (
              <M3eActionList className="list notation__rules" aria-label="ルール">
                {rules.map((r) => (
                  <M3eListAction
                    key={r.ruleId}
                    className={`list__item ${r.ruleId === selected ? "list__item--selected" : ""} ${r.enabled ? "" : "list__item--done"}`}
                    {...(r.ruleId === selected ? { "aria-current": "true" } : {})}
                    onClick={() => {
                      setCreating(null);
                      setSelected(r.ruleId);
                    }}
                  >
                    <span className="list__headline">
                      <span className="rule-row__correct">{r.correct[0]}</span>
                      <span className="rule-row__wrong">
                        {" "}
                        ← {[...r.incorrect, ...r.patterns.map((p) => `/${p}/`)].join("・")}
                      </span>
                    </span>
                    <span slot="supporting-text">
                      {r.ruleId}・{r.categoryCode}・{r.title}
                      {r.years.length ? `・MF${r.years.join(",")}` : ""}
                    </span>
                    <span slot="trailing" className="meta">
                      {r.enabled ? ruleStrictnessLabels[r.strictness] : "無効"}
                    </span>
                  </M3eListAction>
                ))}
              </M3eActionList>
            )}
          </div>
          {/* 詳細は M3 Supporting pane: 行を選ぶ（か「追加」）と右に出て、閉じると表が幅いっぱいに戻る */}
          {showPane ? (
            <section className="notation__detail" aria-label="ルールの詳細">
              <header className="notation__detail-head">
                <h2 className="notation__detail-title">
                  {creating ? "ルールを追加" : (current?.title ?? "ルール")}
                </h2>
                <M3eIconButton
                  aria-label="詳細を閉じる"
                  onClick={() => {
                    setSelected(null);
                    setCreating(null);
                  }}
                >
                  <M3eIcon name="close" />
                </M3eIconButton>
              </header>
              {detail}
            </section>
          ) : null}
        </div>
      )}
      {/* 839 以下の詳細はダイアログ（M3 Dialogs: 599 以下は全画面、それより広いと基本のダイアログ） */}
      <M3eDialog
        open={tab === "rules" && !twoPane && detail !== null}
        onClosed={() => {
          setSelected(null);
          setCreating(null);
        }}
        closeLabel="閉じる"
        dismissible
        className="dialog--full"
      >
        <span slot="header">{creating ? "ルールを追加" : (current?.title ?? "ルール")}</span>
        <div className="dialog-body">{detail}</div>
      </M3eDialog>
      <ImportDialog book={book} open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
