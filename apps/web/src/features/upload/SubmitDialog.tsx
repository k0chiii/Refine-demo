import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  artifactFormatLabel,
  checkTypeLabels,
  checkTypes,
  collectFigmaUrls,
  pickReviewArtifact,
  type CheckType,
  POST_MANIFEST_NAME,
} from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { figmaStatus, importFigmaFrames, uploadItem } from "@/integrations/api";
import { describeError } from "@/lib/errors";
import { endOfJstDay, formatBytes, formatDeadlineUntil } from "@/lib/format";
import { StatusText } from "@/ui/Chip";
import { DateField } from "@/ui/DateField";
import { Checkbox, Field, Select, TextArea, TextInput } from "@/ui/Field";
import {
  M3eButton,
  M3eIconButton,
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
    notes: "",
    externalUrl: "",
    /** Figma のフレームの URL（1 行 1 つ。取り込んで画像の添付にし、URL も外部リンクとして残す） */
    figmaUrls: "",
  });
  // Figma 連携（Worker にトークンがあるか）。無ければ URL は外部リンク（埋め込み表示）だけ付く
  const [figmaEnabled, setFigmaEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    void figmaStatus(token).then((r) => {
      if (!cancelled) setFigmaEnabled(r.enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [open, token]);
  const figmaFrames = useMemo(() => collectFigmaUrls(form.figmaUrls), [form.figmaUrls]);
  /** 取り込む（画像の添付になる）フレーム: ノード ID のある URL。連携が無ければ取り込まない */
  const figmaImports = figmaEnabled ? figmaFrames.filter((f) => f.ref.nodeId) : [];
  // 初めての版か、版の更新か（説明の項目を FB テンプレに合わせて変える。利用者決定 2026-10-15 A-1）
  const isFirst = !(data?.revisions ?? []).some(
    (r) => r.kind === "standard" && r.reviewState !== "void",
  );
  const [files, setFiles] = useState<File[]>([]);
  // 提出したあと紙面に出るファイル（domain の pickReviewArtifact と同じ選び方。PDF → 画像 → 文章 → 動画。
  // 動画の制作物は動画を先に）
  const shownFile =
    pickReviewArtifact(
      files.map((f) => ({ type: guessArtifactType(f.name, f.type), role: "source" as const, f })),
      data?.work.mediaType === "video" ? "video" : undefined,
    )?.f ?? null;
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
      // Figma のフレーム（ファイルの次に並べる。SubmissionFlow がこの順を前提にする）。名前は取り込みでノード名になる
      ...figmaImports.map((f) => ({
        fileName: `figma-${f.ref.nodeId!.replace(":", "-")}.png`,
        mimeType: "image/png",
        type: "image" as const,
        role: "source" as const,
        origin: {
          kind: "figma" as const,
          fileKey: f.ref.fileKey,
          nodeId: f.ref.nodeId!,
          scale: 2,
          box: { width: 0, height: 0 },
        },
      })),
      // Figma の URL は外部リンクとしても残す（埋め込み表示・フレーム単位のコメント・「Figma で開く」）
      ...figmaFrames.map((f) => ({
        fileName: f.url,
        mimeType: "text/uri-list",
        type: "external_link" as const,
        role: "external" as const,
        externalUrl: f.url,
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
    // SNS 投稿の版: 添付する内容の記録と同じものを渡し、サーバーで添付との対応を確かめる
    const manifest = files.find((x) => x.name === POST_MANIFEST_NAME);
    const postSnapshot = manifest ? await manifest.text() : undefined;
    const requestId = crypto.randomUUID();
    const f = new SubmissionFlow(
      {
        prepare: () =>
          prepare({
            workId: work.id as Id<"works">,
            kind: form.kind as "standard",
            reviewType: "general",
            deadlineAt,
            // 初回の「補足」は版の説明（changeSummary）の後ろに添える（データの持ち方は変えない）
            changeSummary:
              isFirst && form.notes.trim()
                ? `${form.changeSummary.trim()}\n\n【補足】\n${form.notes.trim()}`.trim()
                : form.changeSummary,
            focusNotes: form.focusNotes,
            items,
            ...(requiredChecks.length > 0 ? { requiredChecks } : {}),
            ...(postSnapshot !== undefined ? { postSnapshot } : {}),
            requestId,
          }).then((r) => ({ sessionId: r.sessionId, items: r.items })),
        upload: (itemId, file, onProgress) => uploadItem(token, itemId, file, onProgress),
        ...(figmaEnabled ? { importFigma: (its) => importFigmaFrames(token, its) } : {}),
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
      figmaImports.map((f) => ({ fileKey: f.ref.fileKey, nodeId: f.ref.nodeId! })),
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
                      <span className="muted">
                        　{formatBytes(f.size)}・
                        {f === shownFile
                          ? "紙面に表示（コメントはこのファイルに）"
                          : `${artifactFormatLabel({ type: guessArtifactType(f.name, f.type), fileName: f.name })}（ダウンロード用）`}
                      </span>
                      <M3eIconButton
                        className="file-drop__remove"
                        aria-label={`${f.name} を外す`}
                        onClick={() => setFiles((cur) => cur.filter((c) => c !== f))}
                      >
                        <M3eIcon name="close" />
                      </M3eIconButton>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <p className="small muted">
              PDF と .ai
              のように、同じ制作物のファイルをまとめて出せます。紙面に出してコメントを付けるのは
              PDF（無ければ画像・文章・動画。動画の制作物は動画）で、ほかのファイルはエディタの「情報
              › この版のファイル」からダウンロードできます。
            </p>
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
            <Field label={isFirst ? "この案の意図" : "変更した点とその理由"}>
              <TextArea
                value={form.changeSummary}
                onChange={set("changeSummary")}
                placeholder={
                  isFirst
                    ? "意識したこと・この表現にした理由など"
                    : "どこを変えたか・なぜ変えたか・この表現にした理由など"
                }
              />
            </Field>
            <Field label={isFirst ? "今回見てほしい点" : "まだ見てほしい点"}>
              <TextArea
                value={form.focusNotes}
                onChange={set("focusNotes")}
                placeholder={
                  isFirst
                    ? "迷っていること・判断したいことなど"
                    : "変更で生まれた新たな迷い・まだ見てほしい点など"
                }
              />
            </Field>
            {isFirst ? (
              <Field label="補足（必要な場合のみ）">
                <TextArea
                  value={form.notes}
                  onChange={set("notes")}
                  placeholder="リファレンス・未確定や未調整の部分・変更できない条件など"
                />
              </Field>
            ) : null}
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
            {/* Figma（利用者決定 2026-10-17: まず REST API で試す。docs/FIGMA_WEB_PROOFING.md FG-05）:
                フレームの URL を貼ると、Worker が Figma から PNG を書き出して画像の添付にする（位置コメントは画像の上）。
                連携が無いとき・ノード ID の無い URL は外部リンク（埋め込み表示とフレーム単位のコメント）だけ */}
            <M3eExpansionPanel
              className="expansion"
              {...(work?.mediaType === "figma" ? { open: true } : {})}
            >
              <span slot="header">Figma のフレーム</span>
              <div className="stack">
                <Field
                  label="フレームの URL（1 行に 1 つ）"
                  hint={
                    figmaEnabled === false
                      ? "Figma 連携が未設定（サーバーに FIGMA_ACCESS_TOKEN が無い）。URL は外部リンクとして付き、Figma の埋め込み表示とフレーム単位のコメントができます。位置を指すコメントには、書き出した PNG・PDF を上の添付に加えてください"
                      : "Figma で フレームを選び「リンクをコピー」（…?node-id=1-2）。提出時に Figma から画像を取り込み、紙面に出して位置コメントを付けられます。URL も外部リンクとして残ります"
                  }
                >
                  <TextArea
                    value={form.figmaUrls}
                    onChange={set("figmaUrls")}
                    placeholder="https://www.figma.com/design/…?node-id=1-2"
                    rows={3}
                  />
                </Field>
                {figmaFrames.length > 0 ? (
                  <p className="small muted" style={{ margin: 0 }}>
                    {figmaFrames.length} 件の Figma の URL
                    {figmaImports.length > 0
                      ? `・${figmaImports.length} 件を画像として取り込みます`
                      : ""}
                    {figmaFrames.some((f) => !f.ref.nodeId)
                      ? "・ノード ID の無い URL はファイル全体の埋め込み表示だけです"
                      : ""}
                  </p>
                ) : null}
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
                        uploading: it.source === "figma" ? "Figma から取り込み中" : "転送中",
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
                      {it.source === "figma" ? "再取り込み" : "再アップロード"}
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
            disabled={
              !work || (files.length === 0 && !form.externalUrl.trim() && figmaFrames.length === 0)
            }
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
