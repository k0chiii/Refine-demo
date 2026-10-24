import { formatJstShort } from "@/lib/format";
import { UserAvatar } from "@/ui/UserAvatar";
import { M3eCard } from "@m3e/react/card";
import { M3eIcon } from "@m3e/react/icon";
import { CommentBody, plainToMarkdown } from "./CommentBody";
import "./ThreadPanel.css";

export interface CreatorNote {
  /** 版の名前（「第1版」など） */
  label: string;
  /** 提出のときに制作者が書いた「この案の意図／変更した点とその理由」 */
  changeSummary: string;
  /** 「今回見てほしい点／まだ見てほしい点」 */
  focusNotes: string;
  submittedAt: number;
  submittedBy: string;
  submitter?: { name: string; email: string | null } | undefined;
}

/** 出すものがあるか（どちらも空なら出さない） */
export function hasCreatorNote(note: Pick<CreatorNote, "changeSummary" | "focusNotes">): boolean {
  return note.changeSummary.trim() !== "" || note.focusNotes.trim() !== "";
}

/**
 * 制作者からのコメント（版を提出したときの「意図・変更した点」と「見てほしい点」）を、校正のコメントと同じ一覧の先頭に、
 * 位置なしのコメントとして置く（利用者 QA 2026-10-24「制作者コメントは校正コメントと並列で置かれててほしい。
 * ピン留めされてるみたいな表示」。それまでは情報タブの「観点」の行だった）。
 * 校正のコメントと同じカード（M3E filled card。ThreadCard と同じ組み）で、押しても選ばない・返信も採否もない。
 * 先頭に留めている印（push_pin）を付ける。本文は提出のダイアログの平文なので、コメントと同じ書式（plainToMarkdown）で描く
 */
export function CreatorNoteCard({ note }: { note: CreatorNote }) {
  const name = note.submitter?.name ?? "制作者";
  return (
    <M3eCard
      variant="filled"
      className="thread thread--compact thread--note"
      aria-label={`制作者からのコメント ${name}`}
      data-creator-note
    >
      <div slot="content" className="thread__content">
        <div className="thread__head">
          <UserAvatar
            seed={note.submitter?.email ?? note.submittedBy}
            userId={note.submittedBy}
            size={28}
          />
          <div className="thread__who">
            <span className="thread__name">{name}</span>
            <span className="thread__time">
              {note.label}を提出・{formatJstShort(note.submittedAt)}
            </span>
          </div>
          <span className="spacer" />
          <span className="thread__pinned" title="制作者からのコメント（先頭に留めています）">
            <M3eIcon name="push_pin" aria-hidden="true" />
            <span className="sr-only">先頭に留めています</span>
          </span>
        </div>
        {note.changeSummary.trim() ? (
          <CommentBody
            className="thread__body"
            body={plainToMarkdown(note.changeSummary)}
            format="markdown"
          />
        ) : null}
        {note.focusNotes.trim() ? (
          <div className="thread__note-focus">
            <span className="thread__note-label">見てほしい点</span>
            <CommentBody
              className="thread__body"
              body={plainToMarkdown(note.focusNotes)}
              format="markdown"
            />
          </div>
        ) : null}
      </div>
    </M3eCard>
  );
}
