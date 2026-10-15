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
import { AppBarSlot } from "@/ui/AppBarSlot";
import { PaneTabs } from "@/ui/PaneTabs";
import { Field, Select } from "@/ui/Field";
import {
  M3eActionList,
  M3eButton,
  M3eDialog,
  M3eFilterChip,
  M3eFilterChipSet,
  M3eIcon,
  M3eListAction,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
  M3eSearchBar,
} from "@/ui/m3e";

type Tab = "rules" | "proposals" | "categories" | "try";

export const Route = createFileRoute("/_app/notation")({
  validateSearch: (s: Record<string, unknown>): { view?: Tab } =>
    s.view === "proposals" || s.view === "categories" || s.view === "try" ? { view: s.view } : {},
  component: Notation,
});

/**
 * 表記ルール（表記統一）。ルールの一覧・検索・編集・無効化・履歴・取り込み・書き出し、変更提案、カテゴリ。
 * 誰でも閲覧・提案でき、編集と承認はカテゴリ管理者（権限はサーバーが判定。画面の出し分けは補助）。
 * 一覧と詳細（list-detail）。狭い画面では詳細を全画面のダイアログで開く。
 */
function Notation() {
  const { view: tab = "rules" } = Route.useSearch();
  const navigate = useNavigate();
  const book = useQuery(api.notation.ruleBook, {});
  const open = useQuery(api.notation.proposals, { status: "open" });
  const win = useWindowClass();
  const wide = win === "expanded" || win === "large";
  const [text, setText] = useState("");
  const [cat, setCat] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [onlyThisYear, setOnlyThisYear] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<RuleDraft | null>(null);
  const [importing, setImporting] = useState(false);

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
        <p className="muted">読み込み中…</p>
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
  const openCount = (open ?? []).filter((p) => p.canDecide).length;

  const detail = creating ? (
    <RuleEditor book={book} rule={null} initial={creating} onDone={() => setCreating(null)} />
  ) : current ? (
    <RuleEditor book={book} rule={current} onDone={() => setSelected(null)} />
  ) : null;

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
        <div className="notation__ld">
          <div className="notation__list">
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
                variant="filled"
                onClick={() => {
                  setSelected(null);
                  setCreating(emptyDraft(cat || book.categories[0]?.code || "A1"));
                }}
              >
                <M3eIcon slot="icon" name="add" />
                {canEditAny ? "追加" : "追加を提案"}
              </M3eButton>
              <M3eButton variant="text" aria-label="取り込み・書き出し">
                <M3eIcon slot="icon" name="more_vert" />
                その他
                <M3eMenuTrigger htmlFor="notation-more" />
              </M3eButton>
              <M3eMenu id="notation-more">
                {canEditAny ? (
                  <M3eMenuItem onClick={() => setImporting(true)}>
                    <M3eIcon slot="icon" name="upload_file" />
                    取り込み（CSV・JSON）
                  </M3eMenuItem>
                ) : null}
                <M3eMenuItem
                  onClick={() =>
                    download("notation-rules.csv", "﻿" + rulesToCsv(exportList), "text/csv")
                  }
                >
                  <M3eIcon slot="icon" name="download" />
                  表示中のルールを CSV で書き出す
                </M3eMenuItem>
                <M3eMenuItem
                  onClick={() =>
                    download(
                      "notation-rules.json",
                      rulesToJson(exportList, book.categories),
                      "application/json",
                    )
                  }
                >
                  <M3eIcon slot="icon" name="data_object" />
                  JSON で書き出す（完全）
                </M3eMenuItem>
              </M3eMenu>
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
            {rules.length === 0 ? (
              <div className="empty">
                {text ? `「${text}」に一致するルールはありません` : "ルールがありません"}
              </div>
            ) : wide ? (
              <RuleTable
                book={book}
                rules={rules}
                selected={selected}
                onOpen={(id) => {
                  setCreating(null);
                  setSelected(id);
                }}
              />
            ) : (
              <M3eActionList className="list" aria-label="ルール">
                {rules.map((r) => (
                  <M3eListAction
                    key={r.ruleId}
                    className={`list__item ${r.ruleId === selected ? "list__item--selected" : ""} ${r.enabled ? "" : "list__item--done"}`}
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
                      {r.ruleId}・{r.title}
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
        </div>
      )}
      {/* 詳細（説明・例外・履歴）はダイアログ。広い画面では表の上で直接直せるので、詳細は必要なときだけ開く */}
      <M3eDialog
        open={tab === "rules" && detail !== null}
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
