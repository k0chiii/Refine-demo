import { api } from "@mf100/convex/api";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { useAction } from "@/lib/useAction";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eActionList, M3eListAction } from "@m3e/react/list";
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
 * カテゴリ（継承・運用メモ）とカテゴリ管理者。M3E のリストで並べ、行を押すとダイアログで直す（利用者指示 2026-10-16
 * 「UI はマテリアルデザインにあるものだけで」。M3 に表は無いので、表のセルで直すのをやめた）。
 * - 行: コードと名前・説明・ルール数（行の末尾）・管理者
 * - 名前・説明・運用メモはカテゴリ管理者、継承とカテゴリ管理者の設定はシステム管理者だけ（Nogiku の組織権限
 *   notation:category:<code> でも付く）
 */
export function CategoriesPanel({ book }: { book: Book }) {
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const canEdit = (c: Category) => (book.roles[c.code] ?? "member") !== "member";
  const managersOf = (code: string) => book.managers.filter((m) => m.categoryCode === code);
  const countOf = (code: string) => book.rules.filter((r) => r.categoryCode === code).length;
  const sorted = [...book.categories].sort((a, b) => a.code.localeCompare(b.code));

  const current = book.categories.find((c) => c.code === detail) ?? null;
  return (
    <div className="stack">
      <div className="row">
        <span className="small muted">{book.categories.length} 件</span>
        <span className="spacer" />
        {book.canAssignManagers ? (
          <M3eButton variant="filled" onClick={() => setAdding(true)}>
            <M3eIcon slot="icon" name="add" />
            カテゴリを追加
          </M3eButton>
        ) : null}
      </div>
      {sorted.length === 0 ? (
        <div className="empty">カテゴリがありません</div>
      ) : (
        <M3eActionList className="list" aria-label="カテゴリ">
          {sorted.map((c) => {
            const m = managersOf(c.code);
            return (
              <M3eListAction key={c.code} className="list__item" onClick={() => setDetail(c.code)}>
                <span className="list__headline">
                  {c.code} {c.name}
                </span>
                <span slot="supporting-text">
                  {[
                    c.description || null,
                    c.parents.length ? `継承 ${c.parents.join("・")}` : null,
                    `管理者 ${m.length ? m.map((x) => x.user.name).join("、") : "未設定"}`,
                  ]
                    .filter(Boolean)
                    .join("・")}
                </span>
                <span slot="trailing" className="meta num">
                  ルール {countOf(c.code)}
                </span>
              </M3eListAction>
            );
          })}
        </M3eActionList>
      )}
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
  const [parentsText, setParentsText] = useState(category.parents.join(", "));
  const parents = splitCodes(parentsText);
  const parentError = parents.includes(form.code)
    ? "自分自身は継承できません"
    : parents.filter((x) => !book.categories.some((k) => k.code === x)).length
      ? `存在しないカテゴリ: ${parents.filter((x) => !book.categories.some((k) => k.code === x)).join(", ")}`
      : null;
  const managers = book.managers.filter((m) => m.categoryCode === category.code);
  const save = useAction(async () => {
    await upsert({ ...form, parents });
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
          <Field label="コード" required hint="例: F（英字と数字。あとから変えられません）">
            <TextInput
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            />
          </Field>
        ) : (
          <p className="small muted">
            ルール {book.rules.filter((r) => r.categoryCode === category.code).length} 件
          </p>
        )}
        <Field label="名前" required>
          <TextInput
            value={form.name}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="説明">
          <TextInput
            value={form.description}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
        <Field
          label="継承するカテゴリ"
          hint={
            book.canAssignManagers
              ? "カンマ区切り。例: A1, A2, A3"
              : "継承を変えられるのはシステム管理者だけです"
          }
          {...(parentError ? { error: parentError } : {})}
        >
          <TextInput
            value={parentsText}
            disabled={!book.canAssignManagers}
            onChange={(e) => setParentsText(e.target.value)}
          />
        </Field>
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
            disabled={save.pending || !form.code || !form.name.trim() || parentError !== null}
            onClick={() => void save.run()}
          >
            保存
          </M3eButton>
        )}
      </div>
    </M3eDialog>
  );
}
