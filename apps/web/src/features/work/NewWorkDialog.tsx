import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { UserPicker } from "@/ui/UserPicker";
import { M3eButton } from "@m3e/react/button";
import {
  approversFromForm,
  emptyWorkForm,
  withoutNulls,
  WorkFormFields,
  workFormReady,
  workFormToFields,
  type WorkFormState,
} from "./WorkForm";

/**
 * 制作物登録（UC-01）のダイアログ。項目は Notion の制作物 DB に揃える（利用者決定 2026-10-17。docs/NOTION_ALIGNMENT.md）。
 * 登録者は主管担当として自動的に含まれる。登録後はそのままエディタへ（`onCreated` を渡せば、そちらに任せる。複製で使う）。
 * `initial` を渡すと、その値で埋めた状態から始める（複製。DuplicateWorkDialog）
 */
export function NewWorkDialog({
  open,
  onClose,
  header = "制作物を登録",
  submitLabel = "登録",
  initial,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  header?: string;
  submitLabel?: string;
  /** 最初に入っている値（複製の元）。省略すると空 */
  initial?: { form: WorkFormState; reviewerIds: readonly string[] } | undefined;
  /** 登録できたあと（省略すると新しい制作物のエディタへ移る） */
  onCreated?: ((workId: Id<"works">) => void | Promise<void>) | undefined;
}) {
  const navigate = useNavigate();
  const create = useMutation(api.works.create);
  const [form, setForm] = useState<WorkFormState>(() => initial?.form ?? emptyWorkForm());
  const [reviewerIds, setReviewerIds] = useState<string[]>(() => [...(initial?.reviewerIds ?? [])]);
  const { run, pending } = useAction(async () => {
    const meta = withoutNulls(workFormToFields(form));
    const id = await create({
      title: form.title,
      purpose: form.purpose,
      category: form.category,
      mediaType: form.mediaType as "pdf",
      year: 100,
      ...(form.legacyId ? { legacyId: form.legacyId } : {}),
      creatorIds: form.creatorIds,
      ...approversFromForm(form),
      managerIds: form.managerIds,
      ...(form.deadlineAt ? { deadlineAt: form.deadlineAt } : {}),
      notationCategories: form.notationCategories,
      ...(form.ownerTeam[0] ? { ownerTeamId: form.ownerTeam[0] } : {}),
      productionTeamIds: form.productionTeamIds,
      relatedTeamIds: form.relatedTeamIds,
      reviewerIds: reviewerIds as Id<"users">[],
      ...meta,
    });
    onClose();
    if (onCreated) await onCreated(id as Id<"works">);
    else void navigate({ to: "/works/$workId", params: { workId: id } });
  });
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" className="dialog--full">
      <span slot="header">{header}</span>
      <div className="dialog-body work-form">
        <WorkFormFields form={form} setForm={setForm} mode="create" />
        <UserPicker
          label="校正者"
          groups
          hint="グループを選ぶと、所属する人をまとめて加えます"
          value={reviewerIds}
          onChange={setReviewerIds}
        />
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={pending || !workFormReady(form)}
          onClick={() => void run()}
        >
          {submitLabel}
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
