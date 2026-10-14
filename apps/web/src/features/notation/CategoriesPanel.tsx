import { api } from "@mf100/convex/api";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { useAction } from "@/lib/useAction";
import { Card } from "@/ui/Card";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { M3eButton, M3eIcon, M3eSnackbar } from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";

type Book = FunctionReturnType<typeof api.notation.ruleBook>;
type Category = Book["categories"][number];

/**
 * カテゴリ（継承・運用メモ）とカテゴリ管理者。
 * 運用メモ: スプレッドシートの説明行・管理メモなど、ルールにできない運用の説明を残す場所。
 * カテゴリ管理者の設定はシステム管理者だけ（Nogiku の組織権限 notation:category:<code> でも付く）。
 */
export function CategoriesPanel({ book }: { book: Book }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      {book.canAssignManagers ? (
        <div className="row">
          <span className="spacer" />
          <M3eButton variant="tonal" onClick={() => setAdding(true)}>
            <M3eIcon slot="icon" name="add" />
            カテゴリを追加
          </M3eButton>
        </div>
      ) : null}
      {adding ? (
        <CategoryCard
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
          onDone={() => setAdding(false)}
        />
      ) : null}
      {book.categories.map((c) => (
        <CategoryCard key={c.code} book={book} category={c} />
      ))}
    </div>
  );
}

function CategoryCard({
  book,
  category,
  isNew,
  onDone,
}: {
  book: Book;
  category: Category;
  isNew?: boolean;
  onDone?: () => void;
}) {
  const upsert = useMutation(api.notation.upsertCategory);
  const setManager = useMutation(api.notation.setManager);
  const [form, setForm] = useState(category);
  const [editing, setEditing] = useState(!!isNew);
  const canEdit = isNew
    ? book.canAssignManagers
    : (book.roles[category.code] ?? "member") !== "member";
  const managers = book.managers.filter((m) => m.categoryCode === category.code);
  const save = useAction(async () => {
    await upsert(form);
    setEditing(false);
    M3eSnackbar.open("カテゴリを保存しました", { duration: 3000 });
    onDone?.();
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
  const count = book.rules.filter((r) => r.categoryCode === category.code).length;
  return (
    <Card title={isNew ? "新しいカテゴリ" : `${category.code} ${category.name}`}>
      {editing ? (
        <div className="stack">
          <div className="rule-editor__grid">
            <Field label="コード" required hint={isNew ? "例: F" : "変更できません"}>
              <TextInput
                value={form.code}
                disabled={!isNew}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              />
            </Field>
            <Field label="名前" required>
              <TextInput
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="説明">
            <TextInput
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <Field
            label="継承するカテゴリ"
            hint={
              book.canAssignManagers
                ? "カンマ区切り。例: A1, A2, A3"
                : "継承の変更はシステム管理者だけ"
            }
          >
            <TextInput
              value={form.parents.join(", ")}
              disabled={!book.canAssignManagers}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  parents: e.target.value
                    .split(/[,、\s]+/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                }))
              }
            />
          </Field>
          <Field label="運用メモ（ルールにできない説明・方針）">
            <TextArea
              rows={5}
              value={form.policyNotes}
              onChange={(e) => setForm((f) => ({ ...f, policyNotes: e.target.value }))}
            />
          </Field>
          <div className="row">
            <span className="spacer" />
            <M3eButton
              variant="text"
              onClick={() => {
                setForm(category);
                setEditing(false);
                onDone?.();
              }}
            >
              キャンセル
            </M3eButton>
            <M3eButton
              variant="filled"
              disabled={save.pending || !form.code || !form.name}
              onClick={() => void save.run()}
            >
              保存
            </M3eButton>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p className="small">{category.description}</p>
          <p className="small muted">
            ルール {count} 件
            {category.parents.length ? `・継承: ${category.parents.join("・")}` : ""}
          </p>
          {category.policyNotes ? (
            <pre className="policy-notes small">{category.policyNotes}</pre>
          ) : null}
          {book.canAssignManagers ? (
            <UserPicker
              label="カテゴリ管理者"
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
          {canEdit ? (
            <div className="row">
              <span className="spacer" />
              <M3eButton variant="text" onClick={() => setEditing(true)}>
                <M3eIcon slot="icon" name="edit" />
                編集
              </M3eButton>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
