import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  checkTypeLabels,
  checkTypes,
  textRangeAnchor,
  toViewportRect,
  type Anchor,
  type CheckType,
  type NormalizedRect,
  type Viewport,
} from "@mf100/domain";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlignedGutter, type GutterItem } from "@/features/annotation/AlignedGutter";
import type { OverlayThread } from "@/features/annotation/AnchorOverlay";
import { ImageViewer } from "@/features/annotation/ImageViewer";
import { PdfViewer, anchorPage } from "@/features/annotation/PdfViewer";
import { TextViewer } from "@/features/annotation/TextViewer";
import { useArtifactBlob } from "@/features/annotation/useArtifactBlob";
import { ComposePopover } from "@/features/review/ComposePopover";
import { ThreadCard, isClosed, type Thread } from "@/features/review/ThreadCard";
import { formatJstDate, formatJstShort, remaining } from "@/lib/format";
import {
  blockedReasonLabel,
  checkStateLabel,
  closedReasonLabel,
  resolutionLabel,
  reviewStateLabel,
} from "@/lib/labels";
import { newRequestId, useAction } from "@/lib/useAction";
import { StatusText } from "@/ui/Chip";
import { Field, Select, TextArea } from "@/ui/Field";
import {
  M3eBottomSheet,
  M3eButton,
  M3eDialog,
  M3eFilterChip,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
  M3eToolbar,
} from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";

export const Route = createFileRoute("/_app/revisions/$revisionId")({ component: Workspace });

type Layout = "panel" | "aligned" | "pins";
const LAYOUT_KEY = "mf100.workspace.layout";
const layouts: Array<{ id: Layout; icon: string; label: string }> = [
  { id: "panel", icon: "view_sidebar", label: "横に一覧" },
  { id: "aligned", icon: "view_agenda", label: "ピンの高さに並べる" },
  { id: "pins", icon: "location_on", label: "ピンだけ" },
];
function readLayout(): Layout {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === "panel" || v === "aligned" || v === "pins") return v;
  } catch {}
  return "panel";
}

type Draft = {
  page?: number;
  rect?: NormalizedRect;
  point?: { x: number; y: number };
  range?: { start: number; end: number };
  box?: { x: number; y: number; w: number; h: number };
  /** 位置なしのコメント（ツールバーから） */
  free?: boolean;
};

const COMPOSE_W = 300;

function anchorTop(anchor: Anchor, vp: Viewport): number | null {
  if (anchor.type === "pdf_rect" || anchor.type === "image_rect")
    return toViewportRect(anchor.rect, vp).y;
  if (anchor.type === "pdf_pin" || anchor.type === "image_pin")
    return toViewportRect({ x: anchor.point.x, y: anchor.point.y, w: 0.0001, h: 0.0001 }, vp).y;
  return null;
}
function anchorBox(
  anchor: Anchor,
  vp: Viewport,
): { x: number; y: number; w: number; h: number } | null {
  if (anchor.type === "pdf_rect" || anchor.type === "image_rect")
    return toViewportRect(anchor.rect, vp);
  if (anchor.type === "pdf_pin" || anchor.type === "image_pin")
    return {
      ...toViewportRect({ x: anchor.point.x, y: anchor.point.y, w: 0.0001, h: 0.0001 }, vp),
      w: 0,
      h: 0,
    };
  return null;
}
/** 範囲・ピンの右に吹き出しを置く。右に入らなければ左、左にも入らなければ下（範囲を隠さない）。 */
function popoverPos(box: { x: number; y: number; w: number; h: number }, vp: Viewport) {
  const right = box.x + box.w + 10;
  if (right + COMPOSE_W <= vp.width) return { x: right, y: box.y };
  const left = box.x - COMPOSE_W - 10;
  if (left >= 0) return { x: left, y: box.y };
  return { x: Math.max(0, Math.min(box.x, vp.width - COMPOSE_W)), y: box.y + box.h + 10 };
}

