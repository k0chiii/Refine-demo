import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  compareTargetLabel,
  comparisonScope,
  figmaDeepLink,
  formatFigmaPlace,
  formatWebPlace,
  isBeforeDeadline,
  isFigmaUrl,
  isReviewableArtifact,
  isWebLiveArtifact,
  type MediaType,
  formatVideoSpan,
  pickCompareArtifact,
  textRangeAnchor,
  videoTimeAnchor,
  toViewportRect,
  webElementAnchor,
  type Anchor,
  type NormalizedRect,
  type Viewport,
  type WebAnchorState,
  POST_MANIFEST_NAME,
} from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AlignedGutter, type GutterItem } from "@/features/annotation/AlignedGutter";
import type { OverlayThread } from "@/features/annotation/AnchorOverlay";
import { anchorPage } from "@/features/annotation/anchorPage";
import { ImageViewer } from "@/features/annotation/ImageViewer";
// 大きなビューア（PDF.js・TipTap・動画・ライブ表示・Figma）はその添付を開くまで読み込まない
import {
  FigmaEmbedViewer,
  PdfViewer,
  preloadViewers,
  RichTextViewer,
  VideoViewer,
  ViewerLoading,
  WebLiveViewer,
} from "@/features/annotation/lazyViewers";
import { TextViewer } from "@/features/annotation/TextViewer";
import type { WebDraft } from "@/features/annotation/WebLiveViewer";
import type { FigmaDraft } from "@/features/annotation/FigmaEmbedViewer";
import { useArtifactBlob } from "@/features/annotation/useArtifactBlob";
import { mayPersist } from "@/lib/fileCachePolicy";
import { defaultArtifactId } from "./defaultArtifact";
import { documentView } from "@/features/writing/documentView";
import { StoredComposePopover } from "@/features/review/ComposePopover";
import { createComposeStore } from "@/features/review/composeStore";
import {
  activeMentions,
  createMentionDirectory,
  MentionProvider,
} from "@/features/review/mentions";
import { ThreadCard, isClosed, type Thread } from "@/features/review/ThreadCard";
import { SubmitDialog } from "@/features/upload/SubmitDialog";
import { PinButton } from "@/features/home/PinButton";
import { PaneHandle } from "@/features/editor/PaneHandle";
import { Loading } from "@/ui/Loading";
import { PaneTabs } from "@/ui/PaneTabs";
import { PostReview } from "@/features/social/PostReview";
import { ProposeDialog } from "@/features/notation/ProposeDialog";
import { AutoProofreadStatus } from "@/features/proofread/AutoProofreadStatus";
import { useAutoProofread } from "@/features/proofread/useAutoProofread";
import {
  effectiveMarkMode,
  markModeIcon,
  markModeLabel,
  markModes,
  useMarkMode,
  type MarkMode,
} from "@/features/review/markMode";
import { CompareButton } from "@/features/compare/CompareButton";
import { CrossWorkPicker } from "@/features/compare/CrossWorkPicker";
import { ImageSwipe } from "@/features/compare/ImageSwipe";
import { PageMappingDialog } from "@/features/compare/PageMappingDialog";
import { useCompareSession } from "@/features/compare/useCompareSession";
import { remaining } from "@/lib/format";
import { workHint } from "@/lib/workHint";
import {
  blockedReasonLabel,
  closedReasonLabel,
  resolutionLabel,
  reviewStateLabel,
} from "@/lib/labels";
import { newRequestId, useAction } from "@/lib/useAction";
import { useMedia, useWindowClass } from "@/lib/useMedia";
import {
  DEFAULT_ZOOM_LIMITS,
  PINCH_MIN,
  stepScale,
  usePinchZoom,
  type ZoomLimits,
} from "@/lib/usePinchZoom";
import { ActionSheet } from "@/ui/ActionSheet";
import { prepareBottomSheet } from "@/ui/bottomSheet";
import { useRevealThread } from "@/features/review/revealThread";
import { FeedbackPane } from "@/features/feedback/FeedbackPane";
import type { Drawer, EditorSearch } from "./search";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Field, TextArea } from "@/ui/Field";
import { StatusText } from "@/ui/Chip";
import { M3eBottomSheet } from "@m3e/react/bottom-sheet";
import { M3eButton } from "@m3e/react/button";
import { M3eFilterChip, M3eFilterChipSet } from "@m3e/react/chips";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import {
  M3eMenu,
  M3eMenuItem,
  M3eMenuItemGroup,
  M3eMenuItemRadio,
  M3eMenuTrigger,
} from "@m3e/react/menu";
import { M3eToolbar } from "@m3e/react/toolbar";
import { InfoTab } from "./InfoTab";
import { LeaveReviewPrompt } from "./LeaveReviewPrompt";
import { VersionsTab } from "./VersionsTab";

export type { Drawer, EditorSearch } from "./search";

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
  /** 動画の時点（end があれば範囲）。rect・point と一緒なら、その時点の画面の位置 */
  time?: { start: number; end?: number };
  /** 動画で範囲を選んでいる途中（投稿欄はまだ出さない） */
  marking?: boolean;
  /** Web のライブ表示で押した要素（ブリッジが返した位置と、付けたときの端末） */
  web?: WebDraft;
  /** Figma の埋め込みのフレーム（「このフレームについて」） */
  figma?: FigmaDraft;
  /** 位置なしのコメント（ツールバーから） */
  free?: boolean;
  /** SNS 投稿のプレビューで選んだ位置（本文の添付の text_range・画像の添付の image_rect / image_pin）。そのままコメントの位置にする */
  anchor?: Anchor;
  /** 上の位置の呼び名（投稿欄に出す。「本文」「2 枚目の画像」）と、本文の引用文 */
  postPlace?: { label: string; quote?: string };
};

