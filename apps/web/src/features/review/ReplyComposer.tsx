import { useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { AttachDropZone, AttachFileButton } from "./AttachFileButton";
import { PendingCommentFiles } from "./PendingCommentFiles";
import { RichCommentField } from "./RichCommentField";
import { useCommentFileUploads } from "./useCommentFileUploads";

/**
 * コメントへの返信欄（書式つきの入力欄 + ファイルの添付）。コメントのカード・スレッドのパネルで同じものを使う。
 * - 貼り付け・ドロップ・「ファイルを添付」で添付する（useCommentFileUploads）。圧縮・送信の途中と失敗が残るあいだは送れない
 * - 本文が空でも添付があれば送れる。送れたら欄と添付を空にする（失敗したら書きかけを残す）
 * - `panel`: スレッドのパネルの下に固定する形。欄は常に開き、操作は 1 行（添付・返信）
 */
export function ReplyComposer({
  revisionId,
  id,
  pending,
  panel = false,
  autoFocus,
  onSubmit,
}: {
  revisionId: string;
  id: string;
  pending?: boolean;
  panel?: boolean;
  autoFocus?: boolean;
  /** 送る。成功したら true（欄を空にする）、失敗なら false か undefined（書きかけを残す） */
  onSubmit: (body: string, mentions: string[], fileIds: string[]) => Promise<boolean | undefined>;
}) {
  const uploads = useCommentFileUploads({ revisionId, purpose: "reply" });
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const hasFiles = uploads.items.length > 0;
  const open = panel || focused || text.trim() !== "" || hasFiles;
  const canSend =
    (text.trim() !== "" || uploads.fileIds.length > 0) &&
    !uploads.busy &&
    !uploads.hasError &&
    !sending &&
    pending !== true;
  const clear = () => {
    setText("");
    setMentions([]);
    setFocused(false);
    uploads.reset();
  };
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const ok = await onSubmit(text, mentions, uploads.fileIds);
      if (ok) clear();
    } finally {
      setSending(false);
    }
  };
  return (
    <div
      className={`thread__form cmt-reply ${panel ? "cmt-reply--panel" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <AttachDropZone uploads={uploads}>
        <RichCommentField
          id={`${id}-reply`}
          ariaLabel="返信"
          placeholder="返信"
          rows={panel ? 2 : open ? 3 : 1}
          toolbar={open}
          {...(autoFocus ? { autoFocus: true } : {})}
          value={text}
          onValue={setText}
          onMentions={setMentions}
          onFocus={() => setFocused(true)}
          onEscape={() => {
            if (text.trim() === "" && !hasFiles) setFocused(false);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
          onSubmit={() => void send()}
        />
        <PendingCommentFiles uploads={uploads} />
      </AttachDropZone>
      {open ? (
        <div className="row thread__form-actions">
          <AttachFileButton uploads={uploads} />
          <span className="spacer" />
          {panel ? null : (
            <M3eButton variant="text" onClick={clear}>
              キャンセル
            </M3eButton>
          )}
          <M3eButton variant="filled" disabled={!canSend} onClick={() => void send()}>
            返信
          </M3eButton>
        </div>
      ) : null}
    </div>
  );
}
