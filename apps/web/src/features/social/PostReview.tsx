import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import {
  parsePostManifest,
  POST_BODY_NAME,
  postBodyArtifact,
  postImageAnchor,
  postImageArtifacts,
  postTextAnchor,
  resolvePostAnchor,
  type Anchor,
  type SocialPost,
} from "@mf100/domain";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { OverlayThread } from "@/features/annotation/AnchorOverlay";
import { fetchArtifactBlob } from "@/integrations/api";
import { useAction } from "@/lib/useAction";
import { Card } from "@/ui/Card";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eList, M3eListItem } from "@m3e/react/list";
import {
  FullscreenPreview,
  PostPreview,
  type PreviewImage,
  type PreviewView,
} from "./preview/PostPreview";
import { useWindowClass } from "@/lib/useMedia";
import { usePreviewDevice } from "./preview/DevicePicker";
import { PreviewSettings } from "./preview/PreviewSettings";
import {
  PostMarksContext,
  type PostDraftView,
  type PostImageMark,
  type PostMarksValue,
  type PostTextMark,
  type ScreenBox,
} from "./preview/postMarks";
import { makeZip } from "./zip";
import { toast } from "@/lib/toast";
import { describeError } from "@/lib/errors";

interface ArtifactLike {
  id: string;
  fileName: string;
  type: string;
}

/** 投稿欄の幅（ComposePopover の .compose-pop と同じ） */
const COMPOSE_W = 300;

/**
 * プレビューの上でコメントを付ける・開くための、Editor とのやりとり（利用者指示 2026-10-17）。
 * 位置は既存のアンカー（本文の添付の text_range・画像の添付の image_rect / image_pin）で、版の記録（提出時の本文と画像）に対する値。
 */
export interface PostAnnotate {
  /** この版のコメント・相談の位置（本文と画像のものだけがプレビューに出る） */
  threads: OverlayThread[];
  activeThreadId: string | null;
  /** コメントを開くたびに増える（同じコメントを続けて開いても、その位置へ移して強調し直す） */
  revealKey: number;
  /** 位置を選んでコメントできるか（コメント・相談を書ける版） */
  selecting: boolean;
  /** 書きかけのコメントの位置 */
  draftAnchor: Anchor | null;
  onSelectThread: (id: string) => void;
  /** 位置を選んだ（Editor が書きかけとして持つ）。null で取り消す */
  onDraft: (d: { anchor: Anchor; label: string; quote?: string } | null) => void;
  /** 投稿欄（位置は PostReview の枠の中の座標。狭い画面は画面下に固定される） */
  renderCompose: (at: { x: number; y: number }) => ReactNode;
}

/**
 * 校正画面での SNS 投稿の表示（版に記録した内容から組み立てるプレビュー）と、校了版の書き出し。
 * - 書き出しは校了した版だけ（校了前の版を投稿用と取り違えないため）
 * - 実際の投稿はしない。本文のコピー・画像の保存・まとめて ZIP
 */
