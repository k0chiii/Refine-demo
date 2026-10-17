import { api } from "@mf100/convex/api";
import { WORK_CATEGORY_MAX, WORK_TITLE_MAX } from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { mediaLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { DateField } from "@/ui/DateField";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eExpansionPanel } from "@m3e/react/expansion-panel";
import { UserPicker } from "@/ui/UserPicker";
import { CategoryPicker } from "@/features/notation/CategoryPicker";
import { TeamSelect } from "./TeamSelect";

/** 制作物登録（UC-01）のダイアログ。登録者は主管担当として自動的に含まれる。登録後はそのままエディタへ。 */
export function NewWorkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useMutation(api.works.create);
  const [form, setForm] = useState({
    title: "",
    purpose: "",
    category: "",
    mediaType: "pdf",
    legacyId: "",
    confidentiality: "normal",
    notationCategories: [] as string[],
  });
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [creatorIds, setCreatorIds] = useState<string[]>([]);
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [ownerTeam, setOwnerTeam] = useState<string[]>([]);
  const [productionTeamIds, setProductionTeamIds] = useState<string[]>([]);
  const { run, pending } = useAction(async () => {
    const id = await create({
      title: form.title,
      purpose: form.purpose,
      category: form.category,
      mediaType: form.mediaType as "pdf",
      year: 100,
      ...(form.legacyId ? { legacyId: form.legacyId } : {}),
      creatorIds,
      approverId: approverIds[0] ?? "",
      ...(deadlineAt ? { deadlineAt } : {}),
      confidentiality: form.confidentiality as "normal",
      notationCategories: form.notationCategories,
      ...(ownerTeam[0] ? { ownerTeamId: ownerTeam[0] } : {}),
      productionTeamIds,
    });
    onClose();
    void navigate({ to: "/works/$workId", params: { workId: id } });
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" className="dialog--full">
      <span slot="header">制作物を登録</span>
      <div className="dialog-body">
        <Field label="名称" required>
          <TextInput
            required
            maxLength={WORK_TITLE_MAX}
            value={form.title}
            onChange={set("title")}
          />
        </Field>
        <Field label="目的・対象者">
          <TextArea value={form.purpose} onChange={set("purpose")} />
        </Field>
        <div className="form">
          <Field label="区分" required>
            <TextInput
              required
              maxLength={WORK_CATEGORY_MAX}
              value={form.category}
              onChange={set("category")}
            />
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
          <DateField label="納期" value={deadlineAt} onChange={setDeadlineAt} />
        </div>
        <div className="form">
          <TeamSelect label="主管担当" value={ownerTeam} onChange={setOwnerTeam} />
          <TeamSelect
            label="制作担当"
            multi
            value={productionTeamIds}
            onChange={setProductionTeamIds}
          />
        </div>
        <UserPicker label="制作者" required value={creatorIds} onChange={setCreatorIds} />
        <UserPicker
          label="校了権限者"
          required
          single
          value={approverIds}
          onChange={setApproverIds}
        />
        <CategoryPicker
          value={form.notationCategories}
          onChange={(codes) => setForm((f) => ({ ...f, notationCategories: codes }))}
        />
        <M3eExpansionPanel className="expansion">
          <span slot="header">詳細設定（旧ID・機密区分）</span>
          <div className="form">
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
        </M3eExpansionPanel>
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={
            pending ||
            !form.title.trim() ||
            !form.category.trim() ||
            creatorIds.length === 0 ||
            approverIds.length === 0
          }
          onClick={() => void run()}
        >
          登録
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
