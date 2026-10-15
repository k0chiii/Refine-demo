import { api } from "@mf100/convex/api";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { useAction } from "@/lib/useAction";
import { DataTable, EditableText, type Column } from "@/ui/DataTable";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { M3eButton, M3eDialog, M3eIcon, M3eIconButton } from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";
import { toast } from "@/lib/toast";

type Book = FunctionReturnType<typeof api.notation.ruleBook>;
type Category = Book["categories"][number];

const splitCodes = (v: string) =>
  v
    .split(/[,、\s]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

/**
 * カテゴリ（継承・運用メモ）とカテゴリ管理者。表のセルでその場で直す（ルールの表と同じ。利用者指示 2026-10-15）。
 * - 名前・説明・継承はセルで直す。継承の変更はシステム管理者だけ
 * - 運用メモ（スプレッドシートの説明行・管理メモなど、ルールにできない運用の説明）とカテゴリ管理者は複数行・複数人なので、
 *   行の「詳細」から開くダイアログで直す
 * - カテゴリ管理者の設定はシステム管理者だけ（Nogiku の組織権限 notation:category:<code> でも付く）
 */
export function CategoriesPanel({ book }: { book: Book }) {
  const upsert = useMutation(api.notation.upsertCategory);
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const canEdit = (c: Category) => (book.roles[c.code] ?? "member") !== "member";
  const save = (c: Category, patch: Partial<Category>) => async () => {
    await upsert({ ...c, ...patch });
  };
  const managersOf = (code: string) => book.managers.filter((m) => m.categoryCode === code);
  const countOf = (code: string) => book.rules.filter((r) => r.categoryCode === code).length;

  const columns: Column<Category>[] = [
    {
      key: "code",
      header: "コード",
      rowHeader: true,
      width: "96px",
      sort: (a, b) => a.code.localeCompare(b.code),
      cell: (c) => c.code,
    },
    {
      key: "name",
      header: "名前",
      sort: (a, b) => a.name.localeCompare(b.name, "ja"),
      cell: (c) => (
        <EditableText
          label={`${c.code} の名前`}
          value={c.name}
          disabled={!canEdit(c)}
          validate={(v) => (v.trim() ? null : "名前を入力してください")}
          onSave={(v) => save(c, { name: v.trim() })()}
        />
      ),
    },
    {
      key: "description",
      header: "説明",
      truncate: "32ch",
      cell: (c) => (
        <EditableText
          label={`${c.code} の説明`}
          value={c.description}
          placeholder="なし"
          disabled={!canEdit(c)}
          onSave={(v) => save(c, { description: v })()}
        />
      ),
    },
    {
      key: "parents",
      header: "継承",
      width: "140px",
      cell: (c) => (
        <EditableText
          label={`${c.code} が継承するカテゴリ`}
          value={c.parents.join(", ")}
          placeholder="なし"
          disabled={!book.canAssignManagers}
          validate={(v) => {
            const codes = splitCodes(v);
            if (codes.includes(c.code)) return "自分自身は継承できません";
            const unknown = codes.filter((x) => !book.categories.some((k) => k.code === x));
            return unknown.length ? `存在しないカテゴリ: ${unknown.join(", ")}` : null;
          }}
          onSave={(v) => save(c, { parents: splitCodes(v) })()}
        />
      ),
    },
    {
      key: "rules",
      header: "ルール",
      numeric: true,
      width: "88px",
      sort: (a, b) => countOf(a.code) - countOf(b.code),
      cell: (c) => countOf(c.code),
    },
    {
      key: "managers",
      header: "管理者",
      truncate: "20ch",
      cell: (c) => {
        const m = managersOf(c.code);
        return m.length ? m.map((x) => x.user.name).join("、") : <span className="muted">—</span>;
      },
    },
    {
      key: "open",
      header: <span className="sr-only">詳細</span>,
      width: "56px",
      cell: (c) => (
        <M3eIconButton
          aria-label={`${c.code} の詳細（運用メモ・管理者）`}
          onClick={() => setDetail(c.code)}
        >
          <M3eIcon name="open_in_full" />
        </M3eIconButton>
      ),
    },
  ];

  const current = book.categories.find((c) => c.code === detail) ?? null;
  return (
    <div className="stack">
      <div className="row">
        <span className="small muted">{book.categories.length} 件</span>
        <span className="spacer" />
        {book.canAssignManagers ? (
          <M3eButton variant="tonal" onClick={() => setAdding(true)}>
            <M3eIcon slot="icon" name="add" />
            カテゴリを追加
          </M3eButton>
        ) : null}
      </div>
      <DataTable
        label="カテゴリ"
        rows={book.categories}
        rowKey={(c) => c.code}
        columns={columns}
        defaultSort={{ key: "code", dir: 1 }}
        empty="カテゴリがありません"
      />
      {adding ? (
        <CategoryDialog
          book={book}
          category={{
            code: "",
            name: "",
            description: "",
            parents: [],
            policyNotes: "",
            order: book.categories.length + 1,
          }}
          isNew
          onClose={() => setAdding(false)}
        />
      ) : null}
      {current ? (
        <CategoryDialog
          key={current.code}
          book={book}
          category={current}
          readOnly={!canEdit(current)}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  );
}

/** カテゴリの追加・詳細（運用メモ・管理者）。Google フォーム風の質問で並べる */
function CategoryDialog({
  book,
  category,
  isNew,
  readOnly,
  onClose,
}: {
  book: Book;
  category: Category;
  isNew?: boolean;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const upsert = useMutation(api.notation.upsertCategory);
  const setManager = useMutation(api.notation.setManager);
  const [form, setForm] = useState(category);
  const managers = book.managers.filter((m) => m.categoryCode === category.code);
  const save = useAction(async () => {
    await upsert(form);
    toast("カテゴリを保存しました");
    onClose();
  });
  const assign = useAction(async (ids: string[]) => {
    const now = new Set(managers.map((m) => m.userId));
    for (const id of ids)
      if (!now.has(id))
        await setManager({ userId: id, categoryCode: category.code, assigned: true });
    for (const id of now)
      if (!ids.includes(id))
        await setManager({ userId: id, categoryCode: category.code, assigned: false });
  });
  return (
    <M3eDialog open onClosed={onClose} closeLabel="閉じる" className="dialog--full">
      <span slot="header">{isNew ? "カテゴリを追加" : `${category.code} ${category.name}`}</span>
      <div className="dialog-body">
        {isNew ? (
          <>
            <Field label="コード" required hint="例: F（英字と数字。あとから変えられません）">
              <TextInput
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              />
            </Field>
            <Field label="名前" required>
              <TextInput
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="説明">
              <TextInput
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <Field label="継承するカテゴリ" hint="カンマ区切り。例: A1, A2, A3">
              <TextInput
                value={form.parents.join(", ")}
                onChange={(e) => setForm((f) => ({ ...f, parents: splitCodes(e.target.value) }))}
              />
            </Field>
          </>
        ) : (
          <p className="small muted">
            ルール {book.rules.filter((r) => r.categoryCode === category.code).length} 件
            {category.parents.length ? `・継承: ${category.parents.join("・")}` : ""}
          </p>
        )}
        <Field
          label="運用メモ"
          hint="ルールにできない説明・方針（スプレッドシートの説明行・管理メモなど）"
        >
          <TextArea
            rows={6}
            value={form.policyNotes}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, policyNotes: e.target.value }))}
          />
        </Field>
        {isNew ? null : book.canAssignManagers ? (
          <UserPicker
            label="カテゴリ管理者"
            hint="このカテゴリのルールを直せる人"
            value={managers.map((m) => m.userId)}
            onChange={(ids) => void assign.run(ids)}
          />
        ) : (
          <p className="small muted">
            管理者:{" "}
            {managers.length
              ? managers.map((m) => m.user.name).join("、")
              : "未設定（システム管理者が管理）"}
          </p>
        )}
      </div>
      <div slot="actions" className="row">
        <span className="spacer" />
        <M3eButton variant="text" onClick={onClose}>
          {readOnly ? "閉じる" : "キャンセル"}
        </M3eButton>
        {readOnly ? null : (
          <M3eButton
            variant="filled"
            disabled={save.pending || !form.code || !form.name}
            onClick={() => void save.run()}
          >
            保存
          </M3eButton>
        )}
      </div>
    </M3eDialog>
  );
}
