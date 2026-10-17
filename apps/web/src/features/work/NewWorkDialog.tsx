import { api } from "@mf100/convex/api";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import {
  emptyWorkForm,
  withoutNulls,
  WorkFormFields,
  workFormReady,
  workFormToFields,
} from "./WorkForm";

/**
 * 制作物登録（UC-01）のダイアログ。項目は Notion の制作物 DB に揃える（利用者決定 2026-10-17。docs/NOTION_ALIGNMENT.md）。
 * 登録者は主管担当として自動的に含まれる。登録後はそのままエディタへ。
 */
export function NewWorkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useMutation(api.works.create);
  const [form, setForm] = useState(emptyWorkForm);
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
      approverId: form.approverIds[0] ?? "",
      managerIds: form.managerIds,
      ...(form.deadlineAt ? { deadlineAt: form.deadlineAt } : {}),
      confidentiality: form.confidentiality as "normal",
      notationCategories: form.notationCategories,
      ...(form.ownerTeam[0] ? { ownerTeamId: form.ownerTeam[0] } : {}),
      productionTeamIds: form.productionTeamIds,
      relatedTeamIds: form.relatedTeamIds,
      ...meta,
    });
    onClose();
    void navigate({ to: "/works/$workId", params: { workId: id } });
  });
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" className="dialog--full">
      <span slot="header">制作物を登録</span>
      <div className="dialog-body work-form">
        <WorkFormFields form={form} setForm={setForm} mode="create" />
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
          登録
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
