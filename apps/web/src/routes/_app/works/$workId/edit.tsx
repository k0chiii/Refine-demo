import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState, type FormEvent } from "react";
import { mediaLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { DateField } from "@/ui/DateField";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { M3eButton, M3eIcon } from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";
import { UserPicker } from "@/ui/UserPicker";

export const Route = createFileRoute("/_app/works/$workId/edit")({ component: EditWork });

/** 制作物の編集（v1 / UC-01 の更新）。職責の変更も含む。楽観的排他（version）で競合を検出する。 */
function EditWork() {
  const { workId } = Route.useParams();
  const navigate = useNavigate();
  const data = useQuery(api.works.get, { workId });
  const update = useMutation(api.works.update);
  const [form, setForm] = useState<{
    title: string;
    purpose: string;
    category: string;
    mediaType: string;
    legacyId: string;
    deadlineAt: number | null;
    confidentiality: string;
    creatorIds: string[];
    approverIds: string[];
    managerIds: string[];
  } | null>(null);

  useEffect(() => {
    if (data && !form) {
      const w = data.work;
      setForm({
        title: w.title,
        purpose: w.purpose,
        category: w.category,
        mediaType: w.mediaType,
        legacyId: w.legacyId ?? "",
        deadlineAt: w.deadlineAt ?? null,
        confidentiality: w.confidentiality,
        creatorIds: [...w.creatorIds],
        approverIds: [w.approverId],
        managerIds: [...w.managerIds],
      });
    }
  }, [data, form]);

  const { run, pending, error } = useAction(async (e: FormEvent) => {
    e.preventDefault();
    if (!data || !form) return;
    const deadlineAt = form.deadlineAt;
    await update({
      workId: workId as Id<"works">,
      expectedVersion: data.work.version,
      patch: {
        title: form.title,
        purpose: form.purpose,
        category: form.category,
        mediaType: form.mediaType as "pdf",
        confidentiality: form.confidentiality as "normal",
        creatorIds: form.creatorIds,
        approverId: form.approverIds[0] ?? data.work.approverId,
        managerIds: form.managerIds,
        ...(form.legacyId ? { legacyId: form.legacyId } : {}),
        ...(deadlineAt ? { deadlineAt } : {}),
      },
    });
    void navigate({ to: "/works/$workId", params: { workId } });
  });

  if (data === undefined || !form) return <p className="muted">読み込み中…</p>;
  if (!data.can.edit)
    return (
      <div className="alert">
        <M3eIcon name="block" />
        この制作物を編集する権限がありません。
      </div>
    );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
  const setIds = (k: "creatorIds" | "approverIds" | "managerIds") => (ids: string[]) =>
    setForm((f) => (f ? { ...f, [k]: ids } : f));

  return (
    <>
      <PageHeader
        title="制作物を編集"
        meta={
          <Link to="/works/$workId" params={{ workId }}>
            {data.work.title}
          </Link>
        }
      />
      <form className="form" onSubmit={(e) => void run(e)}>
        <Field label="名称" required>
          <TextInput required value={form.title} onChange={set("title")} />
        </Field>
        <Field label="目的・対象者">
          <TextArea value={form.purpose} onChange={set("purpose")} />
        </Field>
        <div className="grid-2">
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
            onChange={(v) => setForm((f) => (f ? { ...f, deadlineAt: v } : f))}
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
          <div className="grid-2" style={{ marginTop: 12 }}>
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
        {error ? (
          <div className="alert">
            <M3eIcon name="error" />
            {error.message}
          </div>
        ) : null}
        <div className="form__actions">
          <Link to="/works/$workId" params={{ workId }}>
            <M3eButton variant="text" type="button">
              キャンセル
            </M3eButton>
          </Link>
          <M3eButton
            variant="filled"
            type="submit"
            disabled={pending || form.creatorIds.length === 0 || form.approverIds.length === 0}
          >
            <M3eIcon slot="icon" name="save" />
            保存する
          </M3eButton>
        </div>
      </form>
    </>
  );
}
