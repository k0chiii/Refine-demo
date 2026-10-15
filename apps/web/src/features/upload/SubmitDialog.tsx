import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { checkTypeLabels, checkTypes, type CheckType } from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { uploadItem } from "@/integrations/api";
import { describeError } from "@/lib/errors";
import { endOfJstDay, formatBytes, formatDeadlineUntil } from "@/lib/format";
import { StatusText } from "@/ui/Chip";
import { DateField } from "@/ui/DateField";
import { Checkbox, Field, Select, TextArea, TextInput } from "@/ui/Field";
import {
  M3eButton,
  M3eDialog,
  M3eExpansionPanel,
  M3eIcon,
  M3eLinearProgressIndicator,
} from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";
import {
  SubmissionFlow,
  canConfirm,
  failedItems,
  initialState,
  type FlowState,
} from "./submissionFlow";
import { guessArtifactType, guessMimeType } from "./fileKind";
import { toast } from "@/lib/toast";

/**
 * U-04 版提出（ダイアログ。狭い画面では全画面）。制作物の画面を離れずに提出し、確定後はその版の校正画面へ移る。
 * 巨大ファイルは状態と再送可能な範囲を表示する。「確定」が成功するまで旧版の受付は維持される（サーバー保証）。
 */
export function SubmitDialog({
  workId,
  open,
  onClose,
  initialFiles,
}: {
  workId: string;
  open: boolean;
  onClose: () => void;
  /** 文章エディタの「版として提出」: 下書きから作った HTML を最初から入れておく */
  initialFiles?: File[];
}) {
  const navigate = useNavigate();
  const token = useAuthToken();
  const data = useQuery(api.works.get, open ? { workId } : "skip");
  const prepare = useMutation(api.submissions.prepare);
  const reset = useMutation(api.submissions.reset);
  const confirm = useMutation(api.submissions.confirm);

  // 既定は 3 日後の終わり（日付だけの締切＝その日の 23:59 まで）。当日の終わりも選べる
  const defaultDeadline = useMemo(() => endOfJstDay(Date.now() + 3 * 86_400_000), []);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(defaultDeadline);
  const [form, setForm] = useState({
    kind: "standard",
    changeSummary: "",
    focusNotes: "",
    externalUrl: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  /** 専門確認（§2.2-4）。種別ごとに要否・担当者を宣言する。校了時に未完了ならブロック（D6）。 */
  const [checks, setChecks] = useState<Record<string, { on: boolean; assignee: string[] }>>(
    Object.fromEntries(checkTypes.map((t) => [t, { on: false, assignee: [] }])),
  );
  const [flow, setFlow] = useState<SubmissionFlow | null>(null);
  const [state, setState] = useState<FlowState>(initialState);
  // 入力の不足・転送の失敗はスナックバーで知らせる（ダイアログの中に赤い箱を出さない）
  const setError = (m: string | null) => {
    if (m) toast(m, { kind: "error" });
  };

  useEffect(() => (flow ? flow.subscribe(setState) : undefined), [flow]);
  // 転送・確定の失敗、失敗したファイルの件数はスナックバーで（各ファイルの行にも「失敗」と再アップロードが出る）
  useEffect(() => {
    if (state.error) toast(state.error, { kind: "error" });
  }, [state.error]);
  const failed = failedItems(state).length;
  useEffect(() => {
    if (failed > 0)
      toast(
        `${failed} 件が失敗しました。失敗したファイルだけ再アップロードしてから確定してください（旧版の受付は維持されています）`,
        { kind: "error" },
      );
  }, [failed]);
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) setFiles(initialFiles);
  }, [open, initialFiles]);
  useEffect(() => {
    if (!state.confirmed) return;
    const n = state.confirmed.kind === "rough" ? 0 : state.confirmed.sequence;
    onClose();
    void navigate({ to: "/works/$workId/v/$n", params: { workId, n: String(n) } });
  }, [state.confirmed?.revisionId]);

  const work = data?.work ?? null;
  const revisions = data?.revisions ?? [];
  const hasRough = revisions.some((r) => r.kind === "rough");
  const hasStandard = revisions.some((r) => r.kind === "standard");
  const accepting = revisions.find((r) => r.id === data?.acceptingRevisionId) ?? null;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const addFiles = (list: FileList | File[] | null) => {
    const next = Array.from(list ?? []);
    if (next.length === 0) return;
    setFiles((cur) => [...cur, ...next.filter((f) => !cur.some((c) => c.name === f.name))]);
  };

  const start = async () => {
    setError(null);
    if (!work) return;
    if (!deadlineAt) return setError("校正期限を入力してください");
    if (deadlineAt <= Date.now())
      return setError("校正期限が過ぎています。今より後の日時にしてください");
    if (!token)
      return setError("サインインの有効期限が切れました。もう一度サインインしてください。");
    const items = [
      ...files.map((f) => ({
        fileName: f.name,
        mimeType: guessMimeType(f.name, f.type),
        type: guessArtifactType(f.name, f.type),
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
            reviewType: "general",
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

  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" className="dialog--full">
      <span slot="header">版を提出</span>
      <div className="dialog-body submit">
        {accepting ? (
          <p className="muted small" style={{ margin: 0 }}>
            {`${accepting.label} が ${formatDeadlineUntil(accepting.deadlineAt)}受付中。`}
            確定した時点で受付が終了します。
          </p>
        ) : null}
        {!flow ? (
          <>
            <div
              className={`file-drop ${dragging ? "file-drop--over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <M3eIcon name="upload_file" />
              <span>ここにファイルを置くか、</span>
              <label className="file-drop__pick">
                選択
                <input
                  type="file"
                  multiple
                  aria-label="ファイルを選択"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </label>
              {files.length > 0 ? (
                <ul className="file-drop__files">
                  {files.map((f) => (
                    <li key={f.name}>
                      {f.name}
                      <span className="muted">　{formatBytes(f.size)}</span>
                      <button
                        type="button"
                        className="file-drop__remove"
                        aria-label={`${f.name} を外す`}
                        onClick={() => setFiles((cur) => cur.filter((c) => c !== f))}
                      >
                        <M3eIcon name="close" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="form">
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
                min={Date.now()}
              />
            </div>
            <Field label="変更点">
              <TextArea value={form.changeSummary} onChange={set("changeSummary")} />
            </Field>
            <Field label="見てほしい観点">
              <TextArea value={form.focusNotes} onChange={set("focusNotes")} />
            </Field>
            <M3eExpansionPanel className="expansion checks-details">
              <span slot="header">専門確認を依頼する</span>
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
                      <div style={{ minWidth: 240 }}>
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
            </M3eExpansionPanel>
            <M3eExpansionPanel className="expansion">
              <span slot="header">外部リンク</span>
              <div>
                <Field label="URL">
                  <TextInput
                    type="url"
                    value={form.externalUrl}
                    onChange={set("externalUrl")}
                    placeholder="https://"
                  />
                </Field>
              </div>
            </M3eExpansionPanel>
          </>
        ) : (
          <div className="stack">
            {state.items.map((it) => (
              <div key={it.itemId} className="upload-item">
                <div>
                  {it.fileName}
                  {it.file ? (
                    <span className="muted small">　{formatBytes(it.file.size)}</span>
                  ) : null}
                  {it.error ? (
                    <div className="small" style={{ color: "var(--mf-error)" }}>
                      失敗: {it.error}
                    </div>
                  ) : null}
                </div>
                <div className="row">
                  <StatusText
                    tone={
                      it.status === "verified"
                        ? "success"
                        : it.status === "failed"
                          ? "error"
                          : "neutral"
                    }
                    className={`upload-item__state upload-item__state--${it.status}`}
                  >
                    {
                      {
                        pending: "待機",
                        uploading: "転送中",
                        verified: "確認済み",
                        failed: "失敗",
                      }[it.status]
                    }
                  </StatusText>
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
            {state.confirming ? <M3eLinearProgressIndicator aria-label="確定処理中" /> : null}
          </div>
        )}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          {flow ? "中止して戻る" : "キャンセル"}
        </M3eButton>
        {!flow ? (
          <M3eButton
            variant="filled"
            disabled={!work || (files.length === 0 && !form.externalUrl.trim())}
            onClick={() => void start()}
          >
            アップロードを開始
          </M3eButton>
        ) : (
          <M3eButton
            variant="filled"
            disabled={!canConfirm(state)}
            onClick={() => void flow.confirm().catch(() => undefined)}
          >
            提出を確定する
          </M3eButton>
        )}
      </div>
    </M3eDialog>
  );
}
