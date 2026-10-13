import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { jstLocalToEpoch } from "@/lib/format";
import { mediaLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { M3eButton, M3eIcon } from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";
import { UserPicker } from "@/ui/UserPicker";

export const Route = createFileRoute("/_app/works/new")({ component: NewWork });

/** 制作物登録（UC-01）。登録者は主管担当として自動的に含まれる（実装上の仮置き）。 */
function NewWork() {
  const navigate = useNavigate();
  const me = useQuery(api.me.me, {});
  const create = useMutation(api.works.create);
  const [form, setForm] = useState({
    title: "",
    purpose: "",
    category: "",
    mediaType: "pdf",
    legacyId: "",
    deadline: "",
    confidentiality: "normal",
  });
  const [creatorIds, setCreatorIds] = useState<string[]>([]);
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const { run, pending, error } = useAction(async (e: FormEvent) => {
    e.preventDefault();
    const deadlineAt = form.deadline ? jstLocalToEpoch(form.deadline) : null;
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
    });
    void navigate({ to: "/works/$workId", params: { workId: id } });
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <PageHeader title="制作物を登録" />
      <form className="form" onSubmit={(e) => void run(e)}>
        <Field label="名称" required>
          <TextInput required value={form.title} onChange={set("title")} />
        </Field>
        <Field label="目的・対象者">
          <TextArea value={form.purpose} onChange={set("purpose")} />
        </Field>
        <div className="grid-2">
          <Field label="区分（例: 印刷物 / Web / グラフィック）" required>
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
          <Field label="旧ID（Notion 等の制作物ID、任意）">
            <TextInput value={form.legacyId} onChange={set("legacyId")} />
          </Field>
          <Field label="納期（JST）">
            <TextInput type="datetime-local" value={form.deadline} onChange={set("deadline")} />
          </Field>
          <Field label="機密区分">
            <Select value={form.confidentiality} onChange={set("confidentiality")}>
              <option value="normal">通常</option>
              <option value="restricted">非公開・取扱注意</option>
            </Select>
          </Field>
        </div>
        <UserPicker
          label="制作者"
          required
          value={creatorIds}
          onChange={setCreatorIds}
          hint={`自分（${me?.name ?? ""}）を含める場合も選択してください。登録者は主管担当として自動的に記録されます。`}
        />
        <UserPicker
          label="校了権限者"
          required
          single
          value={approverIds}
          onChange={setApproverIds}
          hint="校了を宣言できるのはこの一人だけです（C3）。制作者本人を指定すると、独立確認なしの自己校了は拒否されます（D2 暫定）。"
        />
        {error ? (
          <div className="alert">
            <M3eIcon name="error" />
            {error.message}
          </div>
        ) : null}
        <div className="form__actions">
          <M3eButton variant="text" type="button" onClick={() => navigate({ to: "/works" })}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            type="submit"
            disabled={pending || creatorIds.length === 0 || approverIds.length === 0}
          >
            <M3eIcon slot="icon" name="add" />
            登録する
          </M3eButton>
        </div>
      </form>
    </>
  );
}
