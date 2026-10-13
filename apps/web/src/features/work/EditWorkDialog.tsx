import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { mediaLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { DateField } from "@/ui/DateField";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { M3eButton, M3eDialog } from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";

type Work = FunctionReturnType<typeof api.works.get>["work"];

/** 制作物の編集（v1 / UC-01 の更新）。職責の変更も含む。楽観的排他（version）で競合を検出する。 */
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
  const initial = () => ({
    title: work.title,
    purpose: work.purpose,
    category: work.category,
    mediaType: work.mediaType as string,
    legacyId: work.legacyId ?? "",
    deadlineAt: work.deadlineAt ?? null,
    confidentiality: work.confidentiality as string,
    creatorIds: [...work.creatorIds],
    approverIds: [work.approverId],
    managerIds: [...work.managerIds],
  });
  const [form, setForm] = useState(initial);
  useEffect(() => {
    if (open) setForm(initial());
  }, [open, work.version]);

  const { run, pending, error } = useAction(async () => {
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
        approverId: form.approverIds[0] ?? work.approverId,
        managerIds: form.managerIds,
        ...(form.legacyId ? { legacyId: form.legacyId } : {}),
        ...(form.deadlineAt ? { deadlineAt: form.deadlineAt } : {}),
      },
    });
    onClose();
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setIds = (k: "creatorIds" | "approverIds" | "managerIds") => (ids: string[]) =>
    setForm((f) => ({ ...f, [k]: ids }));

  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" className="dialog--full">
      <span slot="header">制作物を編集</span>
      <div className="dialog-body">
        <Field label="名称" required>
          <TextInput required value={form.title} onChange={set("title")} />
        </Field>
        <Field label="目的・対象者">
          <TextArea value={form.purpose} onChange={set("purpose")} />
        </Field>
        <div className="form">
          <Field label="区分" required>
            <TextInput required value={form.category} onChange={set("category")} />
          </Field>
          <Field label="媒体" required>
            <Select value={form.mediaType} onChange={set("mediaType")}>
              {Object.entries(mediaLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <DateField
            label="納期"
            value={form.deadlineAt}
            onChange={(v) => setForm((f) => ({ ...f, deadlineAt: v }))}
          />
        </div>
        <UserPicker
          label="主管・制作統括"
          value={form.managerIds}
          onChange={setIds("managerIds")}
        />
        <UserPicker
          label="制作者"
          required
          value={form.creatorIds}
          onChange={setIds("creatorIds")}
        />
        <UserPicker
          label="校了権限者"
          required
          single
          value={form.approverIds}
          onChange={setIds("approverIds")}
        />
        <details className="details">
          <summary>詳細設定（旧ID・機密区分）</summary>
          <div className="form" style={{ marginTop: 12 }}>
            <Field label="旧ID（Notion 等）">
              <TextInput value={form.legacyId} onChange={set("legacyId")} />
            </Field>
            <Field label="機密区分">
              <Select value={form.confidentiality} onChange={set("confidentiality")}>
                <option value="normal">通常</option>
                <option value="restricted">非公開・取扱注意</option>
              </Select>
            </Field>
          </div>
        </details>
        {error ? <div className="alert">{error.message}</div> : null}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={pending || form.creatorIds.length === 0 || form.approverIds.length === 0}
          onClick={() => void run()}
        >
          保存
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