export function PostReview({
  manifestArtifactId,
  artifacts,
  isFinal,
  workTitle,
  socialProfileId,
  revisionLabel,
  annotate,
}: {
  manifestArtifactId: string;
  artifacts: readonly ArtifactLike[];
  isFinal: boolean;
  workTitle: string;
  /** 制作物に割り当てた SNS アカウント（プロフィール画面の自己紹介・数字に使う） */
  socialProfileId?: string | undefined;
  revisionLabel: string;
  annotate?: PostAnnotate | undefined;
}) {
  const profiles = useQuery(api.social.list, socialProfileId ? {} : "skip");
  const profile = profiles?.find((p) => p.id === socialProfileId);
  const token = useAuthToken();
  const [post, setPost] = useState<SocialPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<Array<PreviewImage & { blob: Blob; fileName: string }>>([]);
  const device = usePreviewDevice();
  // スマホでは自分の端末の画面いっぱいに出す全画面のプレビューも選べる
  const compact = useWindowClass() === "compact";
  const [full, setFull] = useState(false);
  const [view, setView] = useState<PreviewView>("post");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [composeAt, setComposeAt] = useState<{ x: number; y: number } | null>(null);
  const bodyArt = postBodyArtifact(artifacts);
  const imageArts = useMemo(
    () => (post ? postImageArtifacts(post, artifacts) : []),
    [post, artifacts],
  );

  // コメントの位置を、提出した版の本文（文字のオフセット）と画像（元画像の正規化座標）の上の印に直す
  const marks = useMemo(() => {
    const texts: PostTextMark[] = [];
    const images: PostImageMark[] = [];
    if (!post || !annotate) return { texts, images, draft: null as PostDraftView | null };
    for (const t of annotate.threads) {
      const at = resolvePostAnchor(post, artifacts, t.anchor);
      if (!at) continue;
      const meta = {
        id: t.id,
        index: t.index,
        ...(t.kind ? { kind: t.kind } : {}),
        severity: t.severity,
      };
      if (at.kind === "text") texts.push({ ...meta, start: at.start, end: at.end });
      else
        images.push({
          ...meta,
          imageIndex: at.index,
          ...(at.rect ? { rect: at.rect } : {}),
          ...(at.point ? { point: at.point } : {}),
        });
    }
    let draft: PostDraftView | null = null;
    const d = annotate.draftAnchor
      ? resolvePostAnchor(post, artifacts, annotate.draftAnchor)
      : null;
    if (d?.kind === "text") draft = { kind: "text", start: d.start, end: d.end };
    else if (d?.kind === "image")
      draft = {
        kind: "image",
        imageIndex: d.index,
        ...(d.rect ? { rect: d.rect } : {}),
        ...(d.point ? { point: d.point } : {}),
      };
    return { texts, images, draft };
  }, [post, artifacts, annotate?.threads, annotate?.draftAnchor]);

  /**
   * 選んだ位置のそばに投稿欄を置く座標（この枠の中の座標）。端末の枠に重ねないよう、枠の右 → 左の順に空きを探し、
   * どちらにも入らなければ選んだ位置のそば（右 → 左 → 下）。狭い画面の投稿欄は画面下に固定されるので使われない
   */
  const placeCompose = useCallback((box: ScreenBox) => {
    const wrap = wrapRef.current;
    const w = wrap?.getBoundingClientRect();
    if (!wrap || !w) return;
    const frame = wrap.querySelector(".sp-frame, .sp-device")?.getBoundingClientRect();
    const area = wrap.closest(".post-review-wrap")?.getBoundingClientRect();
    const minX = Math.max(area?.left ?? 0, 0) + 8;
    const maxX = Math.min(area?.right ?? window.innerWidth, window.innerWidth) - 8;
    const rel = (x: number) => x - w.left;
    const top = box.top - w.top;
    if (frame && frame.right + 12 + COMPOSE_W <= maxX)
      return setComposeAt({ x: rel(frame.right + 12), y: top });
    if (frame && frame.left - 12 - COMPOSE_W >= minX)
      return setComposeAt({ x: rel(frame.left - 12 - COMPOSE_W), y: top });
    let x = rel(box.right + 12);
    let y = top;
    if (box.right + 12 + COMPOSE_W > maxX) x = rel(box.left - COMPOSE_W - 12);
    if (box.left - COMPOSE_W - 12 < minX && box.right + 12 + COMPOSE_W > maxX) {
      x = rel(Math.max(minX, Math.min(box.left, maxX - COMPOSE_W)));
      y = box.bottom - w.top + 8;
    }
    setComposeAt({ x, y });
  }, []);
  const marksValue: PostMarksValue | null = annotate
    ? {
        texts: marks.texts,
        images: marks.images,
        activeId: annotate.activeThreadId,
        revealKey: annotate.revealKey,
        selecting: annotate.selecting,
        draft: marks.draft,
        onOpen: annotate.onSelectThread,
        onText: (range, box) => {
          if (!post || !bodyArt) return;
          const a = postTextAnchor(bodyArt.id, post.body, range.start, range.end);
          if (!a) return;
          // 同じ範囲を選び直した（選び終えの合図が続いた）ときは、投稿欄を動かさない
          const cur = annotate.draftAnchor;
          if (cur?.type === "text_range" && cur.start === a.start && cur.end === a.end) return;
          placeCompose(box);
          annotate.onDraft({ anchor: a, label: "本文", quote: a.quote });
        },
        onImage: (index, shape, box) => {
          const art = imageArts[index];
          if (!art) return;
          const a = postImageAnchor(art.id, shape);
          if (!a) return;
          placeCompose(box);
          annotate.onDraft({ anchor: a, label: `${index + 1} 枚目の画像` });
        },
      }
    : null;
  // 端末の表示が変わっても、開いたコメントの場所が見える表示にする（プロフィール表示には本文も 2 枚目以降もない）
  useEffect(() => {
    if (!annotate?.activeThreadId || view !== "grid") return;
    if (
      marks.texts.some((t) => t.id === annotate.activeThreadId) ||
      marks.images.some((t) => t.id === annotate.activeThreadId)
    )
      setView("post");
  }, [annotate?.revealKey, annotate?.activeThreadId]);
  /** 開いたコメントの場所が、いまの表示に出ないときの案内 */
  const hiddenNote = (() => {
    if (!post || !annotate?.activeThreadId) return null;
    const id = annotate.activeThreadId;
    const story = post.platform === "instagram" && post.format === "story";
    if (story && marks.texts.some((t) => t.id === id))
      return "このコメントは本文に付いています。ストーリーズの表示には本文が出ません（本文の添付で確認できます）";
    const im = marks.images.find((t) => t.id === id);
    if (im && post.platform === "x" && im.imageIndex >= 4)
      return `このコメントは ${im.imageIndex + 1} 枚目の画像に付いています。X のプレビューは 4 枚までです`;
    return null;
  })();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      try {
        const m = parsePostManifest(
          JSON.parse(await (await fetchArtifactBlob(token, manifestArtifactId)).text()),
        );
        if (!m) throw new Error("投稿の記録を読めません");
        if (cancelled) return;
        setPost(m);
        const byName = new Map(artifacts.map((a) => [a.fileName, a]));
        const out = [];
        for (const im of m.images) {
          const a = byName.get(im.fileName);
          if (!a) continue;
          const blob = await fetchArtifactBlob(token, a.id);
          const url = URL.createObjectURL(blob);
          urls.push(url);
          const size = await new Promise<{ w: number; h: number }>((r) => {
            const img = new Image();
            img.onload = () => r({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => r({ w: 1, h: 1 });
            img.src = url;
          });
          out.push({ key: im.key, url, ...size, blob, fileName: im.fileName });
        }
        if (!cancelled) setImages(out);
      } catch (e) {
        if (!cancelled) setError(describeError(e).message);
      }
    })();
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [manifestArtifactId, token]);

  const save = (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const altText = (p: SocialPost) =>
    p.images.map((im, i) => `${i + 1}. ${im.fileName}\n${im.alt || "（未設定）"}`).join("\n\n") +
    "\n";
  const zip = useAction(async () => {
    if (!post) return;
    const enc = new TextEncoder();
    const entries = [
      { name: POST_BODY_NAME, data: enc.encode(post.body) },
      { name: "alt.txt", data: enc.encode(altText(post)) },
      {
        name: "manifest.json",
        data: enc.encode(
          JSON.stringify(
            { kind: "mf100-post-export", work: workTitle, revision: revisionLabel, ...post },
            null,
            2,
          ),
        ),
      },
      ...(await Promise.all(
        images.map(async (im) => ({
          name: `images/${im.fileName}`,
          data: new Uint8Array(await im.blob.arrayBuffer()),
        })),
      )),
    ];
    save(
      `${workTitle}-${revisionLabel}.zip`,
      new Blob([makeZip(entries) as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
    );
  });

  if (error) return <div className="alert">{error}</div>;
  if (!post) return <Loading label="投稿を読み込んでいます" />;
  return (
    <div className="post-review">
      <div className="post-preview stack">
        {/* 機種・表示の設定: 校正画面は浮遊ツールバーがあるので FAB menu ではなく、右上のボタンから menu */}
        <div className="post-preview__bar">
          <PreviewSettings
            device={device.device}
            color={device.color}
            onDevice={device.set}
            {...(post.platform === "instagram" && post.format !== "story"
              ? { view, onView: setView }
              : {})}
            {...(compact ? { onFullscreen: () => setFull(true) } : {})}
            compact={compact}
            placement="inline"
          />
        </div>
        <PostMarksContext.Provider value={marksValue}>
          <div className="post-annotate" ref={wrapRef}>
            <PostPreview
              post={post}
              images={images}
              device={device.device}
              {...(device.color ? { color: device.color } : {})}
              view={view}
              safeArea
              {...(profile ? { profile } : {})}
            />
            {annotate?.draftAnchor && composeAt ? annotate.renderCompose(composeAt) : null}
          </div>
          {full ? (
            <FullscreenPreview
              post={post}
              images={images}
              view={view}
              safeArea
              {...(profile ? { profile } : {})}
              onClose={() => setFull(false)}
            />
          ) : null}
        </PostMarksContext.Provider>
        {hiddenNote ? (
          <p className="small muted post-annotate__note" role="status">
            {hiddenNote}
          </p>
        ) : null}
        <p className="small muted">
          {annotate?.selecting
            ? "本文は文字を選ぶ、画像はドラッグ（スマホは長押し）でコメントできます"
            : "コメントを付けた本文・画像の場所が印で出ます"}
        </p>
      </div>
      <Card title="投稿用に書き出す">
        {isFinal ? (
          <div className="stack">
            <p className="small muted">校了した版の内容です。この画面から投稿はしません。</p>
            <div className="row">
              <M3eButton
                variant="tonal"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(post.body)
                    .then(() => toast("本文をコピーしました"))
                }
              >
                <M3eIcon slot="icon" name="content_copy" />
                本文をコピー
              </M3eButton>
              <M3eButton variant="filled" disabled={zip.pending} onClick={() => void zip.run()}>
                <M3eIcon slot="icon" name="folder_zip" />
                ZIP で保存
              </M3eButton>
            </div>
            <p className="small muted">ZIP には本文・画像・代替テキスト・記録をまとめます</p>
            <M3eList aria-label="画像（投稿の順）">
              {post.images.map((im, i) => {
                const a = images.find((x) => x.key === im.key);
                return (
                  <M3eListItem key={im.key}>
                    {a ? (
                      <img slot="leading" className="post-image__thumb" src={a.url} alt="" />
                    ) : null}
                    <span slot="overline">{i + 1} 枚目</span>
                    {im.fileName}
                    <span slot="supporting-text">代替テキスト: {im.alt || "未設定"}</span>
                    {a ? (
                      <M3eButton
                        slot="trailing"
                        variant="text"
                        onClick={() => save(im.fileName, a.blob)}
                      >
                        画像を保存
                      </M3eButton>
                    ) : null}
                  </M3eListItem>
                );
              })}
            </M3eList>
          </div>
        ) : (
          <p className="small muted">
            書き出しは校了した版だけでできます（校了前の版を投稿用と取り違えないため）
          </p>
        )}
      </Card>
    </div>
  );
}
