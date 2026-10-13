import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { textRangeAnchor, type Anchor, type NormalizedRect } from "@mf100/domain";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { ImageViewer } from "@/features/annotation/ImageViewer";
import { PdfViewer, anchorPage } from "@/features/annotation/PdfViewer";
import { TextViewer } from "@/features/annotation/TextViewer";
import { useArtifactBlob } from "@/features/annotation/useArtifactBlob";
import type { OverlayThread } from "@/features/annotation/AnchorOverlay";
import { formatJst, formatJstShort, remaining } from "@/lib/format";
import {
  assignmentLabel,
  blockedReasonLabel,
  checkStateLabel,
  closedReasonLabel,
  kindLabel,
  resolutionLabel,
  reviewStateLabel,
  severityLabel,
} from "@/lib/labels";
import { newRequestId, useAction } from "@/lib/useAction";
import { Card } from "@/ui/Card";
import { StatusChip, type ChipTone } from "@/ui/Chip";
import { Field, Select, TextArea } from "@/ui/Field";
import {
  M3eButton,
  M3eDialog,
  M3eFilterChip,
  M3eFilterChipSet,
  M3eIcon,
  M3eIconButton,
} from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";
import { UserPicker } from "@/ui/UserPicker";
import { checkTypeLabels, checkTypes, type CheckType } from "@mf100/domain";

export const Route = createFileRoute("/_app/revisions/$revisionId")({ component: Workspace });

const severityTone: Record<string, ChipTone> = {
  critical: "error",
  major: "warning",
  minor: "neutral",
  info: "neutral",
};
const resolutionTone: Record<string, ChipTone> = {
  open: "primary",
  acknowledged: "neutral",
  accepted: "primary",
  rejected: "neutral",
  deferred: "neutral",
  resolved: "success",
};
const closedResolutions = ["rejected", "resolved", "deferred"];

type Draft = {
  page?: number;
  rect?: NormalizedRect;
  point?: { x: number; y: number };
  range?: { start: number; end: number };
};

/**
 * U-05 校正ワークスペース + U-06 指摘対応。
 * 左: PDF/画像/外部リンク、右: スレッド。位置とスレッドを双方向リンク。版・残り時間・校正対象者を常時表示。
 */
