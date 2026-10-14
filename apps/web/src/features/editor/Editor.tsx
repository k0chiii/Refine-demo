import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  textRangeAnchor,
  toViewportRect,
  type Anchor,
  type NormalizedRect,
  type Viewport,
  POST_MANIFEST_NAME,
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
import { PaneTabs } from "@/ui/PaneTabs";
import { PostReview } from "@/features/social/PostReview";
import { ProposeDialog } from "@/features/notation/ProposeDialog";
import { AutoProofreadStatus } from "@/features/proofread/AutoProofreadStatus";
import { useAutoProofread } from "@/features/proofread/useAutoProofread";
import { ImageSwipe } from "@/features/compare/ImageSwipe";
import { PageMappingDialog } from "@/features/compare/PageMappingDialog";
import { useCompareSession } from "@/features/compare/useCompareSession";
import { htmlToPlainText, RichTextViewer } from "@/features/annotation/RichTextViewer";
import { bodyOfHtml, isHtmlArtifact } from "@/features/writing/plainText";
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
  M3eFilterChipSet,
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
/** `compare`: 開いた直後に並べる相手の版（新しい版から比較を始めるため、古い版を見ている時に新しい版を選ぶとここ経由で入れ替える） */
export type EditorSearch = { tab?: Drawer; compare?: string };
export function validateEditorSearch(s: Record<string, unknown>): EditorSearch {
  return {
    ...(s.tab === "comments" || s.tab === "versions" || s.tab === "info" ? { tab: s.tab } : {}),
    ...(typeof s.compare === "string" && s.compare ? { compare: s.compare } : {}),
  };
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
  /** 指で操作する端末（長押しで範囲選択。AnchorOverlay） */
  const touch = useMedia("(pointer: coarse)");
  // compact（<600）: 共通バーは無く、エディタ自身のトップアプリバー。紙面は幅に合わせ、引き出しは覗き見のボトムシート
  const compact = useWindowClass() === "compact";
  const [layoutPref, setLayoutPref] = useState<Layout>(readLayout);
  const layout: Layout = mobile ? "panel" : layoutPref;
  const [drawer, setDrawer] = useState<Drawer | null>(
    search.tab ?? (readLayout() === "panel" ? "comments" : null),
  );
  const [showResolved, setShowResolved] = useState(false);
  /** コメントの絞り込み: 人の指摘だけ / 自動校正だけ */
  const [who, setWho] = useState<"all" | "human" | "bot">("all");
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
  const [proposeFrom, setProposeFrom] = useState<{
    quote: string;
    surrounding: string;
    artifactId: string;
    revisionId: string;
  } | null>(null);
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  // 紙面の倍率は「幅に合わせた大きさ」に掛ける値（1 ＝ 左右の余白が同じ）。表示する数値は実寸比（zoom）
  const [scale, setScale] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  // 回転ボタンは利用者判断で外した（2026-10-14）。原稿は正位置で校正する。ビューアの回転機能自体は残す
  const rotation = 0 as const;
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
    setCompareWith(revisionId ? (search.compare ?? null) : null);
    setDraft(null);
    setActiveThreadId(null);
    if (revisionId && search.compare)
      void navigate({
        to: ".",
        search: (s: EditorSearch) => {
          const { compare: _drop, ...rest } = s;
          return rest;
        },
        replace: true,
      });
    // search.compare は版が変わった時だけ読む
  }, [revisionId]);
  useEffect(() => {
    if (!data) return;
    if (!artifactId || !data.artifacts.some((a) => a.id === artifactId))
      setArtifactId(
        data.artifacts.find((a) => a.fileName === POST_MANIFEST_NAME)?.id ??
          data.artifacts.find((a) => a.role !== "external")?.id ??
          data.artifacts[0]?.id ??
          null,
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
  // 文章エディタから提出した HTML は書式付きで表示し、範囲指摘のオフセットは本文の平文で数える
  const [text, setText] = useState<{ artifactId: string; body: string; html?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!artifact || artifact.type !== "document" || !blob.blob) return;
    let cancelled = false;
    void blob.blob.text().then((t) => {
      if (cancelled) return;
      if (isHtmlArtifact(artifact)) {
        const html = bodyOfHtml(t);
        setText({ artifactId: artifact.id, body: htmlToPlainText(html), html });
      } else setText({ artifactId: artifact.id, body: t });
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
  // 高度な版比較: ページの自動対応・スクロール同期・文章差分（features/compare）
  const cmp = useCompareSession({
    active: compareWith !== null,
    left: otherArtifact,
    right: artifact,
    leftBlob: otherBlob.blob ?? null,
    rightText: artifact && text?.artifactId === artifact.id ? text.body : null,
  });
  const [mappingOpen, setMappingOpen] = useState(false);
  const [swipe, setSwipe] = useState(false);

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
    () =>
      allThreads.filter(
        (t) =>
          (showResolved || !isClosed(t) || t.id === activeThreadId) &&
          (who === "all" || (who === "bot") === Boolean(t.origin)),
      ),
    [allThreads, showResolved, activeThreadId, who],
  );
  const auto = useAutoProofread(revisionId ?? null, data?.artifacts ?? []);

  if (workData === undefined) return <p className="muted">読み込み中…</p>;
  const { work } = workData;
  const isSns = work.mediaType === "sns";
  const openAuthoring = () =>
    void navigate({
      to: isSns ? "/works/$workId/post" : "/works/$workId/write",
      params: { workId },
    });
  const revision = data?.revision ?? null;
  const can = data?.can ?? null;
  const resolvedCount = allThreads.filter(isClosed).length;
  const botCount = allThreads.filter((t) => t.origin && !isClosed(t)).length;
  const openCount = allThreads.length - resolvedCount;
  const overlayThreads: OverlayThread[] = threads
    .map((t) => ({ id: t.id, anchor: t.anchor as Anchor, severity: t.severity, index: t.index }))
    .filter((t) => t.anchor);
  const open = revision ? revision.reviewState === "open" && now < revision.deadlineAt : false;
  const canComment = can?.comment ?? false;
  // 比較中も表示中の版（右＝新しい版）には範囲・ピン・位置なしでコメントできる。左の版は見るだけ
  const selecting = canComment;
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

  /** 投稿欄（ビューアの上）: 範囲・ピン・選択文字列のそば、位置なしは表示中のページの右上。`n` は PDF のページ */
  const compose = (vp: Viewport | null, box: Draft["box"] | null, n?: number) => {
    if (!draft || !canComment) return null;
    if (n !== undefined && (draft.free ? n !== page : draft.page !== n)) return null;
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
        {...(draft.range && text && artifact && revisionId
          ? {
              extra: (
                <M3eButton
                  variant="text"
                  onClick={() => {
                    const r = draft.range!;
                    setProposeFrom({
                      quote: text.body.slice(r.start, r.end).slice(0, 200),
                      surrounding: text.body
                        .slice(Math.max(0, r.start - 30), r.end + 30)
                        .replace(/\n/g, " "),
                      artifactId: artifact.id,
                      revisionId,
                    });
                  }}
                >
                  表記ルールに提案
                </M3eButton>
              ),
            }
          : {})}
      />
    );
  };
  /** ピンだけのレイアウト: 選択中のスレッドをピンの横に出す */
  const popoverCard = (vp: Viewport, n?: number) => {
    if (layout !== "pins" || !activeThreadId) return null;
    const t = threads.find((x) => x.id === activeThreadId);
    if (!t?.anchor) return null;
    const a = t.anchor as Anchor;
    if ((anchorPage(a) ?? undefined) !== n) return null;
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
  const inPage = (vp: Viewport, n?: number) => (
    <>
      {popoverCard(vp, n)}
      {compose(vp, null, n)}
    </>
  );
  /**
   * Google ドキュメント式: そのページ（画像は 1 枚）に位置があるものはその高さ。位置の無いもの・他の添付のものは最後のページの下。
   * `n` は PDF のページ（連続表示で各ページの横に列を置く）
   */
  const gutter = (vp: Viewport, n?: number) => {
    // 比較中は半分の幅しかないので、カードは補助ペイン（引き出し「コメント」）に出す（M3 Supporting pane）
    if (layout !== "aligned" || compareWith) return null;
    const last = n === undefined || n >= pageCount;
    const items: GutterItem[] = threads.flatMap((t) => {
      const a = (t.anchor ?? null) as Anchor | null; // 位置なしは undefined のこともある
      const mine = a !== null && a.artifactId === artifactId;
      const p = a ? anchorPage(a) : null;
      if (mine && (p ?? undefined) === n) return [{ id: t.id, y: anchorTop(a, vp), node: card(t) }];
      if (mine && p !== null) return []; // 同じ PDF の別ページ
      return last ? [{ id: t.id, y: null, node: card(t) }] : [];
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
            <div className="row">
              <M3eButton variant="filled" onClick={() => setSubmitOpen(true)}>
                最初の版を提出
              </M3eButton>
              <M3eButton variant="tonal" onClick={openAuthoring}>
                <M3eIcon slot="icon" name={isSns ? "post_add" : "edit_document"} />
                {isSns ? "投稿を作る" : "文章を書く"}
              </M3eButton>
            </div>
          ) : null}
        </div>
      );
    if (!data) return <div className="empty">読み込み中…</div>;
    if (!artifact) return <div className="empty">添付がありません</div>;
    if (artifact.fileName === POST_MANIFEST_NAME && data.revision)
      return (
        <div className="post-review-wrap">
          <PostReview
            manifestArtifactId={artifact.id}
            artifacts={data.artifacts}
            isFinal={work.finalRevisionId === data.revision.id}
            workTitle={work.title}
            revisionLabel={data.revision.label}
          />
        </div>
      );
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
          onPageChange={setPage}
          scale={scale}
          besideWidth={besideWidth}
          onZoom={setZoom}
          rotation={rotation}
          onPageCount={setPageCount}
          renderInPage={
            compareWith
              ? (vp, n) => (
                  <>
                    {cmp.pageOverlay("right", vp, n)}
                    {inPage(vp, n)}
                  </>
                )
              : inPage
          }
          renderGutter={gutter}
          {...(compareWith ? cmp.pdfProps("right") : {})}
        />
      );
    if (artifact.type === "document" && text?.artifactId === artifact.id)
      return text.html !== undefined ? (
        <RichTextViewer
          html={text.html}
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
          {...(compareWith ? cmp.textProps("right") : {})}
        />
      ) : (
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
          {...(compareWith ? cmp.textProps("right") : {})}
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
          besideWidth={besideWidth}
          onZoom={setZoom}
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
          page={1}
          scale={scale}
          rotation={rotation}
          renderInPage={(vp, n) => cmp.pageOverlay("left", vp, n)}
          {...cmp.pdfProps("left")}
        />
      );
    if (otherArtifact.type === "document") {
      if (!cmp.otherText) return <div className="empty">文章を読み込み中…</div>;
      return cmp.otherText.html !== undefined ? (
        <RichTextViewer
          html={cmp.otherText.html}
          artifactId={otherArtifact.id}
          {...none}
          draft={null}
          onDraft={() => undefined}
          {...cmp.textProps("left")}
        />
      ) : (
        <TextViewer
          text={cmp.otherText.body}
          artifactId={otherArtifact.id}
          {...none}
          draft={null}
          onDraft={() => undefined}
          {...cmp.textProps("left")}
        />
      );
    }
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

  const commentsPanel = (
    <div className="comments">
      <AutoProofreadStatus auto={auto} />
      <div className="comments__header">
        <M3eFilterChipSet aria-label="コメントの絞り込み">
          {botCount > 0 ? (
            <>
              <M3eFilterChip
                selected={who === "human"}
                onClick={() => setWho((v) => (v === "human" ? "all" : "human"))}
              >
                人の指摘
              </M3eFilterChip>
              <M3eFilterChip
                selected={who === "bot"}
                onClick={() => setWho((v) => (v === "bot" ? "all" : "bot"))}
              >
                <M3eIcon slot="icon" name="smart_toy" />
                自動校正 {botCount}
              </M3eFilterChip>
            </>
          ) : null}
          {resolvedCount > 0 ? (
            <M3eFilterChip selected={showResolved} onClick={() => setShowResolved((v) => !v)}>
              解決済み {resolvedCount}
            </M3eFilterChip>
          ) : null}
        </M3eFilterChipSet>
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
              ? touch
                ? "ファイルの上で長押しして、そのままなぞると範囲、離すとその場にコメントできます。"
                : "ファイルの上でドラッグすると、その場にコメントできます。"
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
    <PaneTabs
      label="引き出し"
      value={current ?? "comments"}
      onChange={onPick}
      items={[
        { id: "comments", label: "コメント", count: openCount },
        { id: "versions", label: "版" },
        { id: "info", label: "情報" },
      ]}
    />
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
          setScale(1);
          // 新しい版を常に末尾（右）の操作できる側に置く。古い版を見ている時に新しい版を選んだら、新しい版を開いて今の版と並べる
          const cur = workData.revisions.find((r) => r.id === revisionId);
          const next = id ? workData.revisions.find((r) => r.id === id) : undefined;
          if (cur && next && next.submittedAt > cur.submittedAt)
            void navigate({
              to: "/works/$workId/v/$n",
              params: { workId, n: String(versionOf(next)) },
              search: { tab: "versions", compare: cur.id },
            });
          else setCompareWith(id);
        }}
        onSubmit={() => setSubmitOpen(true)}
        onWrite={openAuthoring}
      />
    ) : d === "info" ? (
      <InfoTab work={workData} revision={data ?? null} isAdmin={me?.isSystemAdmin ?? false} />
    ) : null;
  const desktopDrawer = drawer !== null && !mobile;
  // 「ピンの高さに並べる」では紙面の横にコメントの列（補助ペインと同じ 360 / 412）＋間隔 24 が並ぶので、幅合わせから除く
  const besideWidth = layout === "aligned" && !compareWith ? defaultPane + 24 : 0;
  const zoomStep = (dir: 1 | -1) =>
    setScale((s) => Math.min(5, Math.max(0.25, +(dir > 0 ? s * 1.25 : s / 1.25).toFixed(3))));
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
            <div className="compare-wrap">
              <CompareStatus cmp={cmp} />
              {swipe && cmp.kind === "image" && otherBlob.url && blob.url ? (
                <ImageSwipe
                  leftUrl={otherBlob.url}
                  rightUrl={blob.url}
                  leftLabel={other?.revision.label ?? "旧版"}
                  rightLabel={revision?.label ?? "新版"}
                />
              ) : (
                <div className="compare">
                  <div className="compare__pane">
                    <div className="compare__label">{other?.revision.label ?? "…"}</div>
                    {renderOther()}
                  </div>
                  <div className="compare__pane">
                    <div className="compare__label">
                      {revision?.label}
                      {canComment ? <span className="compare__hint">コメントできます</span> : null}
                    </div>
                    {renderViewer()}
                  </div>
                </div>
              )}
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
              // 狭い幅では横にスクロールする領域になるので、キーボードでも辿れるようにする
              tabIndex={0}
            >
              {isPdf ? (
                <>
                  {/* compact はページを連続でスクロールして読むので、送りボタンは省いて数値だけ残す（ツールバーを幅に収める） */}
                  {compact ? null : (
                    <M3eIconButton
                      aria-label="前のページ"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <M3eIcon name="chevron_left" />
                    </M3eIconButton>
                  )}
                  <span className="ws__toolbar-text">
                    {pageCount ? `${page} / ${pageCount}` : "…"}
                  </span>
                  {compact ? null : (
                    <M3eIconButton
                      aria-label="次のページ"
                      disabled={page >= pageCount}
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    >
                      <M3eIcon name="chevron_right" />
                    </M3eIconButton>
                  )}
                </>
              ) : null}
              {isPdf || isImage ? (
                <>
                  <M3eIconButton aria-label="縮小" onClick={() => zoomStep(-1)}>
                    <M3eIcon name="zoom_out" />
                  </M3eIconButton>
                  {/* 実寸比の数値。押すと幅に合わせた大きさ（左右の余白が同じ）に戻す */}
                  <button
                    type="button"
                    className="ws__toolbar-text ws__zoom"
                    title="幅に合わせる"
                    aria-label={`表示倍率 ${zoom ? Math.round(zoom * 100) : "…"}%（押すと幅に合わせる）`}
                    onClick={() => setScale(1)}
                  >
                    {zoom ? `${Math.round(zoom * 100)}%` : "…"}
                  </button>
                  <M3eIconButton aria-label="拡大" onClick={() => zoomStep(1)}>
                    <M3eIcon name="zoom_in" />
                  </M3eIconButton>
                </>
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
              {compareWith && (cmp.kind === "pdf" || cmp.kind === "document") ? (
                <>
                  <M3eIconButton
                    aria-label={cmp.syncOn ? "スクロール同期をやめる" : "スクロールを同期する"}
                    toggle
                    selected={cmp.syncOn}
                    onClick={() => cmp.setSyncOn(!cmp.syncOn)}
                  >
                    <M3eIcon
                      name={cmp.syncOn ? "sync" : "sync_disabled"}
                      className={cmp.syncOn ? "icon--filled" : ""}
                    />
                  </M3eIconButton>
                  <M3eIconButton
                    aria-label={cmp.diffOn ? "文章の差分を隠す" : "文章の差分を表示"}
                    toggle
                    selected={cmp.diffOn}
                    onClick={() => cmp.setDiffOn(!cmp.diffOn)}
                  >
                    <M3eIcon name="difference" className={cmp.diffOn ? "icon--filled" : ""} />
                  </M3eIconButton>
                </>
              ) : null}
              {compareWith && cmp.kind === "pdf" ? (
                <M3eIconButton
                  aria-label="ページの対応を確認・修正"
                  disabled={cmp.pdf.status !== "ready"}
                  onClick={() => setMappingOpen(true)}
                >
                  <M3eIcon name="low_density" />
                </M3eIconButton>
              ) : null}
              {compareWith && cmp.kind === "image" ? (
                <M3eIconButton
                  aria-label={swipe ? "左右に並べる" : "重ねて比較"}
                  toggle
                  selected={swipe}
                  onClick={() => setSwipe((v) => !v)}
                >
                  <M3eIcon name="vertical_split" className={swipe ? "icon--filled" : ""} />
                </M3eIconButton>
              ) : null}
              {compareWith ? (
                <M3eIconButton
                  aria-label="比較を終了"
                  toggle
                  selected
                  onClick={() => {
                    setCompareWith(null);
                    setScale(1);
                    resetCompose();
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
      {proposeFrom ? (
        <ProposeDialog
          open
          onClose={() => setProposeFrom(null)}
          quote={proposeFrom.quote}
          surrounding={proposeFrom.surrounding}
          workId={workId}
          revisionId={proposeFrom.revisionId}
          artifactId={proposeFrom.artifactId}
        />
      ) : null}
      {compareWith && cmp.kind === "pdf" ? (
        <PageMappingDialog
          open={mappingOpen}
          pdf={cmp.pdf}
          leftLabel={other?.revision.label ?? "旧版"}
          rightLabel={revision?.label ?? "新版"}
          onClose={() => setMappingOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** 比較の状況（解析中・同期を止めた理由・差分の件数）。M3: 状態はテキストで短く */
function CompareStatus({ cmp }: { cmp: ReturnType<typeof useCompareSession> }) {
  const parts: string[] = [];
  if (cmp.kind === "pdf") {
    if (cmp.pdf.status === "analyzing") parts.push("ページの対応を解析中…");
    else if (cmp.pdf.status === "error")
      parts.push("ページの対応を解析できませんでした（同じページ番号で並べています）");
    else if (cmp.pdf.status === "ready") {
      const inserted = cmp.pdf.pairs.filter((p) => p.left === null).length;
      const deleted = cmp.pdf.pairs.filter((p) => p.right === null).length;
      const moved = cmp.pdf.pairs.filter((p) => p.kind === "moved").length;
      const low = cmp.pdf.pairs.filter(
        (p) => p.left !== null && p.right !== null && p.confidence === "low",
      ).length;
      parts.push(
        [
          `ページ対応: 旧 ${cmp.pdf.leftCount} → 新 ${cmp.pdf.rightCount}`,
          inserted ? `追加 ${inserted}` : "",
          deleted ? `削除 ${deleted}` : "",
          moved ? `移動 ${moved}` : "",
          low ? `要確認 ${low}` : "",
          cmp.pdf.manual.length ? "手動の対応あり" : "",
        ]
          .filter(Boolean)
          .join("・"),
      );
    }
  } else if (cmp.kind === "document" && cmp.stats) {
    const s = cmp.stats;
    parts.push(
      `文章の差分: 追加 ${s.inserted}・削除 ${s.deleted}・変更 ${s.changed}${s.moved ? `・移動 ${s.moved}` : ""}`,
    );
  } else if (cmp.kind === "other")
    parts.push("この組み合わせは左右に並べて表示します（自動の対応・差分はありません）");
  if (cmp.syncNote) parts.push(cmp.syncNote);
  if (parts.length === 0) return null;
  return (
    <div className={`compare-status ${cmp.syncNote ? "compare-status--warn" : ""}`} role="status">
      {parts.join("　")}
    </div>
  );
}
