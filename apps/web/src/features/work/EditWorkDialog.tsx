import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import {
  approversFromForm,
  WorkFormFields,
  workFormFromWork,
  workFormReady,
  workFormToFields,
} from "./WorkForm";

type Work = FunctionReturnType<typeof api.works.get>["work"];

/**
 * 制作物の編集（v1 / UC-01 の更新）。職責の変更も含む。楽観的排他（version）で競合を検出する。
 * 項目は登録と同じ（Notion の制作物 DB に揃えた。docs/NOTION_ALIGNMENT.md）。空にした任意の項目は null で消す。
 */
export function EditWorkDialog({
  work,
  open,
  onClose,
}: {
  work: Work;
  open: boolean;
  onClose: () => void;
}) {
  const update = useMutation(api.works.update);
  const me = useQuery(api.me.me, {});
  // 校了者を決める権限が無い人は、校了者の項目を送らない（変えられないので、見せるだけ）
  const canAssignApprovers = me?.canAssignApprovers === true;
  const [form, setForm] = useState(() => workFormFromWork(work));
  useEffect(() => {
    if (open) setForm(workFormFromWork(work));
  }, [open, work.version]);

  const { run, pending } = useAction(async () => {
    await update({
      workId: work.id as Id<"works">,
      expectedVersion: work.version,
      patch: {
        title: form.title,
        purpose: form.purpose,
        category: form.category,
        mediaType: form.mediaType as "pdf",
        confidentiality: form.confidentiality as "normal",
        creatorIds: form.creatorIds,
        ...(canAssignApprovers ? approversFromForm(form) : {}),
        managerIds: form.managerIds,
        notationCategories: form.notationCategories,
        // 主管担当を外すときは空文字（application で「なし」に戻す）
        ownerTeamId: form.ownerTeam[0] ?? "",
        productionTeamIds: form.productionTeamIds,
        relatedTeamIds: form.relatedTeamIds,
        ...(form.mediaType === "sns" ? { socialProfileId: form.socialProfileId || null } : {}),
        ...(form.legacyId ? { legacyId: form.legacyId } : {}),
        ...(form.deadlineAt ? { deadlineAt: form.deadlineAt } : {}),
        ...workFormToFields(form),
      },
    });
    onClose();
  });

  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" className="dialog--full">
      <span slot="header">制作物を編集</span>
      <div className="dialog-body work-form">
        <WorkFormFields
          form={form}
          setForm={setForm}
          mode="edit"
          canAssignApprovers={canAssignApprovers}
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
          保存
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
