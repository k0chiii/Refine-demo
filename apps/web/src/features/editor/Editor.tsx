import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  textRangeAnchor,
  toViewportRect,
  type Anchor,
  type NormalizedRect,
  type Viewport,
} from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlignedGutter, type GutterItem } from "@/features/annotation/AlignedGutter";
import type { OverlayThread } from "@/features/annotation/AnchorOverlay";
import { ImageViewer } from "@/features/annotation/ImageViewer";
import { PdfViewer, anchorPage } from "@/features/annotation/PdfViewer";
import { TextViewer } from "@/features/annotation/TextViewer";
import { useArtifactBlob } from "@/features/annotation/useArtifactBlob";
import { ComposePopover } from "@/features/review/ComposePopover";
import { ThreadCard, isClosed, type Thread } from "@/features/review/ThreadCard";
import { SubmitDialog } from "@/features/upload/SubmitDialog";
import { PaneHandle } from "@/features/editor/PaneHandle";
import { remaining } from "@/lib/format";
import {
  blockedReasonLabel,
  closedReasonLabel,
  resolutionLabel,
  reviewStateLabel,
} from "@/lib/labels";
import { newRequestId, useAction } from "@/lib/useAction";
import { useMedia, useWindowClass } from "@/lib/useMedia";
import { ActionSheet } from "@/ui/ActionSheet";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Field, TextArea } from "@/ui/Field";
import {
  M3eBottomSheet,
  M3eButton,
  M3eFilterChip,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
  M3eToolbar,
} from "@/ui/m3e";
import { InfoTab } from "./InfoTab";
import { VersionsTab } from "./VersionsTab";

export type Drawer = "comments" | "versions" | "info";
export type EditorSearch = { tab?: Drawer };
export function validateEditorSearch(s: Record<string, unknown>): EditorSearch {
  return s.tab === "comments" || s.tab === "versions" || s.tab === "info" ? { tab: s.tab } : {};
}

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
const versionOf = (r: { kind: string; sequence: number }) => (r.kind === "rough" ? 0 : r.sequence);

/**
 * エディタ（U-03 + U-05 + U-06）。制作物に関することはここで全部終わる。
 * 中央はビューア（PDF / 画像 / 文章）。ドラッグ・クリック・文字列選択で、その場に投稿欄が出る。
 * 右の引き出しは コメント／版／情報。コメントの見せ方は 横に一覧／ピンの高さに並べる／ピンだけ。
 * ページ送り・倍率・レイアウトは画面下のフローティングツールバー。狭い画面では引き出しがボトムシートになる。
 */
