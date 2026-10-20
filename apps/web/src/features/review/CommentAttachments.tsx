import { useAuthToken } from "@convex-dev/auth/react";
import { artifactFormatLabel, type CommentFileView } from "@mf100/domain";
import { useEffect, useRef, useState } from "react";
import {
  downloadCommentFile,
  fetchCommentFileBlob,
  fetchCommentThumbBlob,
} from "@/integrations/api";
import { mayPersist } from "@/lib/fileCachePolicy";
import { formatBytes } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eSkeleton } from "@m3e/react/skeleton";
import "./CommentAttachments.css";

/**
 * コメント・返信の添付の表示。
 * - 画像: サムネイルの格子。画面に近づいたものだけを取りに行く（IntersectionObserver）。サムネイルは添付と同じ端末の写し
 *   （Cache Storage。機密の制作物は残さない）から開く。押すと拡大（原本を取得）。
 * - それ以外: ファイルのチップ（アイコン・名前・大きさ）。押すと保存する。
 * 説明の文は出さない。サーバーが返す files（id・name・mime・size・width・height・hasThumb）をそのまま渡す。
 */

export type { CommentFileView };

/** サムネイルが無い画像を原本で代わりに出してよい大きさ（これを超えるものは取りに行かず、アイコンのまま） */
const FALLBACK_ORIGINAL_MAX_BYTES = 1_500_000;
/** 画面の手前この距離に入ったら取りに行く */
const PRELOAD_MARGIN = "240px";

export interface CommentAttachmentsProps {
  files: readonly CommentFileView[];
  /** 制作物の機密区分。機密（restricted）や不明のときは端末に残さない（メモリだけ） */
  confidentiality?: "normal" | "restricted" | undefined;
  className?: string;
}

/** 一度でも画面（の近く）に入ったか。入ったら監視をやめる */
function useSeen<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(
    typeof IntersectionObserver === "undefined", // 使えない環境では最初から取りに行く
  );
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/** 添付の絵（object URL）。取りに行くのは見えてから。消えたら URL を破棄する */
function useImageUrl(
  file: CommentFileView,
  enabled: boolean,
  persist: boolean,
  variant: "thumb" | "original",
) {
  const token = useAuthToken();
  // トークンは更新されるが、取得のやり直しはしない（最新の値だけ読む）
  const latest = useRef(token);
  latest.current = token;
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });
  const ready = Boolean(token);
  useEffect(() => {
    const t = latest.current;
    if (!enabled || !ready || !t) return;
    let cancelled = false;
    let made: string | null = null;
    const blob =
      variant === "thumb"
        ? fetchCommentThumbBlob(t, file.id, { persist })
        : fetchCommentFileBlob(t, file.id, { persist });
    blob
      .then((b) => {
        if (cancelled) return;
        made = URL.createObjectURL(b);
        setState({ url: made, failed: false });
      })
      .catch(() => !cancelled && setState({ url: null, failed: true }));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [enabled, ready, file.id, persist, variant]);
  return state;
}

/** 画像のタイル（サムネイル。無い画像は小さければ原本で代える） */
function ImageTile({
  file,
  persist,
  single,
  onOpen,
}: {
  file: CommentFileView;
  persist: boolean;
  single: boolean;
  onOpen: (file: CommentFileView) => void;
}) {
  const [ref, seen] = useSeen<HTMLButtonElement>();
  const canFallback = file.hasThumb || file.size <= FALLBACK_ORIGINAL_MAX_BYTES;
  const { url, failed } = useImageUrl(
    file,
    seen && canFallback,
    persist,
    file.hasThumb ? "thumb" : "original",
  );
  // 枠は読み込む前から決める（届いても位置がずれない）。画面に出す縦横比は 3:4〜2:1 に収める
  const ratio =
    file.width && file.height ? Math.min(2, Math.max(0.75, file.width / file.height)) : 4 / 3;
  return (
    <button
      ref={ref}
      type="button"
      className={single ? "cmt-files__tile cmt-files__tile--single" : "cmt-files__tile"}
      style={single ? { aspectRatio: String(ratio) } : undefined}
      aria-label={file.name}
      onClick={() => onOpen(file)}
    >
      {url ? (
        <img src={url} alt="" width={file.width} height={file.height} decoding="async" />
      ) : failed || !canFallback ? (
        <M3eIcon name="image" aria-hidden="true" />
      ) : (
        <M3eSkeleton shape="square" aria-hidden="true">
          <span className="cmt-files__loading" />
        </M3eSkeleton>
      )}
    </button>
  );
}

