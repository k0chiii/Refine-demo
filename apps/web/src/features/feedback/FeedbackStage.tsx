import { api } from "@mf100/convex/api";
import { pickReviewArtifact, type Anchor } from "@mf100/domain";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import type { OverlayThread } from "@/features/annotation/AnchorOverlay";
import { anchorPage } from "@/features/annotation/anchorPage";
import { ImageViewer } from "@/features/annotation/ImageViewer";
// 大きなビューア（PDF.js・TipTap・動画）はその添付を開くまで読み込まない
import {
  PdfViewer,
  preloadViewers,
  RichTextViewer,
  VideoViewer,
} from "@/features/annotation/lazyViewers";
import { TextViewer } from "@/features/annotation/TextViewer";
import { useArtifactBlob } from "@/features/annotation/useArtifactBlob";
import { documentView } from "@/features/writing/documentView";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";
import type { FeedbackThreadSummary } from "./FeedbackPane";

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
 * 紙面は見るだけで、範囲を選んで新しい FB は立てない（利用者指示 2026-10-16。範囲の FB は制作物を開いて立てる）。
 * 見る版は親が決める（開いたスレッドの版、無ければ最新の版）。版・添付・ページ・倍率は上の細い操作の行で変える。
 */
export function FeedbackStage({
  workId,
  revisionId,
  onRevision,
  threads,
  activeId,
  onSelectThread,
  focus,
}: {
  workId: string;
  revisionId: string | null;
  onRevision: (revisionId: string) => void;
  threads: FeedbackThreadSummary[] | undefined;
  activeId: string | null;
  onSelectThread: (id: string) => void;
  /** 見せたい場所（スレッドの「紙面の場所を表示」）。変わるたびにその添付・ページへ送る */
  focus: { anchor: Anchor; at: number } | null;
}) {
  const work = useQuery(api.works.get, { workId });
  const revisions = useMemo(
    () => (work?.revisions ?? []).filter((r) => r.reviewState !== "void"),
    [work],
  );
  const shownId = revisionId ?? null;
  // 媒体が分かったら紙面のビューアを版・ファイルの取得と並行して読み込み始める（Editor と同じ）
  const mediaType = work?.work.mediaType;
  useEffect(() => {
    if (mediaType) preloadViewers(mediaType);
  }, [mediaType]);
  const dataRaw = useQuery(api.revisions.get, shownId ? { revisionId: shownId } : "skip");
  const data = dataRaw && dataRaw.revision.id === shownId ? dataRaw : undefined;
  /** 利用者が選んだ添付（選んでいなければ、版の既定の添付。下の artifactId） */
  const [pickedId, setArtifactId] = useState<string | null>(null);
  /** 最初の 1 枚を描き終えた添付（PDF・画像・動画のビューアが知らせる。下の paperDone） */
  const [paintedFor, setPaintedFor] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(1);
  const [videoSeek, setVideoSeek] = useState<{ t: number; key: number } | null>(null);

  // 紙面に出す添付。選んでいなければ PDF → 画像 → 文章。state に写さず描画のなかで決める（写すと、版が届いてから 1 回余計に描かれ、
  // 「添付がありません」が一瞬出ていた。docs/UI_M3E.md §61）
  const artifactId: string | null = data
    ? pickedId && data.artifacts.some((a) => a.id === pickedId)
      ? pickedId
      : (pickReviewArtifact(data.artifacts, data.work.mediaType === "video" ? "video" : undefined)
          ?.id ?? null)
    : null;
  // 版が変わったら、選んだ添付を外して先頭のページから
  useEffect(() => {
    setPage(1);
    setArtifactId(null);
  }, [data?.revision.id]);
  // 見せたい場所へ送る
  useEffect(() => {
    if (!focus) return;
    if (focus.anchor.artifactId !== artifactId) setArtifactId(focus.anchor.artifactId);
    const p = anchorPage(focus.anchor);
    if (p) setPage(p);
    if (focus.anchor.type === "video_time") setVideoSeek({ t: focus.anchor.start, key: focus.at });
  }, [focus?.at]);

  const artifact = data?.artifacts.find((a) => a.id === artifactId) ?? null;
  const blob = useArtifactBlob(artifact && artifact.role !== "external" ? artifact.id : null);
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

  // FB タブの紙面は見るだけ（範囲を選んで新しい FB は立てない。利用者指示 2026-10-16）。印を押すとそのスレッドを開く
  const viewerProps = {
    threads: overlay,
    activeThreadId: activeId,
    onSelectThread,
    selecting: false,
    draft: null,
    onDraft: () => undefined,
  };

  /** 紙面を出してよいか（中身が決まり、PDF・画像・動画は最初の 1 枚を描き終えた） */
  const paperDone = (() => {
    if (work === undefined) return false;
    if (!shownId) return true;
    if (!data) return false;
    if (!artifact) return true;
    if (blob.error) return true;
    if (!blob.blob) return false;
    if (artifact.type === "document") return text?.artifactId === artifact.id;
    if (
      artifact.type === "pdf" ||
      ((artifact.type === "image" || artifact.type === "video") && blob.url)
    )
      return paintedFor === artifact.id;
    return true;
  })();
  const pending = !paperDone;
  // 描き終わりの通知が届かなくても、ファイルが届いてから一定時間で出す（指標のまま止めない）
  useEffect(() => {
    if (!pending || !artifact || !blob.blob) return;
    const id = window.setTimeout(() => setPaintedFor(artifact.id), 8000);
    return () => window.clearTimeout(id);
  }, [pending, artifact?.id, blob.blob]);

  // 読み込みの途中（制作物・版・ファイル・ビューア・最初の描画）は何も出さない。指標は紙面の上にひとつだけ置き、終わったら一度に出す
  const viewer = (): ReactNode => {
    if (work === undefined) return null;
    if (!shownId)
      return (
        <div className="empty fb-stage__empty">
          <M3eIcon name="draft" />
          まだ版がありません。制作物全体についてのスレッドは右から立てられます
        </div>
      );
    if (!data) return null;
    if (!artifact)
      return <div className="empty fb-stage__empty">この版には紙面に出せる添付がありません</div>;
    if (blob.error) return <div className="alert">{blob.error}</div>;
    if (!blob.blob) return null;
    if (artifact.type === "pdf")
      return (
        <PdfViewer
          blob={blob.blob}
          artifactId={artifact.id}
          {...viewerProps}
          page={page}
          onPageChange={setPage}
          scale={scale}
          rotation={0}
          onPageCount={setPageCount}
          onReady={() => setPaintedFor(artifact.id)}
        />
      );
    if (artifact.type === "image" && blob.url)
      return (
        <ImageViewer
          url={blob.url}
          artifactId={artifact.id}
          alt={`${data.revision.label}の添付「${artifact.fileName}」`}
          {...viewerProps}
          scale={scale}
          onReady={() => setPaintedFor(artifact.id)}
        />
      );
    if (artifact.type === "document" && text?.artifactId === artifact.id) {
      return text.html !== undefined ? (
        <RichTextViewer html={text.html} scale={scale} artifactId={artifact.id} {...viewerProps} />
      ) : (
        <TextViewer text={text.body} scale={scale} artifactId={artifact.id} {...viewerProps} />
      );
    }
    if (artifact.type === "document") return null;
    if (artifact.type === "video" && blob.url)
      return (
        <VideoViewer
          url={blob.url}
          artifactId={artifact.id}
          label={`${data.revision.label}の添付「${artifact.fileName}」`}
          {...viewerProps}
          seekRequest={videoSeek}
          onReady={() => setPaintedFor(artifact.id)}
        />
      );
    return (
      <div className="empty fb-stage__empty">
        この形式は紙面に出せません（ダウンロードして確認）
      </div>
    );
  };

  const shown = revisions.find((r) => r.id === shownId) ?? null;
  const reviewable = (data?.artifacts ?? []).filter((a) => a.role !== "external");
  return (
    <>
      <section className={`fb-stage ${pending ? "fb-stage--pending" : ""}`} aria-label="紙面">
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
          {/* 動画は画面に合わせて出すので拡大縮小しない */}
          {artifact?.type === "video" ? null : (
            <>
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
            </>
          )}
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
        <div className="fb-stage__viewer">
          {pending ? (
            <Loading label="制作物を読み込んでいます" className="fb-stage__loading" />
          ) : null}
          <Suspense fallback={null}>{viewer()}</Suspense>
        </div>
      </section>
    </>
  );
}