const COMPOSE_W = 300;
/** 紙面の描き終わりの通知が届かなくても、ファイルが届いてからこの時間で読み込み中の表示を終える */
const PAINT_TIMEOUT_MS = 8000;

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
  // 媒体が分かったら、その紙面のビューア（PDF.js など）を版・ファイルの取得と並行して読み込み始める
  // 一覧・ホームで押した行から分かる媒体（workHint）で、works.get が届く前から読み込み始める
  const mediaType = workData?.work.mediaType ?? workHint(workId)?.mediaType;
  useEffect(() => {
    if (mediaType) preloadViewers(mediaType as MediaType);
  }, [mediaType]);
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
  const removeThread = useMutation(api.comments.remove);
  const removeReply = useMutation(api.comments.removeReply);
  const carryForward = useMutation(api.comments.carryForward);
  const createFeedback = useMutation(api.feedback.createThread);
  // 相談（FB）: 解決しない話し合い。この制作物の相談を引き出し「FB」と紙面の印に使う
  const fbThreads = useQuery(api.feedback.listThreads, { workId });

  // M3 の compact/medium（839 以下）: 補助ペインは置けないので、引き出しはツールバーから開くボトムシート（普段は閉じて紙面を全面に）
  const mobile = useMedia("(max-width: 839px)");
  /** 指で操作する端末（長押しで範囲選択。AnchorOverlay） */
  const touch = useMedia("(pointer: coarse)");
  // compact（<600）: 添付の切り替えはボトムシート、ツールバーの文字（ページ・倍率の −／＋）を省く
  const compact = useWindowClass() === "compact";
  const [layoutPref, setLayoutPref] = useState<Layout>(readLayout);
  const layout: Layout = mobile ? "panel" : layoutPref;
  const [drawer, setDrawer] = useState<Drawer | null>(
    search.tab ?? (readLayout() === "panel" ? "comments" : null),
  );
  const [showResolved, setShowResolved] = useState(false);
  /** コメントの絞り込み: 人のコメントだけ / 自動校正だけ */
  const [who, setWho] = useState<"all" | "human" | "bot">("all");
  /** 利用者が選んだ添付（選んでいなければ既定の添付。下の artifactId） */
  const [pickedArtifactId, setArtifactId] = useState<string | null>(null);
  // 紙面に出す添付。選んでいなければ、提出の順番によらず PDF → 画像 → 文章 → 動画（動画の制作物は動画を先に。.ai などの原本は
  // 情報 › この版のファイル から落とす）。state に写さず描画のなかで決める（写すと、版が届いてから 1 回余計に描かれ、
  // 「添付がありません」が一瞬出ていた。§65）
  const artifactId: string | null = data
    ? pickedArtifactId && data.artifacts.some((a) => a.id === pickedArtifactId)
      ? pickedArtifactId
      : defaultArtifactId(data.artifacts, data.work.mediaType)
    : null;
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
  /** コメントを選んだ要求（選ぶたびに n が増える）。一覧をそのカードまでスクロールする（features/review/revealThread） */
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  const requestReveal = (id: string) => setReveal((r) => ({ id, n: (r?.n ?? 0) + 1 }));
  /** 引き出し「FB」で開いている相談 */
  const [fbOpenId, setFbOpenId] = useState<string | null>(search.fb ?? null);
  /**
   * 紙面に印を付けたとき作るもの: コメント（解決する指摘）・FB（解決しない相談）・なし（印を付けない）。下のツールバーで切り替える。
   * このタブのあいだ覚える（features/review/markMode）。権限で使えないモードは下の markMode に置き換える
   */
  const [markPick, setMarkPick] = useMarkMode();
  const [draft, setDraft] = useState<Draft | null>(null);
  /** SNS のプレビューでコメントの位置へ移して強調する合図（カード・印を押すたびに増える） */
  const [postReveal, setPostReveal] = useState(0);
  /** 動画の再生位置を移す（コメントのカードを押したとき）。key が変わるたびに移す */
  const [videoSeek, setVideoSeek] = useState<{ t: number; key: number } | null>(null);
  /** Web のライブ表示でその要素へ移す（カードを押したとき。端末も合わせる） */
  const [webFocus, setWebFocus] = useState<{
    anchor: Extract<Anchor, { type: "web_element" }>;
    key: number;
  } | null>(null);
  /** ライブ表示での再アンカーの結果（カードに「位置が外れました」を出す） */
  const [webStates, setWebStates] = useState<ReadonlyMap<string, WebAnchorState>>(new Map());
  const [proposeFrom, setProposeFrom] = useState<{
    quote: string;
    surrounding: string;
    artifactId: string;
    revisionId: string;
  } | null>(null);
  // 投稿欄の書きかけ（本文・メンション）。Editor の state に置かず、投稿欄だけが購読する（1 文字ごとに全体を描き直さない）
  const [composeStore] = useState(createComposeStore);
  // メンションの検索先（候補は「@」に続けて打った文字でサーバーに探させる。名簿は購読しない。§60）
  const mentionDirectory = useMemo(() => createMentionDirectory(workId, "comments"), [workId]);
  const [requestId, setRequestId] = useState(newRequestId);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  // 紙面の倍率は「幅に合わせた大きさ」に掛ける値（1 ＝ 左右の余白が同じ）。表示する数値は実寸比（zoom）
  const [scale, setScale] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  // 校正物はピンチでも拡大縮小できる（アプリ全体は拡大しない）
  // 要素は読み込みが終わってから描かれるので、ref ではなく state で受ける（最初の描画時にはまだ無い）
  const [viewerEl, setViewerEl] = useState<HTMLDivElement | null>(null);
  // PDF の拡大の上限は実寸比 1000%（紙面が大きいときはその分下げる）。PdfViewer が知らせる「幅に合わせた大きさの実寸比」で、
  // 倍率（scale）の上限に直す。PDF 以外（画像・文章）は従来どおり PINCH_MAX
  const pdfLimits = useRef<{ fit: number; max: number } | null>(null);
  const zoomLimits = useCallback((): ZoomLimits => {
    const l = pdfLimits.current;
    return l && l.fit > 0
      ? { min: PINCH_MIN, max: Math.max(1, l.max / l.fit) }
      : DEFAULT_ZOOM_LIMITS;
  }, []);
  usePinchZoom(viewerEl, scale, setScale, zoomLimits);
  // 添付を切り替えたら倍率は幅に合わせた大きさに戻す（画像で拡大した倍率が文章に持ち越されて 220% から始まっていた）
  useEffect(() => {
    setScale(1);
    pdfLimits.current = null;
    // SNS のプレビューで選んだ位置は、他の添付に切り替えたら破棄する（その添付の紙面には投稿欄が出ないため）
    setDraft((d) => (d?.anchor ? null : d));
  }, [artifactId]);

  // 回転ボタンは利用者判断で外した（2026-10-14）。原稿は正位置で校正する。ビューアの回転機能自体は残す
  const rotation = 0 as const;
  const [compareWith, setCompareWith] = useState<string | null>(null);
  /** 「別の制作物と比べる」の相手を選ぶダイアログ */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [externalNote, setExternalNote] = useState("");
  const [now, setNow] = useState(Date.now());
  const sheetRef = useRef<HTMLElement | null>(null);
  // 狭い画面の引き出し（ボトムシート）が開いているか。ツールバーのボタンの選択状態に使う
  const [sheetOpen, setSheetOpen] = useState(false);

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
  /** 狭い画面: 引き出しのシートを開く（同じものが開いていれば閉じる） */
  const toggleSheet = (d: Drawer) => {
    const el = sheetRef.current as
      | (HTMLElement & { show?: (detent?: number) => void; hide?: () => void })
      | null;
    if (!el) return;
    if (sheetOpen && drawer === d) {
      el.hide?.();
      setSheetOpen(false);
      return;
    }
    setDrawer(d);
    if (!sheetOpen) el.show?.(0);
    setSheetOpen(true);
  };
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
  // フィードバックの画面・通知から来たとき: 引き出し「FB」でその相談を開く
  useEffect(() => {
    if (search.fb) setFbOpenId(search.fb);
  }, [search.fb]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // 校正者が版を開いたら「確認済み」にする。割当が未確認（pending）のときだけ呼ぶ
  // （割当のない人や確認済みの人が版を開くたびに、何も変わらない mutation を打たない）
  const needsViewMark = data?.myAssignment?.state === "pending";
  useEffect(() => {
    if (revisionId && needsViewMark)
      void markViewed({ revisionId: revisionId as Id<"revisions"> }).catch(() => undefined);
  }, [revisionId, needsViewMark]);
  useEffect(() => {
    setArtifactId(null);
    setPage(1);
    setCompareWith(revisionId ? (search.compare ?? null) : null);
    setDraft(null);
    setActiveThreadId(revisionId ? (search.thread ?? null) : null);
    if (revisionId && search.thread) {
      setDrawer("comments");
      requestReveal(search.thread);
    }
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
    // 添付の種類が確定したら、媒体の見込みが外れていてもその種類のビューアを読み込み始める（ファイルの取得と並行）
    for (const a of data.artifacts) if (isReviewableArtifact(a)) preloadViewers(a.type);
  }, [data]);
  // ボトムシート（狭い画面）: 普段は閉じて紙面を画面いっぱいに使い、ツールバーの「コメント・版・情報」で開く
  // （利用者指示 2026-10-15。以前は下にタブだけの覗き見を常に出していた）。半分 → 全部、下に払うと閉じる。
  // 止まる高さとハンドルは属性でしか渡せないので、シートが DOM に入った時点で ref で設定する
  // （以前は effect で detents だけ設定していた。シートが後から現れると設定されず、ハンドルも出ず上下に動かせなかった）
  const attachSheet = useCallback((el: HTMLElement | null) => {
    sheetRef.current = el;
    if (!el) return;
    prepareBottomSheet(el);
    const onOpened = () => setSheetOpen(true);
    const onClosed = () => setSheetOpen(false);
    el.addEventListener("opened", onOpened);
    el.addEventListener("closed", onClosed);
    return () => {
      el.removeEventListener("opened", onOpened);
      el.removeEventListener("closed", onClosed);
      sheetRef.current = null;
    };
  }, []);
  // 紙面で範囲を選んだだけ（まだ書いていない）なら Esc で選択をやめる。書きかけのコメントは消さない（§35 I-07）。
  // メニュー・ダイアログを閉じる Esc（defaultPrevented）と IME の変換中は何もしない
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || e.defaultPrevented) return;
      if (composeStore.get().body.trim()) return;
      setDraft(null);
      composeStore.reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composeStore]);

  const artifact = data?.artifacts.find((a) => a.id === artifactId) ?? null;
  // 文章は倍率をそのまま表示（PDF・画像はビューアが実寸比を返す）
  useEffect(() => {
    if (artifact?.type === "document") setZoom(scale);
  }, [scale, artifact?.type]);
  const persistFiles = mayPersist(data?.work.confidentiality);
  const blob = useArtifactBlob(artifact && artifact.role !== "external" ? artifact.id : null, {
    persist: persistFiles,
  });
  // 文章添付は版スナップショットとして UTF-8 テキストに復号して保持する（F-12）
  // 文章エディタから提出した HTML は書式付きで表示し、範囲指摘のオフセットは本文の平文で数える
  const [text, setText] = useState<{ artifactId: string; body: string; html?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!artifact || artifact.type !== "document" || !blob.blob) return;
    let cancelled = false;
    void blob.blob
      .text()
      .then((t) => documentView(artifact, t))
      .then((view) => {
        if (!cancelled) setText({ artifactId: artifact.id, ...view });
      });
    return () => {
      cancelled = true;
    };
  }, [artifact?.id, artifact?.type, blob.blob]);
  const carryCandidates = useQuery(
    api.comments.carryCandidates,
    data?.can.carryForward && revisionId ? { revisionId: revisionId as Id<"revisions"> } : "skip",
  );
  // 「添付を切り替え」には紙面に出せる添付（と外部リンク）だけを並べる。.ai などは 情報 › この版のファイル から落とす
  const switchable = (data?.artifacts ?? []).filter(
    (a) => isReviewableArtifact(a) || a.role === "external",
  );
  // 版比較: 同じ制作物の他の版、または別の制作物の版（利用者指示 2026-10-17）。閲覧権限は revisions.get が確かめる
  const otherRaw = useQuery(api.revisions.get, compareWith ? { revisionId: compareWith } : "skip");
  // 相手を替えた直後に前の相手の結果が残ることがあるので、いま比べている版のものだけを使う
  const other =
    otherRaw && compareWith && otherRaw.revision.id === compareWith ? otherRaw : undefined;
  const scope = other ? comparisonScope(other.work.id, workId) : "same_work";
  const crossWork = scope === "cross_work";
  /** 左（比べる相手）の見出し。別の制作物なら「題名・版」 */
  const otherLabel = other
    ? compareTargetLabel(
        { workId: other.work.id, workTitle: other.work.title, revisionLabel: other.revision.label },
        workId,
      )
    : null;
  const otherArtifact = other ? pickCompareArtifact(other.artifacts, artifact, scope) : null;
  const otherBlob = useArtifactBlob(compareWith && otherArtifact ? otherArtifact.id : null, {
    persist: mayPersist(other?.work.confidentiality),
  });
  // 高度な版比較: ページの自動対応・スクロール同期・文章差分（features/compare）
  const cmp = useCompareSession({
    active: compareWith !== null,
    left: otherArtifact,
    right: artifact,
    leftBlob: otherBlob.blob ?? null,
    rightText: artifact && text?.artifactId === artifact.id ? text.body : null,
  });
  /** 最初の 1 枚を描き終えた添付（PDF・画像・動画のビューアが知らせる。下の paperDone） */
  const [paintedFor, setPaintedFor] = useState<string | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [swipe, setSwipe] = useState(false);

  const resetCompose = () => {
    setDraft(null);
    composeStore.reset();
  };
  const doPost = useAction(async () => {
    if (!data || !draft || !revisionId) return;
    const { body, mentions } = composeStore.get();
    let anchor: Anchor | undefined;
    if (draft.anchor && !draft.free) anchor = draft.anchor;
    else if (artifact && !draft.free) {
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
      else if (artifact.type === "video" && draft.time)
        anchor = videoTimeAnchor(artifact.id, draft.time, { rect: draft.rect, point: draft.point });
      else if (artifact.role === "external" && draft.web)
        anchor = webElementAnchor(artifact.id, draft.web.place);
      else if (artifact.role === "external" && draft.figma)
        anchor = {
          type: "figma_node",
          artifactId: artifact.id,
          fileKey: draft.figma.fileKey,
          nodeId: draft.figma.nodeId,
          ...(draft.figma.nodeName ? { nodeName: draft.figma.nodeName } : {}),
        };
    }
    if (draftKind === "feedback") {
      // 相談（FB）: 解決しない話し合いとして、この版の場所に立てる。立てたら引き出し「FB」でそのやり取りを開く
      const id = await createFeedback({
        workId,
        revisionId,
        ...(anchor ? { anchor } : {}),
        body,
        mentions: activeMentions(body, mentions, mentionDirectory),
      });
      resetCompose();
      openFeedback(id);
      return;
    }
    // 投稿者は分類しない。内部では「修正提案・重要」で保存し、未解決が残れば理由なしの校了を拒否する（安全側）
    await post({
      revisionId: revisionId as Id<"revisions">,
      body,
      kind: "correction",
      severity: "major",
      requestId,
      ...(anchor ? { anchor } : {}),
      mentions: activeMentions(body, mentions, mentionDirectory),
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
  const doReply = useAction(async (threadId: string, b: string, ids: string[]) => {
    await reply({
      threadId: threadId as Id<"commentThreads">,
      body: b,
      mentions: activeMentions(b, ids, mentionDirectory),
    });
  });
  const doAssignThread = useAction(async (threadId: string, ids: string[]) => {
    await assignThread({ threadId: threadId as Id<"commentThreads">, assigneeId: ids[0] ?? null });
  });
  const doEditThread = useAction(async (threadId: string, b: string) => {
    await editThread({ threadId: threadId as Id<"commentThreads">, body: b });
  });
  const doDeleteThread = useAction(async (threadId: string) => {
    await removeThread({ threadId: threadId as Id<"commentThreads"> });
    setActiveThreadId((cur) => (cur === threadId ? null : cur));
  });
  const doDeleteReply = useAction(async (threadId: string, replyEventId: string) => {
    await removeReply({ threadId: threadId as Id<"commentThreads">, replyEventId });
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

  // コメントを選んだら（紙面のピン・範囲、URL の ?thread=、通知）、一覧が見える状態にしてからそのカードまでスクロールする。
  // 一覧の位置合わせは features/review/revealThread。ここでは「一覧を見せる」ところまで（狭い画面はシートを開き、広い画面は
  // 引き出しをコメントに切り替える）。選ぶたびに 1 回だけで、ライブ更新で動かさない
  const revealHandled = useRef<number | null>(null);
  useEffect(() => {
    if (!reveal || revealHandled.current === reveal.n) return;
    const t = allThreads.find((x) => x.id === reveal.id);
    if (!t) return; // 版のデータが届いたら、もう一度ここへ来る
    revealHandled.current = reveal.n;
    // 絞り込みで隠れているときは外す（解決済みは選択中の分だけ下の threads が出す）
    if (who !== "all" && (who === "bot") !== Boolean(t.origin)) setWho("all");
    if (mobile) {
      if (!(sheetOpen && drawer === "comments")) toggleSheet("comments");
    } else if (layout === "panel" && drawer !== "comments") setDrawer("comments");
  }, [reveal, allThreads]);
  useRevealThread(reveal, drawer === "comments" && (!mobile || sheetOpen));
  // 通知などで同じ版の別のコメントへ URL だけが変わったとき
  useEffect(() => {
    if (!revisionId || !search.thread) return;
    setActiveThreadId(search.thread);
    setDrawer("comments");
    requestReveal(search.thread);
  }, [search.thread]);

  // 制作物の中身が届く前から、アプリバー・ツールバー・紙面の枠を同じ形で出す（届いてから枠が現れると、読み込み中の画面が何段にも
  // 見えた。利用者指示 2026-10-17「一回の読み込みで3回くらい表示が変わるのヤダ」。docs/UI_M3E.md §65）。
  // 以降の `workData` が要るところは、届いていなければ何も出さない
  const work = workData?.work ?? null;
  const isSns = work?.mediaType === "sns";
  const hint = workHint(workId);
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
  // 表示中の版の紙面にある相談（立てた順に 1, 2, …。コメントの番号とは別に数える）
  const fbPlaced = (fbThreads ?? [])
    .filter((t) => t.anchor && t.revision?.id === revisionId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const fbIndex = new Map(fbPlaced.map((t, i) => [t.id, i + 1] as const));
  const fbUnread = (fbThreads ?? []).filter((t) => t.unread).length;
  const overlayThreads: OverlayThread[] = [
    ...threads
      .map((t) => ({ id: t.id, anchor: t.anchor as Anchor, severity: t.severity, index: t.index }))
      .filter((t) => t.anchor),
    ...fbPlaced.map((t) => ({
      id: t.id,
      anchor: t.anchor as Anchor,
      severity: "",
      index: fbIndex.get(t.id)!,
      kind: "feedback" as const,
    })),
  ];
  const open = revision
    ? revision.reviewState === "open" && isBeforeDeadline(now, revision.deadlineAt)
    : false;
  const canComment = can?.comment ?? false;
  // 相談（FB）は解決しない話し合いなので、受付が終わった版・校了した版の上でも範囲を選んで立てられる
  const canFeedback = revisionId !== null;
  // 比較中も表示中の版（右＝新しい版）には範囲・ピン・位置なしでコメントできる。左の版は見るだけ
  /** いま効く書き込みのモード（コメントできない版では「コメント」は FB になる） */
  const markMode = effectiveMarkMode(markPick, { comment: canComment, feedback: canFeedback });
  /** 紙面に印を付けられるか（なし のときは、押す・なぞるが紙面そのもの（PDF のリンクなど）に届く） */
  const selecting = markMode !== "none";
  /** 範囲から書くもの: 位置なしのコメントはコメント。それ以外は選んでいるモード（コメントできない版では相談だけ） */
  const draftKind: "comment" | "feedback" =
    draft?.free && canComment
      ? "comment"
      : markMode === "feedback" || !canComment
        ? "feedback"
        : "comment";
  /** モードを替える。印を付けないにしたら、書きかけの位置つきの投稿欄は閉じる（位置なしのコメントは残す）。引き出しは動かさない */
  const changeMarkMode = (m: MarkMode) => {
    setMarkPick(m);
    if (m === "none" && draft && !draft.free) resetCompose();
  };
  const busy =
    doPost.pending ||
    doDecide.pending ||
    doReply.pending ||
    doAssignThread.pending ||
    doEditThread.pending ||
    doDeleteThread.pending ||
    doDeleteReply.pending;
  const goVersion = (r: { kind: string; sequence: number }) =>
    void navigate({ to: "/works/$workId/v/$n", params: { workId, n: String(versionOf(r)) } });

  /**
   * SNS 投稿のプレビューを見ているとき、本文・画像の位置のコメントは添付を切り替えず、プレビューの上でその位置を開く
   * （本文の添付の text_range・画像の添付の image_rect / image_pin）
   */
  const staysInPostPreview = (a: Anchor) =>
    artifact?.fileName === POST_MANIFEST_NAME &&
    (a.type === "text_range" || a.type === "image_rect" || a.type === "image_pin") &&
    (data?.artifacts ?? []).some((x) => x.id === a.artifactId);
  /**
   * コメントを選ぶ。`reveal: false` は一覧のカードそのものを押したとき: 利用者が今そのカードを見て押しているので、一覧を
   * 動かさない（動かすと押した先のカードが指の下から動き、続けて押す「⋮」などが外れる・開いたメニューが祖先のスクロールで閉じる）。
   * 紙面のピン・範囲、URL、通知など、一覧の外から選ぶときだけカードまでスクロールする
   */
  const jumpTo = (t: Thread, opts?: { reveal?: boolean }) => {
    setActiveThreadId(t.id);
    if (opts?.reveal !== false) requestReveal(t.id);
    setPostReveal((n) => n + 1);
    if (t.anchor) {
      if (t.anchor.artifactId !== artifactId && !staysInPostPreview(t.anchor as Anchor))
        setArtifactId(t.anchor.artifactId);
      const p = anchorPage(t.anchor as Anchor);
      if (p) setPage(p);
      if (t.anchor.type === "video_time") setVideoSeek({ t: t.anchor.start, key: Date.now() });
      if (t.anchor.type === "web_element") setWebFocus({ anchor: t.anchor, key: Date.now() });
    }
  };
  /** 引き出し「FB」でその相談を開く（狭い画面はシートを FB で開く） */
  const openFeedback = (id: string | null) => {
    setFbOpenId(id);
    if (mobile) {
      if (!(sheetOpen && drawer === "feedback")) toggleSheet("feedback");
    } else setDrawer("feedback");
  };
  /** 相談の紙面の場所を表示する。別の版の相談ならその版を開く */
  const showFeedbackPlace = (t: {
    id: string;
    anchor: Anchor | null;
    revisionId: string | null;
  }) => {
    if (t.revisionId && t.revisionId !== revisionId) {
      const rev = workData?.revisions.find((r) => r.id === t.revisionId);
      if (rev)
        void navigate({
          to: "/works/$workId/v/$n",
          params: { workId, n: String(versionOf(rev)) },
          search: { tab: "feedback", fb: t.id },
        });
      return;
    }
    setActiveThreadId(t.id);
    setPostReveal((n) => n + 1);
    if (t.anchor) {
      if (t.anchor.artifactId !== artifactId && !staysInPostPreview(t.anchor))
        setArtifactId(t.anchor.artifactId);
      const p = anchorPage(t.anchor);
      if (p) setPage(p);
      if (t.anchor.type === "video_time") setVideoSeek({ t: t.anchor.start, key: Date.now() });
      if (t.anchor.type === "web_element") setWebFocus({ anchor: t.anchor, key: Date.now() });
    }
  };
  const card = (t: Thread & { index: number }, className?: string) => (
    <ThreadCard
      key={t.id}
      thread={t}
      index={t.index}
      {...(webStates.has(t.id) ? { placeState: webStates.get(t.id)! } : {})}
      active={t.id === activeThreadId}
      meId={me?.id ?? null}
      canDecide={can?.decide ?? false}
      canReply={can?.reply ?? false}
      canEdit={work?.lifecycle !== "finalized"}
      pending={busy}
      {...(className ? { className } : {})}
      onSelect={() => jumpTo(t, { reveal: false })}
      onResolve={() => doDecide.run(t.id, "resolved", "")}
      onDecide={(a, r) => doDecide.run(t.id, a, r)}
      onReply={(b, ids) => doReply.run(t.id, b, ids)}
      onAssign={(ids) => doAssignThread.run(t.id, ids)}
      onEdit={(b) => doEditThread.run(t.id, b)}
      onDelete={() => doDeleteThread.run(t.id)}
      onDeleteReply={(replyEventId) => doDeleteReply.run(t.id, replyEventId)}
    />
  );

  /** 投稿欄（ビューアの上）: 範囲・ピン・選択文字列のそば、位置なしは表示中のページの右上。`n` は PDF のページ */
  const compose = (vp: Viewport | null, box: Draft["box"] | null, n?: number) => {
    if (!draft || draft.marking || draft.anchor || !(canComment || canFeedback)) return null;
    if (n !== undefined && (draft.free ? n !== page : draft.page !== n)) return null;
    let pos = { x: 8, y: 8 };
    // 位置なし・動画の時刻だけ（画面の位置なし）・Figma のフレーム単位は、紙面（映像・画面）の右上
    if ((draft.free || draft.figma || (draft.time && !draft.rect && !draft.point)) && vp)
      pos = { x: Math.max(8, vp.width - COMPOSE_W - 8), y: 8 };
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
      <StoredComposePopover
        store={composeStore}
        x={pos.x}
        y={pos.y}
        docked={compact}
        {...(draft.range && text
          ? { quote: text.body.slice(draft.range.start, draft.range.end).slice(0, 80) }
          : {})}
        {...(draft.time
          ? {
              place:
                draft.time.end !== undefined
                  ? `${formatVideoSpan(draft.time)} の範囲`
                  : `${formatVideoSpan(draft.time)} の時点`,
            }
          : draft.web
            ? {
                place: formatWebPlace(
                  { ...draft.web.place, type: "web_element", artifactId: "" },
                  draft.web.deviceLabel,
                ),
              }
            : draft.figma
              ? {
                  place: formatFigmaPlace({ ...draft.figma, type: "figma_node", artifactId: "" }),
                }
              : {})}
        onSubmit={() => void doPost.run()}
        onCancel={resetCompose}
        pending={doPost.pending}
        kind={draftKind}
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
  /** SNS 投稿のプレビューで選んだ位置の投稿欄（PostReview が置く座標を受ける。狭い画面は画面下） */
  const composePost = (at: { x: number; y: number }) => {
    if (!draft?.anchor || !(canComment || canFeedback)) return null;
    const place = draft.postPlace;
    return (
      <StoredComposePopover
        store={composeStore}
        x={at.x}
        y={at.y}
        docked={compact}
        // 狭い画面の投稿欄は引用を別の行で出す。広い画面は場所の行に引用も添える
        {...(place?.quote && compact ? { quote: place.quote.slice(0, 80) } : {})}
        place={
          place
            ? place.quote && !compact
              ? `${place.label}「${place.quote.slice(0, 30)}${place.quote.length > 30 ? "…" : ""}」`
              : place.label
            : "SNS 投稿"
        }
        onSubmit={() => void doPost.run()}
        onCancel={resetCompose}
        pending={doPost.pending}
        kind={draftKind}
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
      if (fbIndex.has(id)) {
        // 紙面の相談の印: 引き出し「FB」でそのやり取りを開く
        setActiveThreadId(id);
        openFeedback(id);
        return;
      }
      const t = threads.find((x) => x.id === id);
      if (!t) return;
      jumpTo(t);
    },
    selecting,
  };
  /** 紙面を出してよいか（中身が決まり、PDF・画像・動画は最初の 1 枚を描き終えた） */
  const paperDone = (() => {
    if (!workData) return false;
    if (!target) return true;
    if (!data) return false;
    if (!artifact) return true;
    if (artifact.fileName === POST_MANIFEST_NAME) return true;
    // 外部リンクのうち、紙面として出すもの（Web のライブ表示・Figma の埋め込み）は iframe が読み込めてから
    if (artifact.role === "external")
      return isWebLiveArtifact(artifact) ||
        (artifact.externalUrl && isFigmaUrl(artifact.externalUrl))
        ? paintedFor === artifact.id
        : true;
    if (blob.error) return true;
    // PDF は受け取りながら開く（全部届く前から描ける）。ほかは全部届いてから
    if (!(artifact.type === "pdf" ? blob.download : blob.blob)) return false;
    if (artifact.type === "document") return text?.artifactId === artifact.id;
    if (
      artifact.type === "pdf" ||
      ((artifact.type === "image" || artifact.type === "video") && blob.url)
    )
      return paintedFor === artifact.id;
    return true;
  })();
  const renderViewer = (): ReactNode => {
    // 届くまでは紙面を出さない（読み込み中の表示は、親が 1 つだけ紙面の上に重ねている。比較中の左右の枠は従来どおり）
    if (!workData) return compareWith ? <Loading label="制作物を読み込んでいます" /> : null;
    if (!target)
      return (
        <div className="empty editor__empty">
          <M3eIcon name="upload_file" />
          まだ版がありません
          {workData.can.submit && work?.lifecycle === "active" ? (
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
    if (!data) return compareWith ? <Loading label="版を読み込んでいます" /> : null;
    if (!artifact) return <div className="empty">添付がありません</div>;
    if (artifact.fileName === POST_MANIFEST_NAME && data.revision)
      return (
        <div className="post-review-wrap">
          <PostReview
            manifestArtifactId={artifact.id}
            artifacts={data.artifacts}
            isFinal={workData.work.finalRevisionId === data.revision.id}
            workTitle={workData.work.title}
            socialProfileId={workData.work.socialProfileId}
            revisionLabel={data.revision.label}
            annotate={{
              threads: overlayThreads,
              activeThreadId,
              revealKey: postReveal,
              selecting,
              draftAnchor: draft?.anchor ?? null,
              onSelectThread: (id) => {
                viewerProps.onSelectThread(id);
                setPostReveal((n) => n + 1);
                // 「ピンの高さに並べる」「ピンだけ」のレイアウトでも、開いたコメントのカードが見えるように
                if (!mobile && fbIndex.has(id) === false && drawer !== "comments")
                  openDrawer("comments");
              },
              onDraft: (d) => {
                if (!d) {
                  resetCompose();
                  return;
                }
                setDraft({
                  anchor: d.anchor,
                  postPlace: { label: d.label, ...(d.quote ? { quote: d.quote } : {}) },
                });
                setActiveThreadId(null);
              },
              renderCompose: composePost,
            }}
          />
        </div>
      );
    if (artifact.role === "external") {
      // 外部での議論の結果の記録（F-10 / CM-04）。ライブ表示・Figma の埋め込みでも下に残す
      const record = canComment ? (
        <div className="external external--record">
          <Field
            label="外部での議論の結果"
            hint="外部で話した結論は合意事項としてコメントに残ります"
          >
            <TextArea value={externalNote} onChange={(e) => setExternalNote(e.target.value)} />
          </Field>
          <div className="row">
            <span className="spacer" />
            <M3eButton
              variant="tonal"
              disabled={doRecordExternal.pending || !externalNote.trim()}
              onClick={() => void doRecordExternal.run()}
            >
              合意事項として記録
            </M3eButton>
          </div>
        </div>
      ) : null;
      const url = artifact.externalUrl ?? "";
      if (isFigmaUrl(url)) {
        const frames = data.artifacts.flatMap((a) =>
          a.role === "external" && a.externalUrl && isFigmaUrl(a.externalUrl)
            ? [{ id: a.id, externalUrl: a.externalUrl }]
            : [],
        );
        return (
          <FigmaEmbedViewer
            frames={frames}
            currentId={artifact.id}
            onSwitch={(id) => {
              setArtifactId(id);
              resetCompose();
            }}
            threads={overlayThreads}
            selecting={selecting}
            onCommentFrame={(d) => {
              setDraft({ figma: d });
              setActiveThreadId(null);
            }}
            renderInPage={(vp) => compose(vp, null)}
            footer={record}
            onReady={() => setPaintedFor(artifact.id)}
          />
        );
      }
      if (isWebLiveArtifact(artifact))
        return (
          <WebLiveViewer
            url={url}
            artifactId={artifact.id}
            label={`${data.revision?.label ?? "この版"}の外部リンク「${url}」`}
            {...viewerProps}
            draft={draft?.web ?? null}
            onDraft={(d) => {
              setDraft(d ? { web: d } : null);
              setActiveThreadId(null);
            }}
            focusRequest={webFocus}
            onStates={setWebStates}
            renderInPage={(vp, box) => compose(vp, box)}
            footer={record}
            onReady={() => setPaintedFor(artifact.id)}
          />
        );
      return (
        <div className="external">
          <a href={url || "#"} target="_blank" rel="noreferrer noopener">
            <M3eIcon name="open_in_new" style={{ fontSize: 16, verticalAlign: "middle" }} /> {url}
          </a>
          <p className="muted small">
            外部ツール上のコメントは同期されません。結論はここに記録してください。
          </p>
          {record}
        </div>
      );
    }
    if (blob.error) return <div className="alert">{blob.error}</div>;
    // ファイルは丸ごと取得してから出す（動画などは長くなり得るので、比較中の枠には文字も見せる）。PDF だけは受け取りながら開く
    if (!(artifact.type === "pdf" ? blob.download : blob.blob))
      return compareWith ? <Loading label="ファイルを取得しています" caption /> : null;
    if (artifact.type === "pdf")
      return (
        <PdfViewer
          download={blob.download}
          artifactId={artifact.id}
          onReady={() => setPaintedFor(artifact.id)}
          {...viewerProps}
          passive={!selecting}
          draft={draft?.page ? (draft as Draft & { page: number }) : null}
          onDraft={(d) => {
            setDraft(d);
            setActiveThreadId(null);
          }}
          page={page}
          onPageChange={setPage}
          scale={scale}
          besideWidth={besideWidth}
          onZoom={(z, l) => {
            pdfLimits.current = l ?? null;
            setZoom(z);
          }}
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
    // 文章は復号が済むまで出さない（済む前に下の「この形式は…」へ落ちて一瞬見えていた）
    if (artifact.type === "document" && text?.artifactId !== artifact.id)
      return compareWith ? <Loading label="文章を読み込んでいます" /> : null;
    if (artifact.type === "document" && text?.artifactId === artifact.id)
      return text.html !== undefined ? (
        <RichTextViewer
          html={text.html}
          scale={scale}
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
          scale={scale}
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
    if (artifact.type === "image" && blob.url) {
      const image = (
        <ImageViewer
          url={blob.url}
          artifactId={artifact.id}
          onReady={() => setPaintedFor(artifact.id)}
          alt={`${data.revision?.label ?? "この版"}の添付「${artifact.fileName}」`}
          {...viewerProps}
          passive={!selecting}
          draft={draft?.rect || draft?.point ? draft : null}
          onDraft={(d) => {
            setDraft(d);
            setActiveThreadId(null);
          }}
          scale={scale}
          besideWidth={besideWidth}
          onZoom={(z) => {
            pdfLimits.current = null;
            setZoom(z);
          }}
          {...(compareWith ? cmp.imageProps("right") : {})}
          renderInPage={inPage}
          renderGutter={gutter}
        />
      );
      const origin = artifact.origin;
      if (origin?.kind !== "figma" || compareWith) return image;
      // Figma から取り込んだフレーム（FG-02〜04）: 由来と、そのノードへのリンク。座標は画像基準のまま
      const link = figmaDeepLink({
        kind: "design",
        fileKey: origin.fileKey,
        nodeId: origin.nodeId,
      });
      return (
        <div className="origin-wrap">
          <div className="origin-bar" role="note">
            <StatusText icon="design_services">
              Figma: {origin.nodeName ?? origin.nodeId}
              {origin.lastModified
                ? `（${new Date(origin.lastModified).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })} 取得）`
                : ""}
            </StatusText>
            <span className="spacer" />
            <a className="link-button" href={link} target="_blank" rel="noreferrer noopener">
              <M3eIcon name="open_in_new" />
              Figma で開く
            </a>
          </div>
          {image}
        </div>
      );
    }
    if (artifact.type === "video" && blob.url)
      return (
        <VideoViewer
          url={blob.url}
          artifactId={artifact.id}
          onReady={() => setPaintedFor(artifact.id)}
          label={`${data.revision?.label ?? "この版"}の添付「${artifact.fileName}」`}
          {...viewerProps}
          draft={draft?.time ? draft : null}
          onDraft={(d) => {
            setDraft(d);
            setActiveThreadId(null);
          }}
          seekRequest={videoSeek}
          besideWidth={besideWidth}
          renderInPage={inPage}
          renderGutter={gutter}
        />
      );
    return (
      <div className="empty">
        この形式はブラウザ内でプレビューできません
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
    if (!(otherArtifact.type === "pdf" ? otherBlob.download : otherBlob.blob))
      return <Loading label="比べる版のファイルを取得しています" caption />;
    const none = {
      threads: [],
      activeThreadId: null,
      onSelectThread: () => undefined,
      selecting: false,
    };
    if (otherArtifact.type === "pdf")
      return (
        <PdfViewer
          download={otherBlob.download}
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
      if (!cmp.otherText) return <Loading label="比べる版の文章を読み込んでいます" />;
      return cmp.otherText.html !== undefined ? (
        <RichTextViewer
          html={cmp.otherText.html}
          scale={scale}
          artifactId={otherArtifact.id}
          {...none}
          draft={null}
          onDraft={() => undefined}
          {...cmp.textProps("left")}
        />
      ) : (
        <TextViewer
          text={cmp.otherText.body}
          scale={scale}
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
          alt={`${otherLabel ?? "比べる版"}の添付「${otherArtifact.fileName}」`}
          {...none}
          draft={null}
          onDraft={() => undefined}
          scale={scale}
          {...cmp.imageProps("left")}
        />
      );
    if (otherArtifact.type === "video" && otherBlob.url)
      return (
        <VideoViewer
          url={otherBlob.url}
          artifactId={otherArtifact.id}
          label={`${otherLabel ?? "比べる版"}の添付「${otherArtifact.fileName}」`}
          {...none}
          draft={null}
          onDraft={() => undefined}
        />
      );
    return <div className="empty">この形式は比較できません</div>;
  };

  // 紙面の読み込みをひとつにまとめる（利用者指示 2026-10-17。docs/UI_M3E.md §65）: 版・ファイル・ビューアの読み込みと最初の 1 枚を
  // 描くところまでを「読み込み中」とし、そのあいだは紙面の上に指標をひとつだけ重ねて動かさない。終わったら紙面を一度に出す
  const pending = !compareWith && !paperDone;
  /** 開いて最初の読み込み（一度紙面が出たあと添付を替えたときは、アプリバー・ツールバーはそのままにして紙面だけ隠す） */
  const revealed = useRef(false);
  useEffect(() => {
    if (paperDone) revealed.current = true;
  }, [paperDone]);
  const initial = pending && !revealed.current;
  // 紙面を描き終えるはずの通知（ビューアの onReady）が何かの理由で届かなくても、指標のまま止まらないよう、ファイルが届いてから
  // 一定時間でそのまま出す
  useEffect(() => {
    if (!pending || !artifact || (artifact.role !== "external" && !blob.blob)) return;
    const id = window.setTimeout(() => setPaintedFor(artifact.id), PAINT_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [pending, artifact?.id, blob.blob]);

  const isPdf = artifact?.type === "pdf";
  const isImage = artifact?.type === "image";
  /** 外部リンクのうち、紙面として出すもの（Web のライブ表示・Figma の埋め込み） */
  const isLiveExternal =
    artifact?.role === "external" &&
    !!artifact.externalUrl &&
    (isWebLiveArtifact(artifact) || isFigmaUrl(artifact.externalUrl));

  const commentsPanel = (
    <div className="comments">
      <AutoProofreadStatus auto={auto} />
      <div className="comments__header">
        {/* 「位置なしでコメント」はここから（ツールバーの丸いボタンは、印を付けるものを切り替える「書き込み」に譲った） */}
        {canComment ? (
          <M3eButton
            variant="tonal"
            className="comments__free"
            onClick={() => {
              setDraft({ free: true });
              setActiveThreadId(null);
            }}
          >
            <M3eIcon slot="icon" name="add_comment" />
            位置なしでコメント
          </M3eButton>
        ) : null}
        <M3eFilterChipSet aria-label="コメントの絞り込み">
          {botCount > 0 ? (
            <>
              <M3eFilterChip
                selected={who === "human"}
                onClick={() => setWho((v) => (v === "human" ? "all" : "human"))}
              >
                人のコメント
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
          <div className="carry-box" aria-label="前版の未解決コメント">
            <div className="label-large">前版の未解決コメント {carryCandidates.length}</div>
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
                    この版へ持ち越す
                  </M3eButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {!target ? (
          <p className="muted small comments__empty">版を提出するとコメントできます</p>
        ) : threads.length === 0 ? (
          <p className="muted small comments__empty">
            {canComment
              ? artifact?.type === "video"
                ? "止めた位置で「この時点にコメント」、タイムラインの上の段をなぞると範囲、映像の上をドラッグすると画面の位置にコメントできます"
                : artifact && isWebLiveArtifact(artifact)
                  ? "ライブ表示を「コメント」に切り替え、サイトの要素を押すとその要素にコメントできます"
                  : artifact?.role === "external" && isLiveExternal
                    ? "「このフレームにコメント」で、表示中のフレームについてコメントできます（位置を指すには取り込んだ画像の上で）"
                    : touch
                      ? "ファイルの上で長押しして、そのままなぞると範囲、離すとその場にコメントできます"
                      : "ファイルの上でドラッグすると、その場にコメントできます"
              : "コメントはありません"}
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
      stretch
      value={current ?? "comments"}
      onChange={onPick}
      items={[
        { id: "comments", label: "コメント", count: openCount },
        { id: "feedback", label: "FB", count: fbUnread || null },
        { id: "versions", label: "版" },
        { id: "info", label: "情報" },
      ]}
    />
  );
  /** この制作物の別の版と比べる（比べる入口はアプリバーの「比べる」。利用者指示 2026-10-17） */
  const compareRevision = (id: string) => {
    if (!workData) return;
    setScale(1);
    // 新しい版を常に末尾（右）の操作できる側に置く。古い版を見ている時に新しい版を選んだら、新しい版を開いて今の版と並べる
    const cur = workData.revisions.find((r) => r.id === revisionId);
    const next = workData.revisions.find((r) => r.id === id);
    if (cur && next && next.submittedAt > cur.submittedAt)
      void navigate({
        to: "/works/$workId/v/$n",
        params: { workId, n: String(versionOf(next)) },
        search: { compare: cur.id },
      });
    else setCompareWith(id);
  };
  const stopCompare = () => {
    setCompareWith(null);
    setScale(1);
    resetCompose();
  };
  const drawerBody = (d: Drawer | null) =>
    d === "comments" ? (
      commentsPanel
    ) : d === "feedback" ? (
      <FeedbackPane
        workId={workId}
        revisionId={revisionId}
        threads={fbThreads}
        indexOf={fbIndex}
        openId={fbOpenId}
        onOpen={setFbOpenId}
        onShowPlace={showFeedbackPlace}
      />
    ) : d === "versions" && workData ? (
      <VersionsTab
        work={workData}
        currentId={revisionId}
        canVoid={can?.void ?? false}
        onOpen={goVersion}
        onSubmit={() => setSubmitOpen(true)}
        onWrite={openAuthoring}
      />
    ) : d === "info" && workData ? (
      <InfoTab work={workData} revision={data ?? null} shownArtifactId={artifactId} />
    ) : null;
  const desktopDrawer = drawer !== null && !mobile;
  // 「ピンの高さに並べる」では紙面の横にコメントの列（補助ペインと同じ 360 / 412）＋間隔 24 が並ぶので、幅合わせから除く
  const besideWidth = layout === "aligned" && !compareWith ? defaultPane + 24 : 0;
  const zoomStep = (dir: 1 | -1) => setScale((s) => stepScale(s, dir, zoomLimits()));
  const atMinZoom = scale <= zoomLimits().min + 0.001;
  const atMaxZoom = scale >= zoomLimits().max - 0.001;
  const sheetTab: Drawer = drawer ?? "comments";
  /** 狭い画面: 引き出し（コメント・版・情報）をシートで開くボタン。紙面のツールバーが無いとき（まだ版が無い・外部リンク）も出す */
  const sheetButtons = (
    [
      ["comments", `コメント（${openCount}）`, "comment"],
      ["feedback", fbUnread ? `FB（未読 ${fbUnread}）` : "FB", "forum"],
      ["versions", "版", "history"],
      ["info", "情報", "info"],
    ] as const
  ).map(([d, label, icon]) => {
    const on = sheetOpen && drawer === d;
    return (
      <M3eIconButton key={d} aria-label={label} toggle selected={on} onClick={() => toggleSheet(d)}>
        <M3eIcon name={icon} className={on ? "icon--filled" : ""} />
      </M3eIconButton>
    );
  });

  return (
    <MentionProvider value={mentionDirectory}>
      <div className={`ws ws--${layout} ${compareWith ? "ws--compare" : ""}`}>
        {/* 見出し・戻る・主要操作は共通アプリバーへ（M3 App bars: ページの見出し＋戻る＋ 1–2 の必須操作。多い操作はツールバーへ） */}
        <AppBarSlot slot="leading">
          <M3eIconButton
            aria-label="制作物一覧へ戻る"
            onClick={() => void navigate({ to: "/works" })}
          >
            <M3eIcon name="arrow_back" className="icon--mirror" />
          </M3eIconButton>
        </AppBarSlot>
        <AppBarSlot slot="title" title={work?.title ?? hint?.title ?? ""}>
          {work?.title ?? hint?.title ?? ""}
        </AppBarSlot>
        {/* 副題（版・状態）は紙面と一緒に現れる。それまでは空の 1 行で場所だけ取り、題名が動かないようにする */}
        <AppBarSlot slot="subtitle">
          {revision && work && !initial ? (
            <>
              {revision.label}・
              {open
                ? `受付中・${remaining(revision.deadlineAt, now)}`
                : revision.reviewClosedReason
                  ? `受付終了（${closedReasonLabel[revision.reviewClosedReason]}）`
                  : reviewStateLabel[revision.reviewState]}
              {work.finalRevisionId === revision.id ? "・校了版" : ""}
            </>
          ) : (
            "\u00A0"
          )}
        </AppBarSlot>
        <AppBarSlot slot="actions">
          {/* 比べる入口はここ 1 つ（紙面と一緒に現れる。ピンの左に置き、ピンの位置は動かさない） */}
          {!initial && workData && revisionId ? (
            <CompareButton
              revisions={workData.revisions}
              currentId={revisionId}
              compareWith={compareWith}
              target={
                otherLabel ?? workData.revisions.find((r) => r.id === compareWith)?.label ?? null
              }
              compact={compact}
              onCompareRevision={compareRevision}
              onPickOther={() => setPickerOpen(true)}
              onStop={stopCompare}
            />
          ) : null}
          <PinButton workId={workId} />
          {/* 校正者の「いまやる 1 つ」は文字付きの filled（アイコンだけでは弱い。M3 Usability。§35 A-20。利用者決定 2026-10-15） */}
          {initial ? null : can?.completeReview ? (
            <M3eButton
              variant="filled"
              className="appbar-primary"
              disabled={doComplete.pending}
              onClick={() => void doComplete.run()}
            >
              <M3eIcon slot="icon" name="task_alt" />
              校正を完了
            </M3eButton>
          ) : data?.myAssignment?.state === "responded" ? (
            <span className="ws__done" role="img" title="校正完了" aria-label="校正完了">
              <M3eIcon name="check_circle" className="icon--filled" />
            </span>
          ) : null}
        </AppBarSlot>
        {switchable.length > 1 && compact ? (
          <ActionSheet
            open={artifactSheet}
            onClose={() => setArtifactSheet(false)}
            title="添付"
            items={switchable.map((a) => ({
              icon: "draft",
              label: `${a.role === "external" ? (a.externalUrl && isFigmaUrl(a.externalUrl) ? "Figma: " : "外部: ") : ""}${a.fileName}`,
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
          <div className={`ws__viewer ${pending ? "ws__viewer--pending" : ""}`} ref={setViewerEl}>
            {/* 読み込み中の指標は、ここに 1 つだけ。版・ファイル・ビューア・最初の描画のどの段でも同じ要素のまま動かさない（文字も付けない） */}
            {pending ? <Loading label="制作物を読み込んでいます" className="ws__loading" /> : null}
            {compareWith ? (
              <div className="compare-wrap">
                <CompareStatus
                  cmp={cmp}
                  otherWork={crossWork ? (other?.work.title ?? null) : null}
                />
                {swipe && cmp.kind === "image" && otherBlob.url && blob.url ? (
                  <ImageSwipe
                    leftUrl={otherBlob.url}
                    rightUrl={blob.url}
                    leftLabel={otherLabel ?? "旧版"}
                    rightLabel={revision?.label ?? "新版"}
                  />
                ) : (
                  <div className="compare">
                    <div className="compare__pane">
                      <div className="compare__label compare__label--other">
                        <span className="compare__label-text" title={otherLabel ?? undefined}>
                          {otherLabel ?? "…"}
                        </span>
                      </div>
                      <Suspense fallback={<ViewerLoading />}>{renderOther()}</Suspense>
                    </div>
                    <div className="compare__pane">
                      <div className="compare__label">
                        {revision?.label}
                        {canComment ? (
                          <span className="compare__hint">コメントできます</span>
                        ) : null}
                      </div>
                      <Suspense fallback={<ViewerLoading />}>{renderViewer()}</Suspense>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Suspense fallback={null}>{renderViewer()}</Suspense>
            )}

            {artifact && !initial && (artifact.role !== "external" || isLiveExternal) ? (
              <M3eToolbar
                className="ws__toolbar"
                shape="rounded"
                elevated
                aria-label="ビューアの操作"
              >
                {/* 項目が入りきらない幅では中だけを横にスクロールする（ツールバー自体に overflow を付けると影が切れる） */}
                <div className="ws__toolbar-items" tabIndex={0}>
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
                      {/* 狭い画面はページの位置をスクロールで見るので省き、引き出しのボタンに場所を譲る */}
                      {mobile ? null : (
                        <span className="ws__toolbar-text">
                          {pageCount ? `${page} / ${pageCount}` : "…"}
                        </span>
                      )}
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
                  {isPdf || isImage || artifact.type === "document" ? (
                    <>
                      {/* 狭い画面はピンチで拡大縮小するので − ＋ は省き、引き出しのボタンに場所を譲る（数値を押すと幅に合わせる） */}
                      {mobile ? null : (
                        <M3eIconButton
                          aria-label="縮小"
                          disabled={atMinZoom}
                          onClick={() => zoomStep(-1)}
                        >
                          <M3eIcon name="zoom_out" />
                        </M3eIconButton>
                      )}
                      {/* 実寸比の数値。広い画面は押すと幅に合わせた大きさ（左右の余白が同じ）に戻す。
                          狭い画面は − ＋ を置かないので、押すと「拡大／縮小／幅に合わせる」のメニュー
                          （ピンチだけに頼らない。M3 Gestures・WCAG 2.5.1。§35 I-15。利用者決定 2026-10-15） */}
                      <M3eButton
                        variant="text"
                        className="ws__toolbar-text ws__zoom"
                        aria-label={`表示倍率 ${zoom ? Math.round(zoom * 100) : "…"}%（${mobile ? "押すと拡大・縮小" : "押すと幅に合わせる"}）`}
                        {...(mobile ? {} : { onClick: () => setScale(1), title: "幅に合わせる" })}
                      >
                        {zoom ? `${Math.round(zoom * 100)}%` : "…"}
                        {mobile ? <M3eMenuTrigger htmlFor="zoom-menu" /> : null}
                      </M3eButton>
                      {mobile ? null : (
                        <M3eIconButton
                          aria-label="拡大"
                          disabled={atMaxZoom}
                          onClick={() => zoomStep(1)}
                        >
                          <M3eIcon name="zoom_in" />
                        </M3eIconButton>
                      )}
                    </>
                  ) : null}
                  {/* 書き込み（印を付けるとき作るもの）: コメント / FB / 選択（印を付けない）。押すと小さなメニュー。アイコンといま選んでいる名前で示す。
                      引き出しは動かさない（FB を立てると、これまでどおり引き出し「FB」でそのやり取りが開く） */}
                  {canComment || canFeedback ? (
                    <M3eIconButton
                      className="ws__mark-mode"
                      aria-label="書き込み: コメント / FB / 選択"
                      title={`書き込み: コメント / FB / 選択（いまは${markModeLabel[markMode]}）`}
                    >
                      <M3eIcon
                        name={markModeIcon[markMode]}
                        className={markMode === "none" ? "" : "icon--filled"}
                      />
                      <M3eMenuTrigger htmlFor="mark-mode-menu" />
                    </M3eIconButton>
                  ) : null}
                  {/* 同期（スクロール・拡大縮小の視点）は PDF・文章・画像（左右に並べるとき）。差分は PDF・文章 */}
                  {compareWith &&
                  (cmp.kind === "pdf" ||
                    cmp.kind === "document" ||
                    (cmp.kind === "image" && !swipe)) ? (
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
                  ) : null}
                  {compareWith && (cmp.kind === "pdf" || cmp.kind === "document") ? (
                    <>
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
                  {mobile ? (
                    <>
                      {/* 前に拡大縮小があるときだけ区切る（動画は拡大縮小しない） */}
                      {isPdf || isImage || artifact.type === "document" ? (
                        <span className="ws__toolbar-sep" />
                      ) : null}
                      {sheetButtons}
                    </>
                  ) : null}
                  {switchable.length > 1 ? (
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
                          <M3eIcon
                            name={l.icon}
                            className={layout === l.id ? "icon--filled" : ""}
                          />
                        </M3eIconButton>
                      ))}
                    </>
                  ) : null}
                </div>
              </M3eToolbar>
            ) : mobile ? (
              <M3eToolbar
                className="ws__toolbar"
                shape="rounded"
                elevated
                aria-label="引き出しの操作"
              >
                <div className="ws__toolbar-items">{sheetButtons}</div>
              </M3eToolbar>
            ) : null}
            {canComment || canFeedback ? (
              <M3eMenu id="mark-mode-menu" positionY="above">
                <M3eMenuItemGroup aria-label="書き込み（印を付けたとき作るもの）">
                  {markModes
                    .filter((m) => m === "none" || (m === "comment" ? canComment : canFeedback))
                    .map((m) => (
                      <M3eMenuItemRadio
                        key={m}
                        checked={markMode === m}
                        onClick={() => changeMarkMode(m)}
                      >
                        <M3eIcon slot="icon" name={markModeIcon[m]} />
                        {markModeLabel[m]}
                      </M3eMenuItemRadio>
                    ))}
                </M3eMenuItemGroup>
              </M3eMenu>
            ) : null}
            {mobile ? (
              <M3eMenu id="zoom-menu" positionY="above">
                <M3eMenuItem onClick={() => zoomStep(1)}>
                  <M3eIcon slot="icon" name="zoom_in" />
                  拡大
                </M3eMenuItem>
                <M3eMenuItem onClick={() => zoomStep(-1)}>
                  <M3eIcon slot="icon" name="zoom_out" />
                  縮小
                </M3eMenuItem>
                <M3eMenuItem onClick={() => setScale(1)}>
                  <M3eIcon slot="icon" name="fit_width" />
                  幅に合わせる
                </M3eMenuItem>
              </M3eMenu>
            ) : null}
            {switchable.length > 1 && !compact ? (
              <M3eMenu id="artifact-menu" positionY="above">
                {switchable.map((a) => (
                  <M3eMenuItem
                    key={a.id}
                    onClick={() => {
                      setArtifactId(a.id);
                      setPage(1);
                      resetCompose();
                    }}
                  >
                    <M3eIcon slot="icon" name={a.id === artifactId ? "check" : "draft"} />
                    {a.role === "external"
                      ? a.externalUrl && isFigmaUrl(a.externalUrl)
                        ? "Figma: "
                        : "外部: "
                      : ""}
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
                  aria-label={fbUnread ? `FB（未読 ${fbUnread}）` : "FB"}
                  toggle
                  selected={drawer === "feedback"}
                  onClick={() => openDrawer("feedback")}
                >
                  <M3eIcon name="forum" className={drawer === "feedback" ? "icon--filled" : ""} />
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
          <M3eBottomSheet
            ref={attachSheet as never}
            handle
            hideable
            handleLabel="引き出し"
            className="ws__sheet"
          >
            <div className="drawer drawer--sheet">
              {drawerTabs(sheetTab, (d) => setDrawer(d))}
              <div className="drawer__body">{drawerBody(sheetTab)}</div>
            </div>
          </M3eBottomSheet>
        ) : null}

        <SubmitDialog workId={workId} open={submitOpen} onClose={() => setSubmitOpen(false)} />
        <LeaveReviewPrompt
          workId={workId}
          revisionId={revisionId}
          needsCompletion={can?.completeReview === true}
        />
        <CrossWorkPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          currentWorkId={workId}
          onPick={(id) => {
            setScale(1);
            resetCompose();
            setCompareWith(id);
          }}
        />
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
            leftLabel={otherLabel ?? "旧版"}
            rightLabel={revision?.label ?? "新版"}
            onClose={() => setMappingOpen(false)}
          />
        ) : null}
      </div>
    </MentionProvider>
  );
}

/** 比較の状況（別の制作物か・解析中・同期を止めた理由・差分の件数）。M3: 状態はテキストで短く */
function CompareStatus({
  cmp,
  otherWork,
}: {
  cmp: ReturnType<typeof useCompareSession>;
  /** 比べている相手が別の制作物なら、その題名 */
  otherWork: string | null;
}) {
  const parts: string[] = [];
  if (otherWork !== null) parts.push(`別の制作物「${otherWork}」の版と比べています`);
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