/** 拡大表示（原本を取得する。取得中はサムネイルが出ていればそれを見せる） */
function Lightbox({
  file,
  persist,
  onClosed,
}: {
  file: CommentFileView | null;
  persist: boolean;
  onClosed: () => void;
}) {
  const token = useAuthToken();
  const download = useAction(async (f: CommentFileView) => {
    if (token) await downloadCommentFile(token, f.id, f.name);
  });
  const shown = file;
  const original = useImageUrl(shown ?? PLACEHOLDER, shown !== null, persist, "original");
  const thumb = useImageUrl(
    shown ?? PLACEHOLDER,
    shown !== null && shown.hasThumb,
    persist,
    "thumb",
  );
  const src = original.url ?? thumb.url;
  return (
    <M3eDialog
      open={shown !== null}
      onClosed={onClosed}
      closeLabel="閉じる"
      className="dialog--full cmt-files__dialog"
    >
      <span slot="header">{shown?.name}</span>
      <div className="dialog-body">
        {src ? (
          <img
            src={src}
            alt={shown?.name ?? ""}
            className={original.url ? undefined : "cmt-files__preview"}
          />
        ) : original.failed ? (
          <M3eIcon name="image" aria-hidden="true" />
        ) : null}
      </div>
      <div slot="actions">
        <M3eIconButton
          aria-label={shown ? `${shown.name} をダウンロード` : "ダウンロード"}
          disabled={!shown}
          onClick={() => shown && void download.run(shown)}
        >
          <M3eIcon name="download" />
        </M3eIconButton>
      </div>
    </M3eDialog>
  );
}

const PLACEHOLDER: CommentFileView = {
  id: "",
  name: "",
  mime: "",
  size: 0,
  type: "image",
  hasThumb: false,
};

const iconFor = (type: CommentFileView["type"]) =>
  type === "pdf" ? "picture_as_pdf" : type === "document" ? "article" : "draft";

export function CommentAttachments({ files, confidentiality, className }: CommentAttachmentsProps) {
  const token = useAuthToken();
  const [open, setOpen] = useState<CommentFileView | null>(null);
  const persist = mayPersist(confidentiality);
  const download = useAction(async (f: CommentFileView) => {
    if (token) await downloadCommentFile(token, f.id, f.name);
  });
  if (files.length === 0) return null;
  const images = files.filter((f) => f.type === "image");
  const others = files.filter((f) => f.type !== "image");
  return (
    <div className={className ? `cmt-files ${className}` : "cmt-files"}>
      {images.length > 0 ? (
        <div
          className={
            images.length === 1 ? "cmt-files__grid cmt-files__grid--one" : "cmt-files__grid"
          }
        >
          {images.map((f) => (
            <ImageTile
              key={f.id}
              file={f}
              persist={persist}
              single={images.length === 1}
              onOpen={setOpen}
            />
          ))}
        </div>
      ) : null}
      {others.map((f) => (
        <button
          key={f.id}
          type="button"
          className="cmt-files__chip"
          aria-label={`${f.name} をダウンロード`}
          onClick={() => void download.run(f)}
        >
          <M3eIcon name={iconFor(f.type)} aria-hidden="true" />
          <span className="cmt-files__name">{f.name}</span>
          <span className="cmt-files__meta">
            {artifactFormatLabel({ type: f.type, fileName: f.name })}・{formatBytes(f.size)}
          </span>
        </button>
      ))}
      {images.length > 0 ? (
        <Lightbox file={open} persist={persist} onClosed={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
