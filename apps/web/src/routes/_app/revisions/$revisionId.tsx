import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import type { Anchor, NormalizedRect } from "@mf100/domain";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { ImageViewer } from "@/features/annotation/ImageViewer";
import { PdfViewer, anchorPage } from "@/features/annotation/PdfViewer";
import { useArtifactBlob } from "@/features/annotation/useArtifactBlob";
import type { OverlayThread } from "@/features/annotation/AnchorOverlay";
import { formatJst, formatJstShort, remaining } from "@/lib/format";
import {
  assignmentLabel,
  blockedReasonLabel,
  closedReasonLabel,
  kindLabel,
  resolutionLabel,
  reviewStateLabel,
  severityLabel,
} from "@/lib/labels";
import { newRequestId, useAction } from "@/lib/useAction";
import { Field, Select, TextArea } from "@/ui/Field";
import { M3eButton, M3eFilterChip, M3eFilterChipSet, M3eIcon, M3eIconButton } from "@/ui/m3e";

export const Route = createFileRoute("/_app/revisions/$revisionId")({ component: Workspace });

type Draft = { page?: number; rect?: NormalizedRect; point?: { x: number; y: number } };

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
  const me = useQuery(api.me.me, {});

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
  const { revision, work, can, assignments, myAssignment } = data;
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
      <h1 className="page-title" style={{ fontSize: 18 }}>
        <Link to="/works/$workId" params={{ workId: work.id }}>
          {work.title}
        </Link>
        <span className="chip chip--primary">{revision.label}</span>
        <span className={`chip ${open ? "chip--ok" : "chip--error"}`}>
          {open
            ? `受付中・${remaining(revision.deadlineAt, now)}`
            : revision.reviewClosedReason
              ? `受付終了（${closedReasonLabel[revision.reviewClosedReason]}）`
              : reviewStateLabel[revision.reviewState]}
        </span>
        <span className="small muted">締切 {formatJst(revision.deadlineAt)}</span>
        {work.finalRevisionId === revision.id ? (
          <span className="chip chip--ok">校了版</span>
        ) : null}
        <span className="spacer" />
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
            <M3eIcon slot="icon">task_alt</M3eIcon>自分の確認を完了
          </M3eButton>
        ) : myAssignment?.state === "responded" ? (
          <span className="chip chip--ok">確認完了</span>
        ) : null}
      </h1>
      {revision.focusNotes ? (
        <div className="alert alert--info" style={{ marginBottom: 12 }}>
          見てほしい観点: {revision.focusNotes}
        </div>
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
            <div className="card stack">
              <h3>外部媒体</h3>
              <a href={artifact.externalUrl ?? "#"} target="_blank" rel="noreferrer noopener">
                {artifact.externalUrl}
              </a>
              <div className="alert alert--warn">
                外部ツール上のコメントはこのシステムに同期されていません。議論の結論・未解決点は右のスレッドに「合意事項」として記録してください（§9.3
                / A-12）。
              </div>
            </div>
          ) : blob.error ? (
            <div className="alert">{blob.error}</div>
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
            <div className="card stack">
              <h3>{artifact.fileName}</h3>
              <p className="muted">この形式はブラウザ内でプレビューできません。</p>
              {blob.url ? (
                <a href={blob.url} download={artifact.fileName}>
                  ダウンロード
                </a>
              ) : null}
            </div>
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
            {threads.length === 0 ? (
              <p className="muted small" style={{ padding: 8 }}>
                表示する指摘はありません。
              </p>
            ) : (
              threads.map((t) => (
                <article
                  key={t.id}
                  className={`thread thread--${t.severity} ${t.id === activeThreadId ? "thread--active" : ""}`}
                  tabIndex={0}
                  onClick={() => jumpTo(t)}
                  onKeyDown={(e) => e.key === "Enter" && jumpTo(t)}
                  aria-label={`指摘 ${t.index}`}
                >
                  <div className="thread__meta">
                    <span className="chip chip--primary">#{t.index}</span>
                    <span className="chip">{kindLabel[t.kind]}</span>
                    <span
                      className={`chip ${t.severity === "critical" ? "chip--error" : t.severity === "major" ? "chip--warn" : ""}`}
                    >
                      {severityLabel[t.severity]}
                    </span>
                    <span
                      className={`chip ${["rejected", "resolved", "deferred"].includes(t.resolution) ? "chip--ok" : ""}`}
                    >
                      {resolutionLabel[t.resolution]}
                    </span>
                    {t.anchor ? (
                      <M3eIcon style={{ fontSize: 16 }} title="位置指定あり">
                        location_on
                      </M3eIcon>
                    ) : null}
                    <span className="spacer" />
                    <span>
                      {t.author?.name}・{formatJstShort(t.createdAt)}
                    </span>
                  </div>
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
                    <M3eIcon>add_location_alt</M3eIcon>
                  </M3eIconButton>
                  <span className="small muted">
                    {draft
                      ? draft.rect
                        ? "範囲を指定済み"
                        : "ピンを指定済み"
                      : selecting
                        ? "ビューア上でドラッグ（範囲）またはクリック（ピン）"
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
                    <M3eIcon slot="icon">send</M3eIcon>投稿
                  </M3eButton>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
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
