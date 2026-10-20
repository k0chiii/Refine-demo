import { useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { AttachDropZone, AttachFileButton } from "./AttachFileButton";
import { PendingCommentFiles } from "./PendingCommentFiles";
import { RichCommentField } from "./RichCommentField";
import { useCommentFileUploads } from "./useCommentFileUploads";

/** 書きかけの返信（スレッドごと。パネルを閉じる・別のスレッドを開いても、書いた本文は残す。添付は残さない） */
const drafts = new Map<string, string>();

/**
 * スレッドのパネルの下に固定する返信欄（書式つきの入力欄 + ファイルの添付）。
 * - 貼り付け・ドロップ・「ファイルを添付」で添付する（useCommentFileUploads）。圧縮・送信の途中と失敗が残るあいだは送れない
 * - 本文が空でも添付があれば送れる。送れたら欄と添付を空にする（失敗したら書きかけを残す）
 * - 書式のツールバーは書き始めたら（フォーカスしたら）出す。操作は 1 行（添付・返信）
 * - 書きかけの本文は `draftKey`（スレッドの ID）ごとに覚え、パネルを閉じて開き直しても戻す
 */
export function ReplyComposer({
  revisionId,
  id,
  draftKey,
  pending,
  onSubmit,
}: {
  revisionId: string;
  id: string;
  draftKey?: string;
  pending?: boolean;
  /** 送る。成功したら true（欄を空にする）、失敗なら false か undefined（書きかけを残す） */
  onSubmit: (body: string, mentions: string[], fileIds: string[]) => Promise<boolean | undefined>;
}) {
  const uploads = useCommentFileUploads({ revisionId, purpose: "reply" });
  const [text, setTextState] = useState(() => (draftKey ? (drafts.get(draftKey) ?? "") : ""));
  const setText = (v: string) => {
    setTextState(v);
    if (draftKey) {
      if (v.trim() === "") drafts.delete(draftKey);
      else drafts.set(draftKey, v);
    }
  };
  const [mentions, setMentions] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const canSend =
    (text.trim() !== "" || uploads.fileIds.length > 0) &&
    !uploads.busy &&
    !uploads.hasError &&
    !sending &&
    pending !== true;
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const ok = await onSubmit(text, mentions, uploads.fileIds);
      if (ok) {
        setText("");
        setMentions([]);
        setFocused(false);
        uploads.reset();
      }
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="thread__form cmt-reply" onClick={(e) => e.stopPropagation()}>
      <AttachDropZone uploads={uploads}>
        <RichCommentField
          id={`${id}-reply`}
          ariaLabel="返信"
          placeholder="返信"
          rows={2}
          toolbar={focused || text.trim() !== ""}
          value={text}
          onValue={setText}
          onMentions={setMentions}
          onFocus={() => setFocused(true)}
          onEscape={() => {
            if (text.trim() === "" && uploads.items.length === 0) setFocused(false);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
          onSubmit={() => void send()}
        />
        <PendingCommentFiles uploads={uploads} />
      </AttachDropZone>
      <div className="row thread__form-actions">
        <AttachFileButton uploads={uploads} />
        <span className="spacer" />
        <M3eButton variant="filled" disabled={!canSend} onClick={() => void send()}>
          返信
        </M3eButton>
      </div>
    </div>
  );
}
