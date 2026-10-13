import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  SubmissionFlow,
  canConfirm,
  failedItems,
  initialState,
  type FlowState,
} from "@/features/upload/submissionFlow";
import { uploadItem } from "@/integrations/api";
import { describeError } from "@/lib/errors";
import { formatBytes, formatJstDate, startOfJstDay } from "@/lib/format";
import { StatusChip } from "@/ui/Chip";
import { DateField } from "@/ui/DateField";
import { Checkbox, Field, Select, TextArea, TextInput } from "@/ui/Field";
import { M3eButton, M3eLinearProgressIndicator } from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";
import { UserPicker } from "@/ui/UserPicker";
import { checkTypeLabels, checkTypes, type CheckType } from "@mf100/domain";

export const Route = createFileRoute("/_app/works/$workId/submit")({ component: Submit });

function guessType(file: File): "pdf" | "image" | "document" | "other" {
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/") || file.type.includes("document")) return "document";
  return "other";
}

/**
 * U-04 版提出。元の制作物から開き対象を引き継ぐ。巨大ファイルは状態と再送可能な範囲を表示する。
 * 「確定」が成功するまで旧版の受付は維持される（サーバー保証）。
 */
function Submit() {
  const { workId } = Route.useParams();
  const navigate = useNavigate();
  const token = useAuthToken();
  const data = useQuery(api.works.get, { workId });
  const prepare = useMutation(api.submissions.prepare);
  const reset = useMutation(api.submissions.reset);
  const confirm = useMutation(api.submissions.confirm);

  // 既定は 3 日後。締切は暦日単位（その日の 0:00 JST）なので、最短は翌日
  const defaultDeadline = useMemo(() => startOfJstDay(Date.now() + 3 * 86_400_000), []);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(defaultDeadline);
  const [form, setForm] = useState({
    kind: "standard",
    reviewType: "general",
    changeSummary: "",
    focusNotes: "",
    externalUrl: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  /** 専門確認（§2.2-4）。種別ごとに要否・担当者を宣言する。校了時に未完了ならブロック（D6）。 */
  const [checks, setChecks] = useState<Record<string, { on: boolean; assignee: string[] }>>(
    Object.fromEntries(checkTypes.map((t) => [t, { on: false, assignee: [] }])),
  );
  const [flow, setFlow] = useState<SubmissionFlow | null>(null);
  const [state, setState] = useState<FlowState>(initialState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => (flow ? flow.subscribe(setState) : undefined), [flow]);

  if (data === undefined) return <p className="muted">読み込み中…</p>;
  const { work, revisions } = data;
  const hasRough = revisions.some((r) => r.kind === "rough");
  const hasStandard = revisions.some((r) => r.kind === "standard");
  const accepting = revisions.find((r) => r.id === data.acceptingRevisionId) ?? null;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!deadlineAt) return setError("校正期限を入力してください");
    if (!token) return setError("認証トークンがありません。再度サインインしてください");
    const items = [
      ...files.map((f) => ({
        fileName: f.name,
        mimeType: f.type || "application/octet-stream",
        type: guessType(f),
        role: "source" as const,
        declaredSize: f.size,
      })),
      ...(form.externalUrl.trim()
        ? [
            {
              fileName: form.externalUrl.trim(),
              mimeType: "text/uri-list",
              type: "external_link" as const,
              role: "external" as const,
              externalUrl: form.externalUrl.trim(),
            },
          ]
        : []),
    ];
    const requiredChecks = checkTypes
      .filter((t) => checks[t]?.on)
      .map((t) => ({
        type: t as CheckType,
        label: checkTypeLabels[t],
        ...(checks[t]?.assignee[0] ? { assigneeId: checks[t]!.assignee[0]! } : {}),
      }));
    const requestId = crypto.randomUUID();
    const f = new SubmissionFlow(
      {
        prepare: () =>
          prepare({
            workId: work.id as Id<"works">,
            kind: form.kind as "standard",
            reviewType: form.reviewType,
            deadlineAt,
            changeSummary: form.changeSummary,
            focusNotes: form.focusNotes,
            items,
            ...(requiredChecks.length > 0 ? { requiredChecks } : {}),
            requestId,
          }).then((r) => ({ sessionId: r.sessionId, items: r.items })),
        upload: (itemId, file, onProgress) => uploadItem(token, itemId, file, onProgress),
        reset: (itemId) => reset({ itemId: itemId as Id<"uploadItems"> }).then(() => undefined),
        confirm: (sessionId, rid) =>
          confirm({
            sessionId: sessionId as Id<"uploadSessions">,
            requestId: rid,
            expectedWorkVersion: work.version,
          }),
        randomId: () => crypto.randomUUID(),
      },
      files,
    );
    setFlow(f);
    try {
      await f.start();
    } catch (err) {
      setError(describeError(err).message);
    }
  };

  if (state.confirmed) {
    return (
      <>
        <PageHeader title="版を提出" meta={<span className="muted">{work.title}</span>} />
        <div className="empty" style={{ textAlign: "left", justifyItems: "start" }}>
          <StatusChip tone="success">提出確定</StatusChip>
          <h2 style={{ margin: 0 }} className="title-small">
            {state.confirmed.kind === "rough" ? "0版（ラフ）" : `第${state.confirmed.sequence}版`}
            を提出確定しました
          </h2>
          {state.confirmed.supersededRevisionId ? (
            <p className="muted" style={{ margin: 0 }}>
              旧版の新規校正受付は同時に終了しました。旧版の既存指摘は履歴として残ります。
            </p>
          ) : null}
          <div className="row">
            <M3eButton
              variant="filled"
              onClick={() =>
                navigate({
                  to: "/revisions/$revisionId",
                  params: { revisionId: state.confirmed!.revisionId },
                })
              }
            >
              校正ワークスペースを開く
            </M3eButton>
            <Link to="/works/$workId" params={{ workId }} className="nav-link">
              <M3eButton variant="text">制作物に戻る</M3eButton>
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="版を提出" meta={<span className="muted">{work.title}</span>} />
      {accepting ? (
        <div className="alert alert--info" style={{ marginBottom: 16 }}>
          <span>
            <strong>{accepting.label}</strong> が受付中（締切 {formatJstDate(accepting.deadlineAt)}
            ）。この提出を確定した時点で受付が終了します。
          </span>
        </div>
      ) : null}
      {!flow ? (
        <form className="form" onSubmit={(e) => void start(e)}>
          <Field label="版の種別" required>
            <Select value={form.kind} onChange={set("kind")}>
              <option value="standard">
                通常版（第{revisions.filter((r) => r.kind === "standard").length + 1}版）
              </option>
              <option value="rough" disabled={hasStandard}>
                0版（ラフ）{hasStandard ? "・通常版提出後は不可" : hasRough ? "・再提出" : ""}
              </option>
            </Select>
          </Field>
          <DateField
            label="校正期限"
            required
            value={deadlineAt}
            onChange={setDeadlineAt}
            min={startOfJstDay(Date.now() + 86_400_000)}
          />
          <Field label="変更点">
            <TextArea value={form.changeSummary} onChange={set("changeSummary")} />
          </Field>
          <Field label="見てほしい観点">
            <TextArea value={form.focusNotes} onChange={set("focusNotes")} />
          </Field>
          <div className="file-drop">
            <div className="row">
              <span className="label-large">ファイル</span>
            </div>
            <input
              type="file"
              multiple
              aria-label="ファイルを選択"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 ? (
              <div className="row">
                {files.map((f) => (
                  <StatusChip key={f.name}>
                    {f.name}（{formatBytes(f.size)}）
                  </StatusChip>
                ))}
              </div>
            ) : null}
          </div>
          <details className="details checks-details">
            <summary>専門確認を依頼する</summary>
            <div className="checks">
              {checkTypes.map((t) => (
                <div key={t} className={`check ${checks[t]?.on ? "" : "check--done"}`}>
                  <Checkbox
                    id={`check-${t}`}
                    checked={checks[t]?.on ?? false}
                    onChange={(on) => setChecks((c) => ({ ...c, [t]: { ...c[t]!, on } }))}
                    label={checkTypeLabels[t]}
                  />
                  <span />
                  {checks[t]?.on ? (
                    <div style={{ minWidth: 260 }}>
                      <UserPicker
                        label="担当者（任意）"
                        single
                        value={checks[t]?.assignee ?? []}
                        onChange={(ids) =>
                          setChecks((c) => ({ ...c, [t]: { ...c[t]!, assignee: ids } }))
                        }
                      />
                    </div>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
          </details>
          <details className="details">
            <summary>外部リンク</summary>
            <div style={{ marginTop: 12 }}>
              <Field label="URL">
                <TextInput
                  type="url"
                  value={form.externalUrl}
                  onChange={set("externalUrl")}
                  placeholder="https://"
                />
              </Field>
            </div>
          </details>
          {error ? <div className="alert">{error}</div> : null}
          <div className="form__actions">
            <Link to="/works/$workId" params={{ workId }} className="nav-link">
              <M3eButton variant="text" type="button">
                キャンセル
              </M3eButton>
            </Link>
            <M3eButton
              variant="filled"
              type="submit"
              disabled={files.length === 0 && !form.externalUrl.trim()}
            >
              アップロードを開始
            </M3eButton>
          </div>
        </form>
      ) : (
        <div className="stack">
          {state.items.map((it) => (
            <div key={it.itemId} className="upload-item">
              <div>
                <strong>{it.fileName}</strong>
                {it.file ? (
                  <span className="muted small">（{formatBytes(it.file.size)}）</span>
                ) : (
                  <StatusChip className="ml">外部リンク</StatusChip>
                )}
                {it.error ? (
                  <div className="small" style={{ color: "var(--mf-error)" }}>
                    失敗: {it.error}
                  </div>
                ) : null}
              </div>
              <div className="row">
                <StatusChip
                  tone={
                    it.status === "verified"
                      ? "success"
                      : it.status === "failed"
                        ? "error"
                        : "primary"
                  }
                  className={it.status === "verified" ? "chip--ok" : ""}
                >
                  {
                    { pending: "待機", uploading: "転送中", verified: "検証済み", failed: "失敗" }[
                      it.status
                    ]
                  }
                </StatusChip>
                {it.status === "failed" ? (
                  <M3eButton
                    variant="tonal"
                    onClick={() =>
                      void flow
                        .retry(it.itemId)
                        .catch((e: unknown) => setError(describeError(e).message))
                    }
                  >
                    再アップロード
                  </M3eButton>
                ) : null}
              </div>
              {it.status === "uploading" ? (
                <M3eLinearProgressIndicator
                  className="upload-item__bar"
                  value={Math.round(it.progress * 100)}
                  max={100}
                  aria-label={`${it.fileName} の転送`}
                />
              ) : null}
            </div>
          ))}
          {failedItems(state).length > 0 ? (
            <div className="alert">
              <span>
                {failedItems(state).length}{" "}
                件のファイルが失敗しました。失敗したファイルだけを再アップロードしてから確定してください。旧版の受付は維持されています。
              </span>
            </div>
          ) : null}
          {state.confirming ? <M3eLinearProgressIndicator aria-label="確定処理中" /> : null}
          {state.error || error ? <div className="alert">{state.error ?? error}</div> : null}
          <div className="form__actions">
            <Link to="/works/$workId" params={{ workId }} className="nav-link">
              <M3eButton variant="text">中止して戻る</M3eButton>
            </Link>
            <M3eButton
              variant="filled"
              disabled={!canConfirm(state)}
              onClick={() => void flow.confirm().catch(() => undefined)}
            >
              提出を確定する
            </M3eButton>
          </div>
        </div>
      )}
    </>
  );
}
