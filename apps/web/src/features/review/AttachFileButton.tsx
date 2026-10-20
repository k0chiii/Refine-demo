import { type ReactNode, useRef, useState } from "react";
import { dragHasFiles } from "@/lib/attachmentQueue";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import type { CommentFileUploads } from "./useCommentFileUploads";

/**
 * 投稿欄の「ファイルを添付」ボタン（M3E のアイコンボタン + 隠した input）。選んだファイルは useCommentFileUploads に渡す。
 * 上限（10 件）に達したら押せない。説明の文は置かない。
 */
export function AttachFileButton({
  uploads,
  disabled,
}: {
  uploads: CommentFileUploads;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <M3eIconButton
        aria-label="ファイルを添付"
        className="cmt-attach"
        disabled={disabled === true || uploads.full}
        onClick={() => input.current?.click()}
      >
        <M3eIcon name="attach_file" />
      </M3eIconButton>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          // add は渡された FileList をその場で配列にする。取り出してから空にすれば、同じファイルを続けて選べる
          uploads.add(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

/**
 * 投稿欄を包み、貼り付け・ドロップでファイルを受ける（useCommentFileUploads の bind）。
 * 書式つきの入力欄（ProseMirror）より先に受けるので capture で受け、ファイルだけの貼り付け・ドロップのときに取り込む
 * （文字を貼る・文字をドラッグするのは今までどおり入力欄に任せる）。ファイルを乗せている間は枠の色で示す。
 */
export function AttachDropZone({
  uploads,
  enabled = true,
  className,
  children,
}: {
  uploads: CommentFileUploads;
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  if (!enabled) return <div className={className}>{children}</div>;
  return (
    <div
      className={`${className ?? ""} cmt-drop ${over ? "cmt-drop--over" : ""}`}
      onPasteCapture={uploads.bind.onPaste}
      onDragOverCapture={uploads.bind.onDragOver}
      onDragEnterCapture={(e) => {
        if (!dragHasFiles(e.dataTransfer.types)) return;
        depth.current++;
        setOver(true);
      }}
      onDragLeaveCapture={(e) => {
        if (!dragHasFiles(e.dataTransfer.types)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDropCapture={(e) => {
        depth.current = 0;
        setOver(false);
        uploads.bind.onDrop(e);
      }}
    >
      {children}
    </div>
  );
}
