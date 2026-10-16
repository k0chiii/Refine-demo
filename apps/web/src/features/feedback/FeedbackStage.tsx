import { api } from "@mf100/convex/api";
import {
  pickReviewArtifact,
  textRangeAnchor,
  toViewportRect,
  type Anchor,
  type NormalizedRect,
  type Viewport,
} from "@mf100/domain";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { OverlayThread } from "@/features/annotation/AnchorOverlay";
import { ImageViewer } from "@/features/annotation/ImageViewer";
import { anchorPage, PdfViewer } from "@/features/annotation/PdfViewer";
import { RichTextViewer } from "@/features/annotation/RichTextViewer";
import { TextViewer } from "@/features/annotation/TextViewer";
import { useArtifactBlob } from "@/features/annotation/useArtifactBlob";
import { ComposePopover } from "@/features/review/ComposePopover";
import { activeMentions, MentionProvider } from "@/features/review/mentions";
import { documentView } from "@/features/writing/documentView";
import { useAction } from "@/lib/useAction";
import { M3eButton, M3eIcon, M3eIconButton, M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@/ui/m3e";
import type { FeedbackThreadSummary } from "./FeedbackPane";

type Draft = {
  page?: number;
  rect?: NormalizedRect;
  point?: { x: number; y: number };
  range?: { start: number; end: number };
  box?: { x: number; y: number; w: number; h: number };
};

const COMPOSE_W = 300;
/** 範囲・ピンの右に投稿欄を置く。入らなければ左、左にも入らなければ下 */
function popoverPos(box: { x: number; y: number; w: number; h: number }, vp: Viewport) {
  const right = box.x + box.w + 10;
  if (right + COMPOSE_W <= vp.width) return { x: right, y: box.y };
  const left = box.x - COMPOSE_W - 10;
  if (left >= 0) return { x: left, y: box.y };
  return { x: Math.max(0, Math.min(box.x, vp.width - COMPOSE_W)), y: box.y + box.h + 10 };
}

/** 紙面の FB の番号（その版の紙面に印がある相談を、立てた順に 1, 2, …。エディタの引き出し「FB」と同じ数え方） */
export function feedbackMarks(
  threads: readonly FeedbackThreadSummary[] | undefined,
  revisionId: string | null,
): Map<string, number> {
  const placed = (threads ?? [])
    .filter((t) => t.anchor && t.revision?.id === revisionId)
    .sort((a, b) => a.createdAt - b.createdAt);
  return new Map(placed.map((t, i) => [t.id, i + 1] as const));
}

/**
 * FB スペースの紙面（利用者決定 2026-10-16「当該制作物をみながらスレッドで議論」）。
 * コメント（校正の指摘）は出さず、FB の印だけを重ねる。印を押すとそのスレッドを開き、
 * 紙面で範囲を選ぶ（ドラッグ・クリック・文字の選択）と、その場所の FB スレッドを立てられる。
 * 見る版は親が決める（開いたスレッドの版、無ければ最新の版）。版・添付・ページ・倍率は上の細い操作の行で変える。
 */
export function FeedbackStage({
  workId,
  revisionId,
  onRevision,
  threads,
  activeId,
  onSelectThread,
  onCreated,
  focus,
}: {
  workId: string;
  revisionId: string | null;
  onRevision: (revisionId: string) => void;
  threads: FeedbackThreadSummary[] | undefined;
  activeId: string | null;
  onSelectThread: (id: string) => void;
  onCreated: (threadId: string) => void;
  /** 見せたい場所（スレッドの「紙面の場所を表示」）。変わるたびにその添付・ページへ送る */
  focus: { anchor: Anchor; at: number } | null;
}) {
  const work = useQuery(api.works.get, { workId });
  const revisions = useMemo(
    () => (work?.revisions ?? []).filter((r) => r.reviewState !== "void"),
    [work],
  );
  const shownId = revisionId ?? null;
  const dataRaw = useQuery(api.revisions.get, shownId ? { revisionId: shownId } : "skip");
  const data = dataRaw && dataRaw.revision.id === shownId ? dataRaw : undefined;
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const create = useMutation(api.feedback.createThread);
  const candidates = useQuery(api.feedback.mentionCandidates, { workId });

  // 版が変わったら、紙面に出す添付を選び直す（PDF → 画像 → 文章）
  useEffect(() => {
    setDraft(null);
    setPage(1);
    setArtifactId(data ? (pickReviewArtifact(data.artifacts)?.id ?? null) : null);
  }, [data?.revision.id]);
  // 見せたい場所へ送る
  useEffect(() => {
    if (!focus) return;
    if (focus.anchor.artifactId !== artifactId) setArtifactId(focus.anchor.artifactId);
    const p = anchorPage(focus.anchor);
    if (p) setPage(p);
  }, [focus?.at]);

  const artifact = data?.artifacts.find((a) => a.id === artifactId) ?? null;
  const blob = useArtifactBlob(artifact && artifact.role !== "external" ? artifact.id : null);
  const [text, setText] = useState<{ artifactId: string; body: string; html?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!artifact || artifact.type !== "document" || !blob.blob) return;
    let cancelled = false;
    void blob.blob.text().then((t) => {
      if (!cancelled) setText({ artifactId: artifact.id, ...documentView(artifact, t) });
    });
    return () => {
      cancelled = true;
    };
  }, [artifact?.id, artifact?.type, blob.blob]);

  const marks = feedbackMarks(threads, shownId);
  const overlay: OverlayThread[] = (threads ?? [])
    .filter((t) => marks.has(t.id))
    .map((t) => ({
      id: t.id,
      anchor: t.anchor as Anchor,
      severity: "",
      index: marks.get(t.id)!,
      kind: "feedback" as const,
    }));

  const reset = () => {
    setDraft(null);
    setBody("");
    setMentions([]);
  };
  const post = useAction(async () => {
    if (!draft || !shownId || !artifact) return;
    let anchor: Anchor | undefined;
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
    const id = await create({
      workId,
      revisionId: shownId,
      ...(anchor ? { anchor } : {}),
      body,
      mentions: activeMentions(body, mentions, candidates ?? []),
    });
    reset();
    onCreated(id);
  });

  const compose = (vp: Viewport | null, box: Draft["box"] | null, n?: number): ReactNode => {
    if (!draft) return null;
    if (n !== undefined && draft.page !== n) return null;
    let pos = { x: 8, y: 8 };
    if (vp && (draft.rect || draft.point)) {
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
        mentions={mentions}
        onMentions={setMentions}
        {...(draft.range && text
          ? { quote: text.body.slice(draft.range.start, draft.range.end).slice(0, 80) }
          : {})}
        onSubmit={() => void post.run()}
        onCancel={reset}
        pending={post.pending}
        kind="feedback"
      />
    );
  };
  const viewerProps = {
    threads: overlay,
    activeThreadId: activeId,
    onSelectThread,
    selecting: true,
  };

  const viewer = (): ReactNode => {
    if (work === undefined) return <p className="muted fb-stage__empty">読み込み中…</p>;
    if (!shownId)
      return (
        <div className="empty fb-stage__empty">
          <M3eIcon name="draft" />
          まだ版がありません。制作物全体についてのスレッドは右から立てられます
        </div>
      );
    if (!data) return <p className="muted fb-stage__empty">読み込み中…</p>;
    if (!artifact)
      return <div className="empty fb-stage__empty">この版には紙面に出せる添付がありません</div>;
    if (blob.error) return <div className="alert">{blob.error}</div>;
    if (!blob.blob) return <p className="muted fb-stage__empty">ファイルを取得中…</p>;
    if (artifact.type === "pdf")
      return (
        <PdfViewer
          blob={blob.blob}
          artifactId={artifact.id}
          {...viewerProps}
          draft={draft?.page ? (draft as Draft & { page: number }) : null}
          onDraft={(d) => setDraft(d)}
          page={page}
          onPageChange={setPage}
          scale={scale}
          rotation={0}
          onPageCount={setPageCount}
          renderInPage={(vp, n) => compose(vp, null, n)}
        />
      );
    if (artifact.type === "image" && blob.url)
      return (
        <ImageViewer
          url={blob.url}
          artifactId={artifact.id}
          alt={`${data.revision.label}の添付「${artifact.fileName}」`}
          {...viewerProps}
          draft={draft?.rect || draft?.point ? draft : null}
          onDraft={(d) => setDraft(d)}
          scale={scale}
          renderInPage={(vp) => compose(vp, null)}
        />
      );
    if (artifact.type === "document" && text?.artifactId === artifact.id) {
      const textDraft = draft?.range
        ? { ...draft.range, ...(draft.box ? { box: draft.box } : {}) }
        : null;
      const onTextDraft = (r: { start: number; end: number; box?: Draft["box"] } | null) =>
        setDraft(
          r ? { range: { start: r.start, end: r.end }, ...(r.box ? { box: r.box } : {}) } : null,
        );
      return text.html !== undefined ? (
        <RichTextViewer
          html={text.html}
          scale={scale}
          artifactId={artifact.id}
          {...viewerProps}
          draft={textDraft}
          onDraft={onTextDraft}
          inPage={compose(null, draft?.box ?? null)}
        />
      ) : (
        <TextViewer
          text={text.body}
          scale={scale}
          artifactId={artifact.id}
          {...viewerProps}
          draft={textDraft}
          onDraft={onTextDraft}
          inPage={compose(null, draft?.box ?? null)}
        />
      );
    }
    if (artifact.type === "document") return <p className="muted fb-stage__empty">読み込み中…</p>;
    return (
      <div className="empty fb-stage__empty">
        この形式は紙面に出せません（ダウンロードして確認）
      </div>
    );
  };

  const shown = revisions.find((r) => r.id === shownId) ?? null;
  const reviewable = (data?.artifacts ?? []).filter((a) => a.role !== "external");
  return (
    <MentionProvider value={candidates ?? []}>
      <section className="fb-stage" aria-label="紙面">
        <div className="fb-stage__bar" role="toolbar" aria-label="紙面の操作">
          {revisions.length ? (
            <>
              <M3eButton variant="text" className="fb-stage__version">
                <M3eIcon slot="icon" name="history" />
                {shown?.label ?? "版を選ぶ"}
                <M3eMenuTrigger htmlFor={`fb-rev-menu-${workId}`} />
              </M3eButton>
              <M3eMenu id={`fb-rev-menu-${workId}`}>
                {revisions.map((r) => (
                  <M3eMenuItem key={r.id} onClick={() => onRevision(r.id)}>
                    {r.id === shownId ? <M3eIcon slot="icon" name="check" /> : null}
                    {r.label}
                  </M3eMenuItem>
                ))}
              </M3eMenu>
            </>
          ) : null}
          {reviewable.length > 1 ? (
            <>
              <M3eIconButton aria-label="添付を切り替え" title="添付を切り替え">
                <M3eIcon name="attach_file" />
                <M3eMenuTrigger htmlFor={`fb-art-menu-${workId}`} />
              </M3eIconButton>
              <M3eMenu id={`fb-art-menu-${workId}`}>
                {reviewable.map((a) => (
                  <M3eMenuItem key={a.id} onClick={() => setArtifactId(a.id)}>
                    {a.id === artifactId ? <M3eIcon slot="icon" name="check" /> : null}
                    {a.fileName}
                  </M3eMenuItem>
                ))}
              </M3eMenu>
            </>
          ) : null}
          <span className="spacer" />
          {artifact?.type === "pdf" ? (
            <>
              <M3eIconButton
                aria-label="前のページ"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <M3eIcon name="chevron_left" />
              </M3eIconButton>
              <span className="fb-stage__page" aria-live="polite">
                {page} / {pageCount}
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
          <M3eIconButton
            aria-label="縮小"
            disabled={scale <= 0.5}
            onClick={() => setScale((s) => Math.max(0.5, Math.round((s - 0.25) * 100) / 100))}
          >
            <M3eIcon name="zoom_out" />
          </M3eIconButton>
          <M3eIconButton
            aria-label="拡大"
            disabled={scale >= 3}
            onClick={() => setScale((s) => Math.min(3, Math.round((s + 0.25) * 100) / 100))}
          >
            <M3eIcon name="zoom_in" />
          </M3eIconButton>
          <Link
            to="/works/$workId"
            params={{ workId }}
            className="fb-stage__open"
            aria-label="制作物を開く（コメント・版・情報）"
            title="制作物を開く（コメント・版・情報）"
          >
            <M3eIcon name="open_in_new" />
          </Link>
        </div>
        {artifact ? (
          <p className="fb-stage__hint">紙面で範囲を選ぶと、その場所について FB を立てられます</p>
        ) : null}
        <div className="fb-stage__viewer">{viewer()}</div>
      </section>
    </MentionProvider>
  );
}