function Workspace() {
  const { revisionId } = Route.useParams();
  const data = useQuery(api.revisions.get, { revisionId });
  const markViewed = useMutation(api.revisions.markViewed);
  const post = useMutation(api.comments.post);
  const decide = useMutation(api.comments.decide);
  const reply = useMutation(api.comments.reply);
  const complete = useMutation(api.reviews.complete);
  const assignThread = useMutation(api.comments.assign);
  const editThread = useMutation(api.comments.edit);
  const carryForward = useMutation(api.comments.carryForward);
  const completeCheck = useMutation(api.checks.complete);
  const waiveCheck = useMutation(api.checks.waive);
  const addCheck = useMutation(api.checks.add);
  const voidRevision = useMutation(api.submissions.voidRevision);

  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [requestedPage, setRequestedPage] = useState<number | null>(null);
  const [filter, setFilter] = useState<{
    unresolvedOnly: boolean;
    severity: string | null;
    mineOnly: boolean;
  }>({ unresolvedOnly: false, severity: null, mineOnly: false });
  const [compose, setCompose] = useState({ body: "", kind: "correction", severity: "minor" });
  const [requestId, setRequestId] = useState(newRequestId);
  const [decision, setDecision] = useState<{
    threadId: string;
    action: string;
    reason: string;
  } | null>(null);
  const [replyDraft, setReplyDraft] = useState<{ threadId: string; body: string } | null>(null);
  const [assignDraft, setAssignDraft] = useState<{ threadId: string; ids: string[] } | null>(null);
  const [editDraft, setEditDraft] = useState<{ threadId: string; body: string } | null>(null);
  const [waiveDraft, setWaiveDraft] = useState<{ checkId: string; reason: string } | null>(null);
  const [addCheckDraft, setAddCheckDraft] = useState<{ type: string; assignee: string[] } | null>(
    null,
  );
  const [voidDraft, setVoidDraft] = useState<string | null>(null);
  const [externalNote, setExternalNote] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (data) void markViewed({ revisionId: revisionId as Id<"revisions"> }).catch(() => undefined);
  }, [data !== undefined, revisionId]);
  useEffect(() => {
    if (data && !artifactId)
      setArtifactId(
        data.artifacts.find((a) => a.role !== "external")?.id ?? data.artifacts[0]?.id ?? null,
      );
  }, [data, artifactId]);

  const artifact = data?.artifacts.find((a) => a.id === artifactId) ?? null;
  const blob = useArtifactBlob(artifact && artifact.role !== "external" ? artifact.id : null);
  // 文章添付は版スナップショットとして UTF-8 テキストに復号して保持する（F-12）
  const [text, setText] = useState<{ artifactId: string; body: string } | null>(null);
  useEffect(() => {
    if (!artifact || artifact.type !== "document" || !blob.blob) return;
    let cancelled = false;
    void blob.blob.text().then((body) => {
      if (!cancelled) setText({ artifactId: artifact.id, body });
    });
    return () => {
      cancelled = true;
    };
  }, [artifact?.id, artifact?.type, blob.blob]);
  const me = useQuery(api.me.me, {});
  const carryCandidates = useQuery(
    api.comments.carryCandidates,
    data?.can.carryForward ? { revisionId: revisionId as Id<"revisions"> } : "skip",
  );

  const doPost = useAction(async () => {
    if (!data) return;
    let anchor: Anchor | undefined;
    if (artifact && draft) {
      if (artifact.type === "pdf" && draft.page)
        anchor = draft.rect
          ? { type: "pdf_rect", artifactId: artifact.id, page: draft.page, rect: draft.rect }
          : draft.point
            ? { type: "pdf_pin", artifactId: artifact.id, page: draft.page, point: draft.point }
            : undefined;
      else if (artifact.type === "image")
        anchor = draft.rect
          ? { type: "image_rect", artifactId: artifact.id, rect: draft.rect }
          : draft.point
            ? { type: "image_pin", artifactId: artifact.id, point: draft.point }
            : undefined;
      else if (artifact.type === "document" && draft.range && text?.artifactId === artifact.id)
        anchor = textRangeAnchor(artifact.id, text.body, draft.range.start, draft.range.end);
    }
    await post({
      revisionId: revisionId as Id<"revisions">,
      body: compose.body,
      kind: compose.kind as "correction",
      severity: compose.severity as "minor",
      requestId,
      ...(anchor ? { anchor } : {}),
    });
    setCompose((c) => ({ ...c, body: "" }));
    setDraft(null);
    setSelecting(false);
    setRequestId(newRequestId());
  });
  const doDecide = useAction(async () => {
    if (!decision) return;
    await decide({
      threadId: decision.threadId as Id<"commentThreads">,
      action: decision.action as "accepted",
      ...(decision.reason.trim() ? { reason: decision.reason.trim() } : {}),
    });
    setDecision(null);
  });
  const doReply = useAction(async () => {
    if (!replyDraft) return;
    await reply({ threadId: replyDraft.threadId as Id<"commentThreads">, body: replyDraft.body });
    setReplyDraft(null);
  });
  const doComplete = useAction(async () => {
    await complete({ revisionId: revisionId as Id<"revisions"> });
  });
  const doAssignThread = useAction(async () => {
    if (!assignDraft) return;
    await assignThread({
      threadId: assignDraft.threadId as Id<"commentThreads">,
      assigneeId: assignDraft.ids[0] ?? null,
    });
    setAssignDraft(null);
  });
  const doEditThread = useAction(async () => {
    if (!editDraft) return;
    await editThread({
      threadId: editDraft.threadId as Id<"commentThreads">,
      body: editDraft.body,
    });
    setEditDraft(null);
  });
  const doCarry = useAction(async (threadId: string) => {
    await carryForward({
      threadId: threadId as Id<"commentThreads">,
      targetRevisionId: revisionId as Id<"revisions">,
    });
  });
  const doCompleteCheck = useAction(async (checkId: string) => {
    await completeCheck({ checkId: checkId as Id<"requiredChecks"> });
  });
  const doWaiveCheck = useAction(async () => {
    if (!waiveDraft) return;
    await waiveCheck({
      checkId: waiveDraft.checkId as Id<"requiredChecks">,
      reason: waiveDraft.reason,
    });
    setWaiveDraft(null);
  });
  const doAddCheck = useAction(async () => {
    if (!addCheckDraft) return;
    await addCheck({
      revisionId: revisionId as Id<"revisions">,
      type: addCheckDraft.type as CheckType,
      ...(addCheckDraft.assignee[0] ? { assigneeId: addCheckDraft.assignee[0] } : {}),
    });
    setAddCheckDraft(null);
  });
  const doVoid = useAction(async () => {
    if (voidDraft === null) return;
    await voidRevision({ revisionId: revisionId as Id<"revisions">, reason: voidDraft });
    setVoidDraft(null);
  });
  const doRecordExternal = useAction(async () => {
    if (!artifact || !externalNote.trim()) return;
    await post({
      revisionId: revisionId as Id<"revisions">,
      body: externalNote.trim(),
      kind: "decision",
      severity: "info",
      requestId,
      anchor: { type: "external", artifactId: artifact.id, note: artifact.externalUrl ?? "" },
    });
    setExternalNote("");
    setRequestId(newRequestId());
  });

  const threads = useMemo(() => {
    if (!data) return [];
    return data.threads
      .map((t, i) => ({ ...t, index: i + 1 }))
      .filter(
        (t) =>
          !filter.unresolvedOnly || ["open", "acknowledged", "accepted"].includes(t.resolution),
      )
      .filter((t) => !filter.severity || t.severity === filter.severity)
      .filter((t) => !filter.mineOnly || t.authorId === me?.id);
  }, [data, filter, me?.id]);

  if (data === undefined) return <p className="muted">読み込み中…</p>;
  const { revision, work, can, assignments, myAssignment, checks } = data;
  const pendingChecks = checks.filter((c) => c.state === "pending").length;
  const overlayThreads: OverlayThread[] = data.threads
    .map((t, i) => ({ id: t.id, anchor: t.anchor as Anchor, severity: t.severity, index: i + 1 }))
    .filter((t) => t.anchor);
  const open = revision.reviewState === "open" && now < revision.deadlineAt;

  const jumpTo = (t: (typeof data.threads)[number]) => {
    setActiveThreadId(t.id);
    if (t.anchor) {
      if (t.anchor.artifactId !== artifactId) setArtifactId(t.anchor.artifactId);
      const p = anchorPage(t.anchor as Anchor);
      if (p) setRequestedPage(p);
    }
  };

  return (
    <>
      <PageHeader
        size="small"
        title={
          <Link to="/works/$workId" params={{ workId: work.id }}>
            {work.title}
          </Link>
        }
        meta={
          <>
            <StatusChip tone="primary">{revision.label}</StatusChip>
            <StatusChip tone={open ? "success" : "neutral"} icon={open ? "schedule" : "lock"}>
              {open
                ? `受付中・${remaining(revision.deadlineAt, now)}`
                : revision.reviewClosedReason
                  ? `受付終了（${closedReasonLabel[revision.reviewClosedReason]}）`
                  : reviewStateLabel[revision.reviewState]}
            </StatusChip>
            <span className="small muted">締切 {formatJst(revision.deadlineAt)}</span>
            {work.finalRevisionId === revision.id ? (
              <StatusChip tone="success" icon="verified">
                校了版
              </StatusChip>
            ) : null}
          </>
        }
      >
        <span className="small muted">
          校正対象者:{" "}
          {assignments.length === 0
            ? "未割当"
            : assignments
                .map((a) => `${a.reviewer?.name}（${assignmentLabel[a.state]}）`)
                .join("、")}
        </span>
        {can.completeReview ? (
          <M3eButton
            variant="tonal"
            disabled={doComplete.pending}
            onClick={() => void doComplete.run()}
          >
            <M3eIcon slot="icon" name="task_alt" />
            自分の確認を完了
          </M3eButton>
        ) : myAssignment?.state === "responded" ? (
          <StatusChip tone="success" icon="task_alt">
            確認完了
          </StatusChip>
        ) : null}
        {can.void ? (
          <M3eButton variant="text" onClick={() => setVoidDraft("")}>
            <M3eIcon slot="icon" name="block" />
            誤提出を無効化
          </M3eButton>
        ) : null}
      </PageHeader>
      {revision.focusNotes ? (
        <div className="alert alert--info" style={{ marginBottom: 12 }}>
          <M3eIcon name="visibility" />
          <span>見てほしい観点: {revision.focusNotes}</span>
        </div>
      ) : null}

      {checks.length > 0 || can.addCheck ? (
        <Card
          ariaLabel="専門確認"
          style={{ marginBottom: 12 }}
          title={
            <span className="row">
              専門確認
              {checks.length > 0 ? (
                <StatusChip
                  tone={pendingChecks > 0 ? "warning" : "success"}
                  icon={pendingChecks > 0 ? "pending" : "task_alt"}
                >
                  {pendingChecks > 0 ? `未完了 ${pendingChecks} 件` : "すべて完了"}
                </StatusChip>
              ) : (
                <span className="small muted">この版に専門確認は宣言されていません</span>
              )}
            </span>
          }
          actions={
            can.addCheck && !addCheckDraft ? (
              <M3eButton
                variant="text"
                onClick={() => setAddCheckDraft({ type: "photo", assignee: [] })}
              >
                <M3eIcon slot="icon" name="add" />
                確認を追加
              </M3eButton>
            ) : null
          }
        >
          {checks.length > 0 ? (
            <div className="checks">
              {checks.map((c) => (
                <div key={c.id} className={`check ${c.state !== "pending" ? "check--done" : ""}`}>
                  <StatusChip
                    tone={
                      c.state === "done" ? "success" : c.state === "waived" ? "neutral" : "warning"
                    }
                    icon={
                      c.state === "done"
                        ? "check_circle"
                        : c.state === "waived"
                          ? "do_not_disturb_on"
                          : "pending"
                    }
                  >
                    {checkStateLabel[c.state]}
                  </StatusChip>
                  <div>
                    <strong>{c.label}</strong>
                    <div className="small muted">
                      担当: {c.assignee?.name ?? "未指定（主管・校了権限者が代行）"}
                      {c.doneByUser
                        ? ` ／ ${c.state === "waived" ? "免除" : "確認"}: ${c.doneByUser.name}・${formatJstShort(c.doneAt ?? 0)}`
                        : ""}
                      {c.note ? ` ／ ${c.note}` : ""}
                    </div>
                  </div>
                  <div className="row">
                    {c.canComplete ? (
                      <M3eButton
                        variant="tonal"
                        disabled={doCompleteCheck.pending}
                        onClick={() => void doCompleteCheck.run(c.id)}
                      >
                        <M3eIcon slot="icon" name="task_alt" />
                        確認完了
                      </M3eButton>
                    ) : null}
                    {c.canWaive ? (
                      <M3eButton
                        variant="text"
                        onClick={() => setWaiveDraft({ checkId: c.id, reason: "" })}
                      >
                        免除
                      </M3eButton>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {waiveDraft ? (
            <div className="stack" style={{ marginTop: 8 }}>
              <Field label="免除の理由（必須・監査に残ります）" required>
                <TextArea
                  value={waiveDraft.reason}
                  onChange={(e) => setWaiveDraft({ ...waiveDraft, reason: e.target.value })}
                />
              </Field>
              <div className="row">
                <M3eButton variant="text" onClick={() => setWaiveDraft(null)}>
                  取消
                </M3eButton>
                <M3eButton
                  variant="filled"
                  disabled={doWaiveCheck.pending || !waiveDraft.reason.trim()}
                  onClick={() => void doWaiveCheck.run()}
                >
                  免除を記録
                </M3eButton>
              </div>
            </div>
          ) : null}
          {addCheckDraft ? (
            <div className="grid-2" style={{ marginTop: 8, alignItems: "end" }}>
              <Field label="確認の種別">
                <Select
                  value={addCheckDraft.type}
                  onChange={(e) => setAddCheckDraft({ ...addCheckDraft, type: e.target.value })}
                >
                  {checkTypes.map((t) => (
                    <option key={t} value={t}>
                      {checkTypeLabels[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <UserPicker
                label="担当者（任意）"
                single
                value={addCheckDraft.assignee}
                onChange={(ids) => setAddCheckDraft({ ...addCheckDraft, assignee: ids })}
              />
              <div className="row">
                <M3eButton variant="text" onClick={() => setAddCheckDraft(null)}>
                  取消
                </M3eButton>
                <M3eButton
                  variant="filled"
                  disabled={doAddCheck.pending}
                  onClick={() => void doAddCheck.run()}
                >
                  追加する
                </M3eButton>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="workspace">
        <div className="stack" style={{ minWidth: 0 }}>
          <div className="row">
            {data.artifacts.map((a) => (
              <M3eFilterChip
                key={a.id}
                selected={a.id === artifactId}
                onClick={() => setArtifactId(a.id)}
              >
                {a.role === "external" ? "外部: " : ""}
                {a.fileName}
              </M3eFilterChip>
            ))}
          </div>
          {!artifact ? (
            <div className="empty">添付がありません</div>
          ) : artifact.role === "external" ? (
            <Card title="外部媒体" variant="outlined">
              <a href={artifact.externalUrl ?? "#"} target="_blank" rel="noreferrer noopener">
                <M3eIcon name="open_in_new" style={{ fontSize: 16, verticalAlign: "middle" }} />{" "}
                {artifact.externalUrl}
              </a>
              <div className="alert alert--warn">
                <M3eIcon name="sync_disabled" />
                <span>
                  外部ツール上のコメントはこのシステムに同期されていません。議論の結論・未解決点は右のスレッドに「合意事項」として記録してください（§9.3
                  / A-12）。
                </span>
              </div>
              {can.comment ? (
                <div className="stack" aria-label="外部での議論結果を記録">
                  <Field
                    label="外部での議論結果（合意事項として記録。この外部リンクに紐づきます）"
                    hint="Figma / frame.io 上で決まったこと・未解決のまま残ったことを要約してください（F-10）。"
                  >
                    <TextArea
                      value={externalNote}
                      onChange={(e) => setExternalNote(e.target.value)}
                      placeholder="例: 表紙のメインビジュアルは案Bで確定。地図ページの配色は次版で再検討。"
                    />
                  </Field>
                  <div className="row">
                    <span className="spacer" />
                    <M3eButton
                      variant="tonal"
                      disabled={doRecordExternal.pending || !externalNote.trim()}
                      onClick={() => void doRecordExternal.run()}
                    >
                      <M3eIcon slot="icon" name="handshake" />
                      合意事項として記録
                    </M3eButton>
                  </div>
                </div>
              ) : null}
            </Card>
          ) : blob.error ? (
            <div className="alert">
              <M3eIcon name="error" />
              {blob.error}
            </div>
          ) : !blob.blob ? (
            <div className="empty">ファイルを取得中…</div>
          ) : artifact.type === "pdf" ? (
            <PdfViewer
              blob={blob.blob}
              artifactId={artifact.id}
              threads={overlayThreads}
              activeThreadId={activeThreadId}
              onSelectThread={setActiveThreadId}
              selecting={selecting}
              draft={draft?.page ? (draft as Draft & { page: number }) : null}
              onDraft={setDraft}
              requestedPage={requestedPage}
            />
          ) : artifact.type === "document" && text?.artifactId === artifact.id ? (
            <TextViewer
              text={text.body}
              artifactId={artifact.id}
              threads={overlayThreads}
              activeThreadId={activeThreadId}
              onSelectThread={setActiveThreadId}
              selecting={selecting}
              draft={draft?.range ?? null}
              onDraft={(r) => setDraft(r ? { range: r } : null)}
            />
          ) : artifact.type === "image" && blob.url ? (
            <ImageViewer
              url={blob.url}
              artifactId={artifact.id}
              threads={overlayThreads}
              activeThreadId={activeThreadId}
              onSelectThread={setActiveThreadId}
              selecting={selecting}
              draft={draft}
              onDraft={setDraft}
            />
          ) : (
            <Card title={artifact.fileName} variant="outlined">
              <p className="muted" style={{ margin: 0 }}>
                この形式はブラウザ内でプレビューできません。
              </p>
              {blob.url ? (
                <a href={blob.url} download={artifact.fileName}>
                  ダウンロード
                </a>
              ) : null}
            </Card>
          )}
        </div>

        <aside className="comments" aria-label="指摘・コメント">
          <div className="comments__header">
            <div className="row">
              <strong>指摘 {data.threads.length} 件</strong>
              <span className="spacer" />
              <span className="small muted">
                未対応{" "}
                {
                  data.threads.filter((t) =>
                    ["open", "acknowledged", "accepted"].includes(t.resolution),
                  ).length
                }
              </span>
            </div>
            <M3eFilterChipSet>
              <M3eFilterChip
                selected={filter.unresolvedOnly}
                onClick={() => setFilter((f) => ({ ...f, unresolvedOnly: !f.unresolvedOnly }))}
              >
                未対応のみ
              </M3eFilterChip>
              <M3eFilterChip
                selected={filter.mineOnly}
                onClick={() => setFilter((f) => ({ ...f, mineOnly: !f.mineOnly }))}
              >
                自分の指摘
              </M3eFilterChip>
              {(["critical", "major"] as const).map((s) => (
                <M3eFilterChip
                  key={s}
                  selected={filter.severity === s}
                  onClick={() =>
                    setFilter((f) => ({ ...f, severity: f.severity === s ? null : s }))
                  }
                >
                  {severityLabel[s]}
                </M3eFilterChip>
              ))}
            </M3eFilterChipSet>
          </div>
          <div className="comments__list">
            {carryCandidates && carryCandidates.length > 0 ? (
              <Card
                variant="outlined"
                ariaLabel="前版の未解決指摘"
                title={
                  <span className="row">
                    <M3eIcon name="move_up" />
                    前版の未解決指摘 {carryCandidates.length} 件
                  </span>
                }
              >
                <p className="small muted" style={{ margin: 0 }}>
                  この版にも当てはまるものを人が確認して引き継ぎます。位置情報は引き継がれません（版が変わるため）。元の指摘は「次版へ持越」になります。
                </p>
                {carryCandidates.map((c) => (
                  <div key={c.id} className="carry">
                    <div className="thread__meta">
                      <StatusChip>{c.revisionLabel}</StatusChip>
                      <StatusChip tone={severityTone[c.severity] ?? "neutral"}>
                        {severityLabel[c.severity]}
                      </StatusChip>
                      <StatusChip>{resolutionLabel[c.resolution]}</StatusChip>
                      <span className="spacer" />
                      <span>{c.author?.name}</span>
                    </div>
                    <div className="thread__body">{c.body}</div>
                    <div className="row">
                      <span className="spacer" />
                      <M3eButton
                        variant="tonal"
                        disabled={doCarry.pending}
                        onClick={() => void doCarry.run(c.id)}
                      >
                        <M3eIcon slot="icon" name="move_up" />
                        この版へ引き継ぐ
                      </M3eButton>
                    </div>
                  </div>
                ))}
              </Card>
            ) : null}
            {threads.length === 0 ? (
              <p className="muted small" style={{ padding: 8 }}>
                表示する指摘はありません。
              </p>
            ) : (
              threads.map((t) => (
                <article
                  key={t.id}
                  className={`thread thread--${t.severity} ${t.id === activeThreadId ? "thread--active" : ""} ${closedResolutions.includes(t.resolution) ? "thread--closed" : ""}`}
                  tabIndex={0}
                  onClick={() => jumpTo(t)}
                  onKeyDown={(e) => e.key === "Enter" && jumpTo(t)}
                  aria-label={`指摘 ${t.index}`}
                >
                  <div className="thread__meta">
                    <StatusChip tone="primary">#{t.index}</StatusChip>
                    <StatusChip>{kindLabel[t.kind]}</StatusChip>
                    <StatusChip
                      tone={severityTone[t.severity] ?? "neutral"}
                      icon={
                        t.severity === "critical"
                          ? "error"
                          : t.severity === "major"
                            ? "warning"
                            : undefined
                      }
                    >
                      {severityLabel[t.severity]}
                    </StatusChip>
                    <StatusChip tone={resolutionTone[t.resolution] ?? "neutral"}>
                      {resolutionLabel[t.resolution]}
                    </StatusChip>
                    {t.anchor ? (
                      <M3eIcon style={{ fontSize: 16 }} title="位置指定あり" name="location_on" />
                    ) : null}
                    {t.carriedFromThreadId ? (
                      <StatusChip icon="move_up">前版から持越</StatusChip>
                    ) : null}
                    {t.assignee ? (
                      <StatusChip icon="person" title="対応担当">
                        担当: {t.assignee.name}
                      </StatusChip>
                    ) : null}
                    {t.editCount ? (
                      <span className="small muted">（訂正 {t.editCount} 回）</span>
                    ) : null}
                    <span className="spacer" />
                    <span>
                      {t.author?.name}・{formatJstShort(t.createdAt)}
                    </span>
                  </div>
                  {t.anchor?.type === "text_range" ? (
                    <blockquote className="thread__quote small">「{t.anchor.quote}」</blockquote>
                  ) : null}
                  <div className="thread__body">{t.body}</div>
                  <ThreadEvents threadId={t.id} active={t.id === activeThreadId} />
                  {t.id === activeThreadId ? (
                    <div className="thread__actions">
                      {can.decide
                        ? (["accepted", "rejected", "deferred", "resolved"] as const).map((a) => (
                            <M3eButton
                              key={a}
                              variant="text"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDecision({ threadId: t.id, action: a, reason: "" });
                              }}
                            >
                              {resolutionLabel[a]}
                            </M3eButton>
                          ))
                        : null}
                      <M3eButton
                        variant="text"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReplyDraft({ threadId: t.id, body: "" });
                        }}
                      >
                        返信
                      </M3eButton>
                      {can.decide ? (
                        <M3eButton
                          variant="text"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignDraft({
                              threadId: t.id,
                              ids: t.assigneeId ? [t.assigneeId] : [],
                            });
                          }}
                        >
                          担当者
                        </M3eButton>
                      ) : null}
                      {t.authorId === me?.id && work.lifecycle !== "finalized" ? (
                        <M3eButton
                          variant="text"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditDraft({ threadId: t.id, body: t.body });
                          }}
                        >
                          訂正
                        </M3eButton>
                      ) : null}
                    </div>
                  ) : null}
                  {assignDraft?.threadId === t.id ? (
                    <div className="stack" onClick={(e) => e.stopPropagation()}>
                      <UserPicker
                        label="対応担当者（空にすると解除）"
                        single
                        value={assignDraft.ids}
                        onChange={(ids) => setAssignDraft({ ...assignDraft, ids })}
                      />
                      <div className="row">
                        <M3eButton variant="text" onClick={() => setAssignDraft(null)}>
                          取消
                        </M3eButton>
                        <M3eButton
                          variant="filled"
                          disabled={doAssignThread.pending}
                          onClick={() => void doAssignThread.run()}
                        >
                          記録する
                        </M3eButton>
                      </div>
                    </div>
                  ) : null}
                  {editDraft?.threadId === t.id ? (
                    <div className="stack" onClick={(e) => e.stopPropagation()}>
                      <Field label="本文の訂正（原文は履歴に残ります）">
                        <TextArea
                          value={editDraft.body}
                          onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })}
                        />
                      </Field>
                      <div className="row">
                        <M3eButton variant="text" onClick={() => setEditDraft(null)}>
                          取消
                        </M3eButton>
                        <M3eButton
                          variant="filled"
                          disabled={doEditThread.pending || !editDraft.body.trim()}
                          onClick={() => void doEditThread.run()}
                        >
                          訂正を保存
                        </M3eButton>
                      </div>
                    </div>
                  ) : null}
                  {decision?.threadId === t.id ? (
                    <div className="stack" onClick={(e) => e.stopPropagation()}>
                      <Field
                        label={`${resolutionLabel[decision.action]} の理由${["rejected", "deferred"].includes(decision.action) ? "（必須）" : "（任意）"}`}
                      >
                        <TextArea
                          value={decision.reason}
                          onChange={(e) => setDecision({ ...decision, reason: e.target.value })}
                        />
                      </Field>
                      <div className="row">
                        <M3eButton variant="text" onClick={() => setDecision(null)}>
                          取消
                        </M3eButton>
                        <M3eButton
                          variant="filled"
                          disabled={doDecide.pending}
                          onClick={() => void doDecide.run()}
                        >
                          記録する
                        </M3eButton>
                      </div>
                    </div>
                  ) : null}
                  {replyDraft?.threadId === t.id ? (
                    <div className="stack" onClick={(e) => e.stopPropagation()}>
                      <TextArea
                        value={replyDraft.body}
                        onChange={(e) => setReplyDraft({ ...replyDraft, body: e.target.value })}
                        placeholder="返信（原文は変更されません）"
                      />
                      <div className="row">
                        <M3eButton variant="text" onClick={() => setReplyDraft(null)}>
                          取消
                        </M3eButton>
                        <M3eButton
                          variant="filled"
                          disabled={doReply.pending || !replyDraft.body.trim()}
                          onClick={() => void doReply.run()}
                        >
                          送信
                        </M3eButton>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
          <div className="compose">
            {!can.comment ? (
              <div className="small muted">
                {blockedReasonLabel[data.commentBlockedReason ?? "forbidden"]}
              </div>
            ) : (
              <>
                <div className="row">
                  <M3eIconButton
                    aria-label="位置を指定"
                    variant={selecting ? "filled" : "standard"}
                    toggle
                    selected={selecting}
                    disabled={!artifact || artifact.role === "external"}
                    onClick={() => setSelecting((v) => !v)}
                  >
                    <M3eIcon name="add_location_alt" />
                  </M3eIconButton>
                  <span className="small muted">
                    {draft
                      ? draft.rect || draft.range
                        ? "範囲を指定済み"
                        : "ピンを指定済み"
                      : selecting
                        ? artifact?.type === "document"
                          ? "本文をドラッグして範囲を指定"
                          : "ビューア上でドラッグ（範囲）またはクリック（ピン）"
                        : "位置指定なし"}
                  </span>
                  {draft ? (
                    <M3eButton variant="text" onClick={() => setDraft(null)}>
                      解除
                    </M3eButton>
                  ) : null}
                </div>
                <div className="row">
                  <Select
                    aria-label="種別"
                    value={compose.kind}
                    onChange={(e) => setCompose((c) => ({ ...c, kind: e.target.value }))}
                  >
                    {Object.entries(kindLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label="重大度"
                    value={compose.severity}
                    onChange={(e) => setCompose((c) => ({ ...c, severity: e.target.value }))}
                  >
                    {Object.entries(severityLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </div>
                <TextArea
                  aria-label="指摘本文"
                  value={compose.body}
                  onChange={(e) => setCompose((c) => ({ ...c, body: e.target.value }))}
                  placeholder="指摘・質問・議論。投稿しても「確認完了」や「解決済み」には自動でなりません。"
                />
                <div className="row">
                  <span className="spacer" />
                  <M3eButton
                    variant="filled"
                    disabled={doPost.pending || !compose.body.trim()}
                    onClick={() => void doPost.run()}
                  >
                    <M3eIcon slot="icon" name="send" />
                    投稿
                  </M3eButton>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      <M3eDialog open={voidDraft !== null} onClosed={() => setVoidDraft(null)} closeLabel="閉じる">
        <span slot="header">誤提出した版を無効化</span>
        <div className="dialog-body">
          <p className="small muted" style={{ margin: 0 }}>
            この版（{revision.label}
            ）の受付を終了し「無効」にします。添付と指摘は履歴として残り、版番号は欠番になります（次の版は第
            {revision.kind === "standard" ? revision.sequence + 1 : 1}
            版）。校了済みや受付終了後の版は無効化できません。
          </p>
          <Field label="理由" required>
            <TextArea
              required
              value={voidDraft ?? ""}
              onChange={(e) => setVoidDraft(e.target.value)}
              placeholder="例: 別の制作物のファイルを提出した"
            />
          </Field>
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setVoidDraft(null)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doVoid.pending || !voidDraft?.trim()}
            onClick={() => void doVoid.run()}
          >
            無効化する
          </M3eButton>
        </div>
      </M3eDialog>
    </>
  );
}

function ThreadEvents({ threadId, active }: { threadId: string; active: boolean }) {
  const data = useQuery(
    api.comments.events,
    active ? { threadId: threadId as Id<"commentThreads"> } : "skip",
  );
  if (!active || !data) return null;
  const rest = data.events.filter((e) => e.eventType !== "created");
  if (rest.length === 0) return null;
  return (
    <ul className="small muted" style={{ margin: 0, paddingLeft: 16 }}>
      {rest.map((e, i) => (
        <li key={i}>
          {e.eventType === "decided" ? (
            <>
              判断:{" "}
              {resolutionLabel[String((e.payload as { to?: string } | undefined)?.to ?? "")] ?? "—"}
              {e.reason ? `（理由: ${e.reason}）` : ""}
            </>
          ) : e.eventType === "replied" ? (
            <>返信: {(e.payload as { body?: string } | undefined)?.body}</>
          ) : e.eventType === "assigned" ? (
            <>
              対応担当を
              {(e.payload as { assigneeId?: string | null } | undefined)?.assigneeId
                ? "指定"
                : "解除"}
            </>
          ) : e.eventType === "edited" ? (
            <>
              本文を訂正（原文: {(e.payload as { previousBody?: string } | undefined)?.previousBody}
              ）
            </>
          ) : e.eventType === "carried_forward" ? (
            <>次版へ持ち越し</>
          ) : (
            e.eventType
          )}
          {" — "}
          {e.actor?.name}・{formatJstShort(e.createdAt)}
        </li>
      ))}
    </ul>
  );
}