function useMedia(query: string) {
  const [m, setM] = useState(() =>
    typeof window === "undefined" ? false : matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

/**
 * U-05 校正ワークスペース + U-06 指摘対応。
 * ビューアの上でドラッグ（範囲）かクリック（ピン）するとその場に投稿欄が出る。
 * コメントの見せ方は 3 つから選べる: 横に一覧（パネル）／ピンの高さに並べる（Google ドキュメント式）／ピンだけ（Figma 式）。
 * ページ送り・倍率・レイアウト・版比較は画面下のフローティングツールバー（M3E toolbar）。
 */
function Workspace() {
  const { revisionId } = Route.useParams();
  const data = useQuery(api.revisions.get, { revisionId });
  const me = useQuery(api.me.me, {});
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

  const mobile = useMedia("(max-width: 960px)");
  const [layoutPref, setLayoutPref] = useState<Layout>(readLayout);
  const layout: Layout = mobile ? "panel" : layoutPref;
  const setLayout = (l: Layout) => {
    setLayoutPref(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {}
  };
  const [panelOpen, setPanelOpen] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const [waiveDraft, setWaiveDraft] = useState<{ checkId: string; reason: string } | null>(null);
  const [addCheckDraft, setAddCheckDraft] = useState<{ type: string; assignee: string[] } | null>(
    null,
  );
  const [voidDraft, setVoidDraft] = useState<string | null>(null);
  const [externalNote, setExternalNote] = useState("");
  const [now, setNow] = useState(Date.now());
  const sheetRef = useRef<HTMLElement | null>(null);

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
  // ボトムシート（狭い画面）: detents は属性でしか渡せないので ref で設定し、show(1)（半分の高さ）で開く
  useEffect(() => {
    const el = sheetRef.current as (HTMLElement & { show?: (detent?: number) => void }) | null;
    if (!el) return;
    el.setAttribute("detents", "fit half full");
    const id = requestAnimationFrame(() => el.show?.(1));
    return () => cancelAnimationFrame(id);
  }, [mobile, data === undefined]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft(null);
        setBody("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const artifact = data?.artifacts.find((a) => a.id === artifactId) ?? null;
  const blob = useArtifactBlob(artifact && artifact.role !== "external" ? artifact.id : null);
  // 文章添付は版スナップショットとして UTF-8 テキストに復号して保持する（F-12）
  const [text, setText] = useState<{ artifactId: string; body: string } | null>(null);
  useEffect(() => {
    if (!artifact || artifact.type !== "document" || !blob.blob) return;
    let cancelled = false;
    void blob.blob.text().then((t) => {
      if (!cancelled) setText({ artifactId: artifact.id, body: t });
    });
    return () => {
      cancelled = true;
    };
  }, [artifact?.id, artifact?.type, blob.blob]);
  const carryCandidates = useQuery(
    api.comments.carryCandidates,
    data?.can.carryForward ? { revisionId: revisionId as Id<"revisions"> } : "skip",
  );
  // 版比較: 同じ制作物の他の版
  const siblings = useQuery(api.works.get, data ? { workId: data.work.id } : "skip");
  const others = (siblings?.revisions ?? []).filter(
    (r) => r.id !== revisionId && r.reviewState !== "void",
  );
  const other = useQuery(api.revisions.get, compareWith ? { revisionId: compareWith } : "skip");
  const otherArtifact =
    other?.artifacts.find((a) => a.role !== "external" && a.fileName === artifact?.fileName) ??
    other?.artifacts.find((a) => a.role !== "external" && a.type === artifact?.type) ??
    other?.artifacts.find((a) => a.role !== "external") ??
    null;
  const otherBlob = useArtifactBlob(compareWith && otherArtifact ? otherArtifact.id : null);

  const resetCompose = () => {
    setDraft(null);
    setBody("");
  };
  const doPost = useAction(async () => {
    if (!data || !draft) return;
    let anchor: Anchor | undefined;
    if (artifact && !draft.free) {
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
    // 投稿者は分類しない。内部では「修正提案・重要」で保存し、未解決が残れば理由なしの校了を拒否する（安全側）
    await post({
      revisionId: revisionId as Id<"revisions">,
      body,
      kind: "correction",
      severity: "major",
      requestId,
      ...(anchor ? { anchor } : {}),
    });
    resetCompose();
    setRequestId(newRequestId());
  });
  const doDecide = useAction(async (threadId: string, action: string, reason: string) => {
    await decide({
      threadId: threadId as Id<"commentThreads">,
      action: action as "accepted",
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  });
  const doReply = useAction(async (threadId: string, b: string) => {
    await reply({ threadId: threadId as Id<"commentThreads">, body: b });
  });
  const doAssignThread = useAction(async (threadId: string, ids: string[]) => {
    await assignThread({ threadId: threadId as Id<"commentThreads">, assigneeId: ids[0] ?? null });
  });
  const doEditThread = useAction(async (threadId: string, b: string) => {
    await editThread({ threadId: threadId as Id<"commentThreads">, body: b });
  });
  const doComplete = useAction(async () => {
    await complete({ revisionId: revisionId as Id<"revisions"> });
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

  const allThreads = useMemo(
    () => (data ? data.threads.map((t, i) => ({ ...t, index: i + 1 })) : []),
    [data],
  );
  const threads = useMemo(
    () => allThreads.filter((t) => showResolved || !isClosed(t) || t.id === activeThreadId),
    [allThreads, showResolved, activeThreadId],
  );

  if (data === undefined) return <p className="muted">読み込み中…</p>;
  const { revision, work, can, myAssignment, checks } = data;
  const pendingChecks = checks.filter((c) => c.state === "pending").length;
  const resolvedCount = allThreads.filter(isClosed).length;
  const openCount = allThreads.length - resolvedCount;
  const overlayThreads: OverlayThread[] = threads
    .map((t) => ({ id: t.id, anchor: t.anchor as Anchor, severity: t.severity, index: t.index }))
    .filter((t) => t.anchor);
  const open = revision.reviewState === "open" && now < revision.deadlineAt;
  const selecting = can.comment && !compareWith;
  const busy =
    doPost.pending ||
    doDecide.pending ||
    doReply.pending ||
    doAssignThread.pending ||
    doEditThread.pending;

  const jumpTo = (t: Thread) => {
    setActiveThreadId(t.id);
    if (t.anchor) {
      if (t.anchor.artifactId !== artifactId) setArtifactId(t.anchor.artifactId);
      const p = anchorPage(t.anchor as Anchor);
      if (p) setPage(p);
    }
  };
  const card = (t: Thread & { index: number }, className?: string) => (
    <ThreadCard
      key={t.id}
      thread={t}
      active={t.id === activeThreadId}
      meId={me?.id ?? null}
      canDecide={can.decide}
      canReply={can.comment || can.decide}
      canEdit={work.lifecycle !== "finalized"}
      pending={busy}
      {...(className ? { className } : {})}
      onSelect={() => jumpTo(t)}
      onResolve={() => doDecide.run(t.id, "resolved", "")}
      onDecide={(a, r) => doDecide.run(t.id, a, r)}
      onReply={(b) => doReply.run(t.id, b)}
      onAssign={(ids) => doAssignThread.run(t.id, ids)}
      onEdit={(b) => doEditThread.run(t.id, b)}
    />
  );

  /** 投稿欄（ビューアの上）: 範囲・ピン・選択文字列のそば、位置なしは右上 */
  const compose = (vp: Viewport | null, box: Draft["box"] | null) => {
    if (!draft || !can.comment) return null;
    let pos = { x: 8, y: 8 };
    if (draft.free && vp) pos = { x: Math.max(8, vp.width - COMPOSE_W - 8), y: 8 };
    else if (vp && (draft.rect || draft.point)) {
      const b = draft.rect
        ? toViewportRect(draft.rect, vp)
        : {
            ...toViewportRect({ x: draft.point!.x, y: draft.point!.y, w: 0.0001, h: 0.0001 }, vp),
            w: 0,
            h: 0,
          };
      pos = popoverPos(b, vp);
    } else if (box) pos = { x: Math.max(0, box.x), y: box.y + box.h + 6 };
    return (
      <ComposePopover
        x={pos.x}
        y={pos.y}
        value={body}
        onChange={setBody}
        onSubmit={() => void doPost.run()}
        onCancel={resetCompose}
        pending={doPost.pending}
      />
    );
  };
  /** ピンだけのレイアウト: 選択中のスレッドをピンの横に出す */
  const popoverCard = (vp: Viewport) => {
    if (layout !== "pins" || !activeThreadId) return null;
    const t = threads.find((x) => x.id === activeThreadId);
    if (!t?.anchor) return null;
    const a = t.anchor as Anchor;
    if (anchorPage(a) && anchorPage(a) !== page) return null;
    if (a.artifactId !== artifactId) return null;
    const b = anchorBox(a, vp);
    if (!b) return null;
    const pos = popoverPos(b, vp);
    return (
      <div className="thread-pop" style={{ left: pos.x, top: pos.y }}>
        {card(t)}
      </div>
    );
  };
  const inPage = (vp: Viewport) => (
    <>
      {popoverCard(vp)}
      {compose(vp, null)}
    </>
  );
  /** Google ドキュメント式: 現在のページ・添付に位置があるものはその高さ、それ以外はページの下 */
  const gutter = (vp: Viewport) => {
    if (layout !== "aligned") return null;
    const items: GutterItem[] = threads.map((t) => {
      const a = t.anchor as Anchor | null;
      const here =
        a && a.artifactId === artifactId && (anchorPage(a) === null || anchorPage(a) === page);
      return { id: t.id, y: here ? anchorTop(a, vp) : null, node: card(t) };
    });
    return <AlignedGutter items={items} minHeight={vp.height} activeId={activeThreadId} />;
  };
  const textGutter = (positions: Map<string, number>, height: number) => {
    if (layout !== "aligned") return null;
    const items: GutterItem[] = threads.map((t) => ({
      id: t.id,
      y: positions.get(t.id) ?? null,
      node: card(t),
    }));
    return <AlignedGutter items={items} minHeight={height} activeId={activeThreadId} />;
  };

  const viewerProps = {
    threads: overlayThreads,
    activeThreadId,
    onSelectThread: (id: string) => {
      const t = threads.find((x) => x.id === id);
      if (t) jumpTo(t);
    },
    selecting,
  };
  const renderViewer = (): ReactNode => {
    if (!artifact) return <div className="empty">添付がありません</div>;
    if (artifact.role === "external")
      return (
        <div className="external">
          <a href={artifact.externalUrl ?? "#"} target="_blank" rel="noreferrer noopener">
            <M3eIcon name="open_in_new" style={{ fontSize: 16, verticalAlign: "middle" }} />{" "}
            {artifact.externalUrl}
          </a>
          <p className="muted small">
            外部ツール上のコメントは同期されません。結論はここに記録してください。
          </p>
          {can.comment ? (
            <>
              <Field label="外部での議論結果（合意事項として記録）">
                <TextArea value={externalNote} onChange={(e) => setExternalNote(e.target.value)} />
              </Field>
              <div className="row">
                <span className="spacer" />
                <M3eButton
                  variant="tonal"
                  disabled={doRecordExternal.pending || !externalNote.trim()}
                  onClick={() => void doRecordExternal.run()}
                >
                  記録
                </M3eButton>
              </div>
            </>
          ) : null}
        </div>
      );
    if (blob.error) return <div className="alert">{blob.error}</div>;
    if (!blob.blob) return <div className="empty">ファイルを取得中…</div>;
    if (artifact.type === "pdf")
      return (
        <PdfViewer
          blob={blob.blob}
          artifactId={artifact.id}
          {...viewerProps}
          draft={draft?.page ? (draft as Draft & { page: number }) : null}
          onDraft={(d) => {
            setDraft(d);
            setActiveThreadId(null);
          }}
          page={page}
          scale={scale}
          rotation={rotation}
          onPageCount={setPageCount}
          renderInPage={inPage}
          renderGutter={gutter}
        />
      );
    if (artifact.type === "document" && text?.artifactId === artifact.id)
      return (
        <TextViewer
          text={text.body}
          artifactId={artifact.id}
          {...viewerProps}
          draft={draft?.range ? { ...draft.range, ...(draft.box ? { box: draft.box } : {}) } : null}
          onDraft={(r) => {
            setDraft(
              r
                ? { range: { start: r.start, end: r.end }, ...(r.box ? { box: r.box } : {}) }
                : null,
            );
            setActiveThreadId(null);
          }}
          inPage={compose(null, draft?.box ?? null)}
          renderGutter={textGutter}
        />
      );
    if (artifact.type === "image" && blob.url)
      return (
        <ImageViewer
          url={blob.url}
          artifactId={artifact.id}
          {...viewerProps}
          draft={draft?.rect || draft?.point ? draft : null}
          onDraft={(d) => {
            setDraft(d);
            setActiveThreadId(null);
          }}
          scale={scale}
          renderInPage={inPage}
          renderGutter={gutter}
        />
      );
    return (
      <div className="empty">
        この形式はブラウザ内でプレビューできません。
        {blob.url ? (
          <a href={blob.url} download={artifact.fileName}>
            ダウンロード
          </a>
        ) : null}
      </div>
    );
  };
  const renderOther = (): ReactNode => {
    if (!compareWith) return null;
    if (!other || !otherArtifact) return <div className="empty">比較する添付がありません</div>;
    if (!otherBlob.blob) return <div className="empty">ファイルを取得中…</div>;
    const none = {
      threads: [],
      activeThreadId: null,
      onSelectThread: () => undefined,
      selecting: false,
    };
    if (otherArtifact.type === "pdf")
      return (
        <PdfViewer
          blob={otherBlob.blob}
          artifactId={otherArtifact.id}
          {...none}
          draft={null}
          onDraft={() => undefined}
          page={page}
          scale={scale}
          rotation={rotation}
        />
      );
    if (otherArtifact.type === "image" && otherBlob.url)
      return (
        <ImageViewer
          url={otherBlob.url}
          artifactId={otherArtifact.id}
          {...none}
          draft={null}
          onDraft={() => undefined}
          scale={scale}
        />
      );
    return <div className="empty">この形式は比較できません</div>;
  };

  const isPdf = artifact?.type === "pdf";
  const isImage = artifact?.type === "image";
  const panelVisible = layout === "panel" && panelOpen;

  const panel = (
    <aside className="comments" aria-label="コメント">
      <div className="comments__header">
        <strong>コメント {openCount}</strong>
        {resolvedCount > 0 ? (
          <M3eFilterChip selected={showResolved} onClick={() => setShowResolved((v) => !v)}>
            解決済み {resolvedCount}
          </M3eFilterChip>
        ) : null}
        <span className="spacer" />
        {!mobile ? (
          <M3eIconButton aria-label="パネルを閉じる" onClick={() => setPanelOpen(false)}>
            <M3eIcon name="right_panel_close" />
          </M3eIconButton>
        ) : null}
      </div>
      <div className="comments__list">
        {carryCandidates && carryCandidates.length > 0 ? (
          <div className="carry-box" aria-label="前版の未解決指摘">
            <div className="label-large">前版の未解決指摘 {carryCandidates.length}</div>
            {carryCandidates.map((c) => (
              <div key={c.id} className="carry">
                <div className="small muted">
                  {c.revisionLabel}・{resolutionLabel[c.resolution]}・{c.author?.name}
                </div>
                <div className="thread__body">{c.body}</div>
                <div className="row">
                  <span className="spacer" />
                  <M3eButton
                    variant="text"
                    disabled={doCarry.pending}
                    onClick={() => void doCarry.run(c.id)}
                  >
                    この版へ引き継ぐ
                  </M3eButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {threads.length === 0 ? (
          <p className="muted small comments__empty">
            {can.comment
              ? "ファイルの上でドラッグすると、その場にコメントできます。"
              : "コメントはありません。"}
          </p>
        ) : (
          threads.map((t) => card(t))
        )}
      </div>
      {!can.comment ? (
        <div className="comments__blocked small muted">
          {blockedReasonLabel[data.commentBlockedReason ?? "forbidden"]}
        </div>
      ) : null}
    </aside>
  );

  return (
    <div className={`ws ws--${layout} ${compareWith ? "ws--compare" : ""}`}>
      <header className="ws__header">
        <Link
          to="/works/$workId"
          params={{ workId: work.id }}
          className="ws__back"
          aria-label="制作物へ戻る"
        >
          <M3eIcon name="arrow_back" />
        </Link>
        <div className="ws__title">
          <span className="ws__work">{work.title}</span>
          <span className="ws__rev">{revision.label}</span>
          <span className="ws__state">
            {open ? (
              <>受付中・{remaining(revision.deadlineAt, now)}</>
            ) : revision.reviewClosedReason ? (
              `受付終了（${closedReasonLabel[revision.reviewClosedReason]}）`
            ) : (
              reviewStateLabel[revision.reviewState]
            )}
            {work.finalRevisionId === revision.id ? (
              <StatusText tone="success" className="ml">
                校了版
              </StatusText>
            ) : null}
          </span>
          {revision.focusNotes ? (
            <span className="ws__focus muted">見てほしい観点: {revision.focusNotes}</span>
          ) : null}
        </div>
        <span className="spacer" />
        {data.artifacts.length > 1 ? (
          <Select
            aria-label="添付"
            value={artifactId ?? ""}
            onChange={(e) => {
              setArtifactId(e.target.value);
              setPage(1);
              resetCompose();
            }}
            className="ws__artifact"
          >
            {data.artifacts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.role === "external" ? "外部: " : ""}
                {a.fileName}
              </option>
            ))}
          </Select>
        ) : null}
        {can.completeReview ? (
          <M3eButton
            variant="tonal"
            disabled={doComplete.pending}
            onClick={() => void doComplete.run()}
          >
            確認を完了
          </M3eButton>
        ) : myAssignment?.state === "responded" ? (
          <StatusText tone="success">確認完了</StatusText>
        ) : null}
        {can.void || can.addCheck ? (
          <>
            <M3eIconButton aria-label="その他の操作">
              <M3eIcon name="more_vert" />
              <M3eMenuTrigger htmlFor="ws-menu" />
            </M3eIconButton>
          </>
        ) : null}
      </header>
      {can.void || can.addCheck ? (
        <M3eMenu id="ws-menu" positionX="before">
          {can.addCheck ? (
            <M3eMenuItem onClick={() => setAddCheckDraft({ type: "photo", assignee: [] })}>
              専門確認を追加
            </M3eMenuItem>
          ) : null}
          {can.void ? (
            <M3eMenuItem onClick={() => setVoidDraft("")}>誤提出を無効化</M3eMenuItem>
          ) : null}
        </M3eMenu>
      ) : null}

      {checks.length > 0 || addCheckDraft ? (
        <details
          className="details ws__checks"
          open={pendingChecks > 0 || !!addCheckDraft}
          aria-label="専門確認"
        >
          <summary>
            専門確認{" "}
            <StatusText tone={pendingChecks > 0 ? "warning" : "success"}>
              {pendingChecks > 0 ? `未完了 ${pendingChecks}` : "すべて完了"}
            </StatusText>
          </summary>
          <div className="checks">
            {checks.map((c) => (
              <div key={c.id} className={`check ${c.state !== "pending" ? "check--done" : ""}`}>
                <StatusText
                  tone={
                    c.state === "done" ? "success" : c.state === "waived" ? "neutral" : "warning"
                  }
                >
                  {checkStateLabel[c.state]}
                </StatusText>
                <div>
                  {c.label}
                  <span className="small muted">
                    　{c.assignee?.name ?? "担当未指定"}
                    {c.doneByUser
                      ? `・${c.state === "waived" ? "免除" : "確認"} ${c.doneByUser.name} ${formatJstShort(c.doneAt ?? 0)}`
                      : ""}
                    {c.note ? `・${c.note}` : ""}
                  </span>
                </div>
                <div className="row">
                  {c.canComplete ? (
                    <M3eButton
                      variant="tonal"
                      disabled={doCompleteCheck.pending}
                      onClick={() => void doCompleteCheck.run(c.id)}
                    >
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
          {waiveDraft ? (
            <div className="stack" style={{ marginTop: 8 }}>
              <Field label="免除の理由（必須・監査に残ります）" required>
                <TextArea
                  value={waiveDraft.reason}
                  onChange={(e) => setWaiveDraft({ ...waiveDraft, reason: e.target.value })}
                />
              </Field>
              <div className="row">
                <span className="spacer" />
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
                <span className="spacer" />
                <M3eButton variant="text" onClick={() => setAddCheckDraft(null)}>
                  取消
                </M3eButton>
                <M3eButton
                  variant="filled"
                  disabled={doAddCheck.pending}
                  onClick={() => void doAddCheck.run()}
                >
                  追加
                </M3eButton>
              </div>
            </div>
          ) : null}
        </details>
      ) : null}

      <div className={`ws__body ${panelVisible && !mobile ? "ws__body--panel" : ""}`}>
        <div className="ws__viewer">
          {compareWith ? (
            <div className="compare">
              <div className="compare__pane">
                <div className="compare__label">{other?.revision.label ?? "…"}</div>
                {renderOther()}
              </div>
              <div className="compare__pane">
                <div className="compare__label">{revision.label}</div>
                {renderViewer()}
              </div>
            </div>
          ) : (
            renderViewer()
          )}

          {artifact && artifact.role !== "external" ? (
            <M3eToolbar
              className="ws__toolbar"
              shape="rounded"
              elevated
              aria-label="ビューアの操作"
            >
              {isPdf ? (
                <>
                  <M3eIconButton
                    aria-label="前のページ"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <M3eIcon name="chevron_left" />
                  </M3eIconButton>
                  <span className="ws__toolbar-text">
                    {pageCount ? `${page} / ${pageCount}` : "…"}
                  </span>
                  <M3eIconButton
                    aria-label="次のページ"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    <M3eIcon name="chevron_right" />
                  </M3eIconButton>
                </>
              ) : null}
              {isPdf || isImage ? (
                <>
                  <M3eIconButton
                    aria-label="縮小"
                    onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2)))}
                  >
                    <M3eIcon name="zoom_out" />
                  </M3eIconButton>
                  <span className="ws__toolbar-text">{Math.round(scale * 100)}%</span>
                  <M3eIconButton
                    aria-label="拡大"
                    onClick={() => setScale((s) => Math.min(4, +(s + 0.2).toFixed(2)))}
                  >
                    <M3eIcon name="zoom_in" />
                  </M3eIconButton>
                </>
              ) : null}
              {isPdf ? (
                <M3eIconButton
                  aria-label="右に回転"
                  onClick={() => setRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270)}
                >
                  <M3eIcon name="rotate_right" />
                </M3eIconButton>
              ) : null}
              {can.comment ? (
                <M3eIconButton
                  aria-label="位置なしでコメント"
                  onClick={() => {
                    setDraft({ free: true });
                    setActiveThreadId(null);
                  }}
                >
                  <M3eIcon name="add_comment" />
                </M3eIconButton>
              ) : null}
              {others.length > 0 ? (
                <M3eIconButton
                  aria-label="版を比較"
                  toggle
                  selected={!!compareWith}
                  className={compareWith ? "icon--filled" : ""}
                >
                  <M3eIcon name="compare" />
                  <M3eMenuTrigger htmlFor="compare-menu" />
                </M3eIconButton>
              ) : null}
              {!mobile ? (
                <>
                  <span className="ws__toolbar-sep" />
                  {layouts.map((l) => (
                    <M3eIconButton
                      key={l.id}
                      aria-label={l.label}
                      toggle
                      selected={layout === l.id}
                      onClick={() => {
                        setLayout(l.id);
                        if (l.id === "panel") setPanelOpen(true);
                      }}
                    >
                      <M3eIcon name={l.icon} className={layout === l.id ? "icon--filled" : ""} />
                    </M3eIconButton>
                  ))}
                  {layout === "panel" && !panelOpen ? (
                    <M3eIconButton
                      aria-label={`コメントを開く（${openCount}）`}
                      onClick={() => setPanelOpen(true)}
                    >
                      <M3eIcon name="comment" />
                    </M3eIconButton>
                  ) : null}
                </>
              ) : null}
            </M3eToolbar>
          ) : null}
        </div>
        {panelVisible && !mobile ? panel : null}
      </div>
      {mobile ? (
        <M3eBottomSheet ref={sheetRef as never} handle handleLabel="コメント" className="ws__sheet">
          {panel}
        </M3eBottomSheet>
      ) : null}

      {others.length > 0 ? (
        <M3eMenu id="compare-menu">
          {others.map((r) => (
            <M3eMenuItem
              key={r.id}
              onClick={() => {
                setCompareWith(r.id);
                setScale(0.7); // 2 枚並べるので縮める
              }}
            >
              {r.label}
              <span className="muted">　{formatJstDate(r.submittedAt)}</span>
            </M3eMenuItem>
          ))}
          {compareWith ? (
            <M3eMenuItem onClick={() => setCompareWith(null)}>比較を終了</M3eMenuItem>
          ) : null}
        </M3eMenu>
      ) : null}

      <M3eDialog open={voidDraft !== null} onClosed={() => setVoidDraft(null)} closeLabel="閉じる">
        <span slot="header">誤提出した版を無効化</span>
        <div className="dialog-body">
          <p className="small muted" style={{ margin: 0 }}>
            {revision.label}
            の受付を終了して「無効」にします。添付と指摘は履歴に残り、版番号は欠番になります。
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
    </div>
  );
}
