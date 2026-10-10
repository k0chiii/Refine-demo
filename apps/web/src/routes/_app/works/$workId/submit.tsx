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
import { epochToJstLocal, formatBytes, formatJst, jstLocalToEpoch } from "@/lib/format";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { M3eButton, M3eIcon, M3eLinearProgressIndicator } from "@/ui/m3e";

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

  const defaultDeadline = useMemo(() => epochToJstLocal(Date.now() + 3 * 86_400_000), []);
  const [form, setForm] = useState({
    kind: "standard",
    reviewType: "general",
    deadline: defaultDeadline,
    changeSummary: "",
    focusNotes: "",
    externalUrl: "",
  });
  const [files, setFiles] = useState<File[]>([]);
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
    const deadlineAt = jstLocalToEpoch(form.deadline);
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
      <div className="card stack">
        <h2 style={{ margin: 0 }}>
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
          <Link to="/works/$workId" params={{ workId }}>
            <M3eButton variant="text">制作物に戻る</M3eButton>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">
        版を提出 <span className="muted small">{work.title}</span>
      </h1>
      {accepting ? (
        <div className="alert alert--info">
          現在 <strong>{accepting.label}</strong> が受付中（締切 {formatJst(accepting.deadlineAt)}
          ）。この提出が<strong>確定した時点</strong>
          で受付が終了します。失敗した場合は受付が維持されます（D1）。
        </div>
      ) : null}
      {!flow ? (
        <form className="form" onSubmit={(e) => void start(e)}>
          <Field
            label="版の種別"
            required
            hint="0版（ラフ）は方向性確認用で通常版と別区分です。通常版の前なら再提出できます（旧ラフの受付は終了）。0版から直接校了はできません。"
          >
            <Select value={form.kind} onChange={set("kind")}>
              <option value="standard">
                通常版（第{revisions.filter((r) => r.kind === "standard").length + 1}版）
              </option>
              <option value="rough" disabled={hasStandard}>
                0版（ラフ）{hasStandard ? "・通常版提出後は不可" : hasRough ? "・再提出" : ""}
              </option>
            </Select>
          </Field>
          <div className="grid-2">
            <Field
              label="校正期限（JST）"
              required
              hint="期限ちょうどの時刻以降は新規指摘を受け付けません。"
            >
              <TextInput
                type="datetime-local"
                required
                value={form.deadline}
                onChange={set("deadline")}
              />
            </Field>
            <Field label="校正の種類">
              <TextInput value={form.reviewType} onChange={set("reviewType")} />
            </Field>
          </div>
          <Field label="変更点">
            <TextArea value={form.changeSummary} onChange={set("changeSummary")} />
          </Field>
          <Field label="見てほしい観点">
            <TextArea value={form.focusNotes} onChange={set("focusNotes")} />
          </Field>
          <Field
            label="ファイル（PDF / 画像 / 原本。複数可）"
            hint="複数案は1つのファイルにまとめてください（C9）。"
          >
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </Field>
          {files.length > 0 ? (
            <ul className="small muted" style={{ margin: 0 }}>
              {files.map((f) => (
                <li key={f.name}>
                  {f.name}（{formatBytes(f.size)}）
                </li>
              ))}
            </ul>
          ) : null}
          <Field
            label="外部リンク（Figma / frame.io / Web など、任意）"
            hint="外部ツール上のコメントは同期されません。結論はこのシステムに記録してください（A-12）。"
          >
            <TextInput
              type="url"
              value={form.externalUrl}
              onChange={set("externalUrl")}
              placeholder="https://"
            />
          </Field>
          {error ? <div className="alert">{error}</div> : null}
          <div className="form__actions">
            <Link to="/works/$workId" params={{ workId }}>
              <M3eButton variant="text" type="button">
                キャンセル
              </M3eButton>
            </Link>
            <M3eButton
              variant="filled"
              type="submit"
              disabled={files.length === 0 && !form.externalUrl.trim()}
            >
              <M3eIcon slot="icon" name="cloud_upload" />
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
                  <span className="chip">外部リンク</span>
                )}
                {it.error ? (
                  <div className="small" style={{ color: "var(--mf-error)" }}>
                    失敗: {it.error}
                  </div>
                ) : null}
              </div>
              <div className="row">
                <span
                  className={`chip ${it.status === "verified" ? "chip--ok" : it.status === "failed" ? "chip--error" : "chip--primary"}`}
                >
                  {
                    { pending: "待機", uploading: "転送中", verified: "検証済み", failed: "失敗" }[
                      it.status
                    ]
                  }
                </span>
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
                <div className="upload-item__bar">
                  <div style={{ width: `${Math.round(it.progress * 100)}%` }} />
                </div>
              ) : null}
            </div>
          ))}
          {failedItems(state).length > 0 ? (
            <div className="alert">
              {failedItems(state).length}{" "}
              件のファイルが失敗しました。失敗したファイルだけを再アップロードしてから確定してください。旧版の受付は維持されています。
            </div>
          ) : null}
          {state.confirming ? <M3eLinearProgressIndicator aria-label="確定処理中" /> : null}
          {state.error || error ? <div className="alert">{state.error ?? error}</div> : null}
          <div className="form__actions">
            <Link to="/works/$workId" params={{ workId }}>
              <M3eButton variant="text">中止して戻る</M3eButton>
            </Link>
            <M3eButton
              variant="filled"
              disabled={!canConfirm(state)}
              onClick={() => void flow.confirm().catch(() => undefined)}
            >
              <M3eIcon slot="icon" name="check_circle" />
              提出を確定する
            </M3eButton>
          </div>
        </div>
      )}
    </>
  );
}
