import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eCircularProgressIndicator } from "@m3e/react/progress-indicator";
import type { AttachmentItem, CommentFileUploads } from "./useCommentFileUploads";
import "./CommentAttachments.css";

/**
 * 投稿欄に並ぶ、これから添える添付（useCommentFileUploads の items）。
 * 絵（画像はサムネイル）・名前・取り除くボタン。圧縮・準備・送信の間は丸い進み具合が重なり、失敗したものは押すとやり直す。
 * 説明の文は出さない（失敗の理由はトーストで知らせている）。
 */

const iconFor = (type: AttachmentItem["type"]) =>
  type === "image"
    ? "image"
    : type === "pdf"
      ? "picture_as_pdf"
      : type === "document"
        ? "article"
        : "draft";

export function PendingCommentFiles({ uploads }: { uploads: CommentFileUploads }) {
  if (uploads.items.length === 0) return null;
  return (
    <div className="cmt-pending">
      {uploads.items.map((item) => {
        const working = item.phase !== "done" && item.phase !== "error";
        return (
          <div
            key={item.key}
            className={
              item.phase === "error"
                ? "cmt-pending__item cmt-pending__item--error"
                : "cmt-pending__item"
            }
          >
            <div className="cmt-pending__thumb">
              {item.previewUrl ? (
                <img src={item.previewUrl} alt="" />
              ) : (
                <M3eIcon name={iconFor(item.type)} aria-hidden="true" />
              )}
              {working ? (
                <div className="cmt-pending__progress">
                  {item.phase === "uploading" ? (
                    <M3eCircularProgressIndicator
                      value={Math.round(item.progress * 100)}
                      aria-label={item.name}
                    />
                  ) : (
                    <M3eCircularProgressIndicator indeterminate aria-label={item.name} />
                  )}
                </div>
              ) : null}
            </div>
            <span className="cmt-pending__name">{item.name}</span>
            {item.phase === "error" ? (
              <M3eIconButton
                aria-label={`${item.name} をやり直す`}
                onClick={() => uploads.retry(item.key)}
              >
                <M3eIcon name="refresh" />
              </M3eIconButton>
            ) : null}
            <M3eIconButton
              aria-label={`${item.name} を取り除く`}
              onClick={() => uploads.remove(item.key)}
            >
              <M3eIcon name="close" />
            </M3eIconButton>
          </div>
        );
      })}
    </div>
  );
}