export function Editor({
  workId,
  version,
  search,
}: {
  workId: string;
  /** null = 最新（受付中の版、無ければ最後に提出された版） */
  version: number | null;
  search: EditorSearch;
}) {
  const navigate = useNavigate();
  const workData = useQuery(api.works.get, { workId });
  const me = useQuery(api.me.me, {});
  const revisions = useMemo(
    () => (workData?.revisions ?? []).filter((r) => r.reviewState !== "void"),
    [workData],
  );
  const target = useMemo(() => {
    if (!workData) return null;
    if (version === null)
      return (
        revisions.find((r) => r.id === workData.acceptingRevisionId) ??
        [...revisions].sort((a, b) => b.submittedAt - a.submittedAt)[0] ??
        null
      );
    if (version === 0)
      return (
        revisions.filter((r) => r.kind === "rough").sort((a, b) => b.sequence - a.sequence)[0] ??
        null
      );
    return revisions.find((r) => r.kind === "standard" && r.sequence === version) ?? null;
  }, [workData, revisions, version]);
  const revisionId = target?.id ?? null;
  const dataRaw = useQuery(api.revisions.get, revisionId ? { revisionId } : "skip");
  // 版を切り替えた直後に前の版の結果が残ることがあるので、表示中の版のものだけを使う
  const data = dataRaw && revisionId && dataRaw.revision.id === revisionId ? dataRaw : undefined;

  const markViewed = useMutation(api.revisions.markViewed);
  const post = useMutation(api.comments.post);
  const decide = useMutation(api.comments.decide);
  const reply = useMutation(api.comments.reply);
  const complete = useMutation(api.reviews.complete);
  const assignThread = useMutation(api.comments.assign);
  const editThread = useMutation(api.comments.edit);
  const carryForward = useMutation(api.comments.carryForward);

  // M3 の compact/medium（839 以下）: 補助ペインは置けないので引き出しはボトムシート
  const mobile = useMedia("(max-width: 839px)");
  // compact（<600）: 共通バーは無く、エディタ自身のトップアプリバー。紙面は幅に合わせ、引き出しは覗き見のボトムシート
  const compact = useWindowClass() === "compact";
  const [layoutPref, setLayoutPref] = useState<Layout>(readLayout);
  const layout: Layout = mobile ? "panel" : layoutPref;
  const [drawer, setDrawer] = useState<Drawer | null>(
    search.tab ?? (readLayout() === "panel" ? "comments" : null),
  );
  const [showResolved, setShowResolved] = useState(false);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [artifactSheet, setArtifactSheet] = useState(false);
  // 固定ペイン（引き出し）の幅。supporting pane は temporary resizing: 閉じたら既定（expanded 360 / large 412）に戻す
  const [paneW, setPaneW] = useState<number | null>(null);
  const [lastDrawer, setLastDrawer] = useState<Drawer>("comments");
  const defaultPane = useMedia("(min-width: 1200px)") ? 412 : 360;
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null); // 本体は読み込み後に現れるので callback ref
  const [bodyW, setBodyW] = useState(0);
  useEffect(() => {
    if (!bodyEl) return;
    const ro = new ResizeObserver(() => setBodyW(bodyEl.clientWidth));
    ro.observe(bodyEl);
    return () => ro.disconnect();
  }, [bodyEl]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [externalNote, setExternalNote] = useState("");
  const [now, setNow] = useState(Date.now());
  const sheetRef = useRef<HTMLElement | null>(null);

  const setLayout = (l: Layout) => {
    setLayoutPref(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {}
    if (l === "panel") setDrawer("comments");
    else if (drawer === "comments") setDrawer(null);
  };
  useEffect(() => {
    if (drawer === null) setPaneW(null);
    else setLastDrawer(drawer);
  }, [drawer]);
  const openDrawer = (d: Drawer) => {
    if (drawer === d) setDrawer(null);
    else {
      setDrawer(d);
      if (d === "comments" && layout !== "panel") setLayout("panel");
    }
  };

  useEffect(() => {
    if (search.tab) setDrawer(search.tab);
  }, [search.tab]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (revisionId)
      void markViewed({ revisionId: revisionId as Id<"revisions"> }).catch(() => undefined);
  }, [revisionId]);
  useEffect(() => {
    setArtifactId(null);
    setPage(1);
    setCompareWith(null);
    setDraft(null);
    setActiveThreadId(null);
  }, [revisionId]);
  useEffect(() => {
    if (!data) return;
    if (!artifactId || !data.artifacts.some((a) => a.id === artifactId))
      setArtifactId(
        data.artifacts.find((a) => a.role !== "external")?.id ?? data.artifacts[0]?.id ?? null,
      );
  }, [data, artifactId]);
  // ボトムシート（狭い画面）: detents は属性でしか渡せないので ref で設定する
  useEffect(() => {
    const el = sheetRef.current as (HTMLElement & { show?: (detent?: number) => void }) | null;
    if (!el) return;
    // 覗き見（タブだけ 64px ＝ 8 ＋ 48 ＋ 8）→ 半分 → 全部。最初は覗き見にして紙面を見せる
    el.setAttribute("detents", "64px half full");
    const id = requestAnimationFrame(() => el.show?.(0));
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
    data?.can.carryForward && revisionId ? { revisionId: revisionId as Id<"revisions"> } : "skip",
  );
  // 版比較: 同じ制作物の他の版
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
    if (!data || !draft || !revisionId) return;
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
    if (revisionId) await complete({ revisionId: revisionId as Id<"revisions"> });
  });
  const doCarry = useAction(async (threadId: string) => {
    if (!revisionId) return;
    await carryForward({
      threadId: threadId as Id<"commentThreads">,
      targetRevisionId: revisionId as Id<"revisions">,
    });
  });
  const doRecordExternal = useAction(async () => {
    if (!artifact || !externalNote.trim() || !revisionId) return;
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

  if (workData === undefined) return <p className="muted">読み込み中…</p>;
  const { work } = workData;
  const revision = data?.revision ?? null;
  const can = data?.can ?? null;
  const resolvedCount = allThreads.filter(isClosed).length;
  const openCount = allThreads.length - resolvedCount;
  const overlayThreads: OverlayThread[] = threads
    .map((t) => ({ id: t.id, anchor: t.anchor as Anchor, severity: t.severity, index: t.index }))
    .filter((t) => t.anchor);
  const open = revision ? revision.reviewState === "open" && now < revision.deadlineAt : false;
  const canComment = can?.comment ?? false;
  const selecting = canComment && !compareWith;
  const busy =
    doPost.pending ||
    doDecide.pending ||
    doReply.pending ||
    doAssignThread.pending ||
    doEditThread.pending;
  const goVersion = (r: { kind: string; sequence: number }) =>
    void navigate({ to: "/works/$workId/v/$n", params: { workId, n: String(versionOf(r)) } });

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
      canDecide={can?.decide ?? false}
      canReply={canComment || (can?.decide ?? false)}
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
    if (!draft || !canComment) return null;
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
    if (!target)
      return (
        <div className="empty editor__empty">
          <M3eIcon name="upload_file" />
          まだ版がありません。
          {workData.can.submit && work.lifecycle === "active" ? (
            <M3eButton variant="filled" onClick={() => setSubmitOpen(true)}>
              最初の版を提出
            </M3eButton>
          ) : null}
        </div>
      );
    if (!data) return <div className="empty">読み込み中…</div>;
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
          {canComment ? (
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
          scale={viewScale}
          fitWidth={compact}
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
          scale={viewScale}
          fitWidth={compact}
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
          scale={viewScale}
          fitWidth={compact}
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
          scale={viewScale}
          fitWidth={compact}
        />
      );
    return <div className="empty">この形式は比較できません</div>;
  };

  const isPdf = artifact?.type === "pdf";
  const isImage = artifact?.type === "image";

  const commentsPanel = (
    <div className="comments">
      <div className="comments__header">
        {resolvedCount > 0 ? (
          <M3eFilterChip selected={showResolved} onClick={() => setShowResolved((v) => !v)}>
            解決済み {resolvedCount}
          </M3eFilterChip>
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
        {!target ? (
          <p className="muted small comments__empty">版を提出するとコメントできます。</p>
        ) : threads.length === 0 ? (
          <p className="muted small comments__empty">
            {canComment
              ? "ファイルの上でドラッグすると、その場にコメントできます。"
              : "コメントはありません。"}
          </p>
        ) : (
          threads.map((t) => card(t))
        )}
      </div>
      {target && data && !canComment ? (
        <div className="comments__blocked small muted">
          {blockedReasonLabel[data.commentBlockedReason ?? "forbidden"]}
        </div>
      ) : null}
    </div>
  );
  const drawerTabs = (current: Drawer | null, onPick: (d: Drawer) => void) => (
    <div className="drawer__tabs" role="tablist" aria-label="引き出し">
      {(
        [
          ["comments", "コメント", openCount],
          ["versions", "版", revisions.length],
          ["info", "情報", null],
        ] as Array<[Drawer, string, number | null]>
      ).map(([id, label, n]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={current === id}
          className={`drawer__tab ${current === id ? "drawer__tab--on" : ""}`}
          onClick={() => onPick(id)}
        >
          {label}
          {n !== null && n > 0 ? <span className="drawer__n">{n}</span> : null}
        </button>
      ))}
    </div>
  );
  const drawerBody = (d: Drawer | null) =>
    d === "comments" ? (
      commentsPanel
    ) : d === "versions" ? (
      <VersionsTab
        work={workData}
        currentId={revisionId}
        compareWith={compareWith}
        canVoid={can?.void ?? false}
        onOpen={goVersion}
        onCompare={(id) => {
          setCompareWith(id);
          setScale(id ? 0.7 : 1.2);
        }}
        onSubmit={() => setSubmitOpen(true)}
      />
    ) : d === "info" ? (
      <InfoTab work={workData} revision={data ?? null} isAdmin={me?.isSystemAdmin ?? false} />
    ) : null;
  const desktopDrawer = drawer !== null && !mobile;
  // compact は「幅に合わせた大きさ」が 100%。既定倍率 1.2 を打ち消す
  const viewScale = compact ? scale / 1.2 : scale;
  const sheetTab: Drawer = drawer ?? "comments";

  return (
    <div
      className={`ws ws--${layout} ${compareWith ? "ws--compare" : ""} ${compact ? "ws--compact" : ""}`}
    >
      {/* 見出し・戻る・主要操作は共通アプリバーへ（M3 App bars: ページの見出し＋戻る＋ 1–2 の必須操作。多い操作はツールバーへ） */}
      <AppBarSlot slot="leading">
        <M3eIconButton
          aria-label="制作物一覧へ戻る"
          onClick={() => void navigate({ to: "/works" })}
        >
          <M3eIcon name="arrow_back" className="icon--mirror" />
        </M3eIconButton>
      </AppBarSlot>
      <AppBarSlot slot="title">{work.title}</AppBarSlot>
      {revision ? (
        <AppBarSlot slot="subtitle">
          {revision.label}・
          {open
            ? `受付中・${remaining(revision.deadlineAt, now)}`
            : revision.reviewClosedReason
              ? `受付終了（${closedReasonLabel[revision.reviewClosedReason]}）`
              : reviewStateLabel[revision.reviewState]}
          {work.finalRevisionId === revision.id ? "・校了版" : ""}
        </AppBarSlot>
      ) : null}
      <AppBarSlot slot="actions">
        {can?.completeReview ? (
          <M3eIconButton
            variant="tonal"
            aria-label="確認を完了"
            title="確認を完了"
            disabled={doComplete.pending}
            onClick={() => void doComplete.run()}
          >
            <M3eIcon name="task_alt" />
          </M3eIconButton>
        ) : data?.myAssignment?.state === "responded" ? (
          <span className="ws__done" title="確認完了" aria-label="確認完了">
            <M3eIcon name="check_circle" className="icon--filled" />
          </span>
        ) : null}
      </AppBarSlot>
      {data && data.artifacts.length > 1 && compact ? (
        <ActionSheet
          open={artifactSheet}
          onClose={() => setArtifactSheet(false)}
          title="添付"
          items={data.artifacts.map((a) => ({
            icon: "draft",
            label: `${a.role === "external" ? "外部: " : ""}${a.fileName}`,
            selected: a.id === artifactId,
            onSelect: () => {
              setArtifactId(a.id);
              setPage(1);
              resetCompose();
            },
          }))}
        />
      ) : null}

      <div
        ref={setBodyEl}
        className={`ws__body ${desktopDrawer ? "ws__body--panel" : mobile ? "" : "ws__body--handle"}`}
        style={
          desktopDrawer && paneW !== null
            ? ({ "--ws-pane": `${paneW}px` } as CSSProperties)
            : undefined
        }
      >
        <div className="ws__viewer">
          {compareWith ? (
            <div className="compare">
              <div className="compare__pane">
                <div className="compare__label">{other?.revision.label ?? "…"}</div>
                {renderOther()}
              </div>
              <div className="compare__pane">
                <div className="compare__label">{revision?.label}</div>
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
                  {!compact ? (
                    <span className="ws__toolbar-text">{Math.round(scale * 100)}%</span>
                  ) : null}
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
              {canComment ? (
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
              {compareWith ? (
                <M3eIconButton
                  aria-label="比較を終了"
                  toggle
                  selected
                  onClick={() => {
                    setCompareWith(null);
                    setScale(1.2);
                  }}
                >
                  <M3eIcon name="compare" className="icon--filled" />
                </M3eIconButton>
              ) : null}
              {data && data.artifacts.length > 1 ? (
                <M3eIconButton
                  aria-label="添付を切り替え"
                  {...(compact ? { onClick: () => setArtifactSheet(true) } : {})}
                >
                  <M3eIcon name="attach_file" />
                  {compact ? null : <M3eMenuTrigger htmlFor="artifact-menu" />}
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
                      onClick={() => setLayout(l.id)}
                    >
                      <M3eIcon name={l.icon} className={layout === l.id ? "icon--filled" : ""} />
                    </M3eIconButton>
                  ))}
                </>
              ) : null}
            </M3eToolbar>
          ) : null}
          {data && data.artifacts.length > 1 && !compact ? (
            <M3eMenu id="artifact-menu" positionY="above">
              {data.artifacts.map((a) => (
                <M3eMenuItem
                  key={a.id}
                  onClick={() => {
                    setArtifactId(a.id);
                    setPage(1);
                    resetCompose();
                  }}
                >
                  <M3eIcon slot="icon" name={a.id === artifactId ? "check" : "draft"} />
                  {a.role === "external" ? "外部: " : ""}
                  {a.fileName}
                </M3eMenuItem>
              ))}
            </M3eMenu>
          ) : null}
          {!mobile ? (
            /* ペインの操作は縦の浮遊ツールバー（レールの反対側）。Scaffold の trailing rail 領域 */
            <M3eToolbar
              vertical
              className="ws__side-toolbar"
              shape="rounded"
              elevated
              aria-label="引き出しの操作"
            >
              <M3eIconButton
                aria-label={`コメント（${openCount}）`}
                toggle
                selected={drawer === "comments"}
                onClick={() => openDrawer("comments")}
              >
                <M3eIcon name="comment" className={drawer === "comments" ? "icon--filled" : ""} />
              </M3eIconButton>
              <M3eIconButton
                aria-label="版"
                toggle
                selected={drawer === "versions"}
                onClick={() => openDrawer("versions")}
              >
                <M3eIcon name="history" className={drawer === "versions" ? "icon--filled" : ""} />
              </M3eIconButton>
              <M3eIconButton
                aria-label="情報"
                toggle
                selected={drawer === "info"}
                onClick={() => openDrawer("info")}
              >
                <M3eIcon name="info" className={drawer === "info" ? "icon--filled" : ""} />
              </M3eIconButton>
            </M3eToolbar>
          ) : null}
        </div>
        {!mobile ? (
          <div className="ws__spacer">
            <PaneHandle
              width={paneW ?? defaultPane}
              defaultWidth={defaultPane}
              maxWidth={Math.max(240, bodyW - 24 - 360)}
              collapsed={!desktopDrawer}
              onResize={setPaneW}
              onToggle={() => (desktopDrawer ? setDrawer(null) : openDrawer(lastDrawer))}
            />
          </div>
        ) : null}
        {desktopDrawer ? (
          <aside className="drawer" aria-label="引き出し">
            {drawerTabs(drawer, (d) => openDrawer(d))}
            <div className="drawer__body">{drawerBody(drawer)}</div>
          </aside>
        ) : null}
      </div>
      {mobile ? (
        <M3eBottomSheet ref={sheetRef as never} handle handleLabel="引き出し" className="ws__sheet">
          <div className="drawer drawer--sheet">
            {drawerTabs(sheetTab, (d) => setDrawer(d))}
            <div className="drawer__body">{drawerBody(sheetTab)}</div>
          </div>
        </M3eBottomSheet>
      ) : null}

      <SubmitDialog workId={workId} open={submitOpen} onClose={() => setSubmitOpen(false)} />
    </div>
  );
}
