import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { draftFormatLabels, emptyPost, postManifest, type DraftFormat } from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { describeError } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";

const editorPath = {
  document: "/works/$workId/write",
  post: "/works/$workId/post",
} as const;
const editorLabel: Record<DraftFormat, string> = {
  document: "文章エディタで開く",
  post: "投稿エディタで開く",
};
const editorIcon: Record<DraftFormat, string> = { document: "edit_document", post: "post_add" };
/** 開いたエディタが合わないときの説明（expected = この制作物に合う形式） */
const mismatchText: Record<DraftFormat, string> = {
  document: "この制作物は文章エディタで書きます",
  post: "この制作物は投稿エディタで書きます",
};

/**
 * 制作物の媒体に合わないエディタで開いたとき（`/works/:id/write` と `/works/:id/post` の取り違え）。
 * 編集させずに M3 の空の状態で、合うエディタへ案内する（誤ったエディタの自動保存で原稿を上書きしないため）。
 */
export function EditorMediaMismatch({
  workId,
  workTitle,
  expected,
}: {
  workId: string;
  workTitle: string;
  /** この制作物に合う下書きの形式 */
  expected: DraftFormat;
}) {
  const navigate = useNavigate();
  return (
    <div className="empty editor-mismatch" role="status">
      <AppBarSlot slot="title">{workTitle}</AppBarSlot>
      <M3eIcon name={editorIcon[expected]} />
      <p>{mismatchText[expected]}</p>
      <div className="row">
        <M3eButton
          variant="filled"
          onClick={() => void navigate({ to: editorPath[expected], params: { workId } })}
        >
          <M3eIcon slot="icon" name={editorIcon[expected]} />
          {editorLabel[expected]}
        </M3eButton>
        <M3eButton
          variant="text"
          onClick={() => void navigate({ to: "/works/$workId", params: { workId } })}
        >
          制作物に戻る
        </M3eButton>
      </div>
    </div>
  );
}

/**
 * 保存済みの下書きが別の形式のとき（制作物の媒体を後から変えた場合など）。
 * 通常の保存では形式を変えない（サーバーが document_format_mismatch で止める）ので、
 * 置き換えは利用者がこの画面で明示的に選ぶ操作にする。
 */
export function DraftFormatMismatch({
  workId,
  workTitle,
  expected,
  stored,
  draftVersion,
  canEdit,
}: {
  workId: string;
  workTitle: string;
  expected: DraftFormat;
  stored: DraftFormat;
  draftVersion: number;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const save = useMutation(api.documents.save);
  const [busy, setBusy] = useState(false);
  const replace = async () => {
    setBusy(true);
    try {
      await save({
        workId: workId as Id<"works">,
        title: workTitle,
        content:
          expected === "post"
            ? postManifest(emptyPost())
            : JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
        text: "",
        baseVersion: draftVersion,
        replaceFormat: true,
      });
    } catch (e) {
      toast(describeError(e).message, { kind: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="empty editor-mismatch" role="status">
      <AppBarSlot slot="title">{workTitle}</AppBarSlot>
      <M3eIcon name="warning" />
      <p>
        {draftFormatLabels[stored]}の下書きがあります。{draftFormatLabels[expected]}
        で書き始めると置き換わります
      </p>
      <div className="row">
        {canEdit ? (
          <M3eButton variant="filled" disabled={busy} onClick={() => void replace()}>
            <M3eIcon slot="icon" name={editorIcon[expected]} />
            下書きを置き換えて書き始める
          </M3eButton>
        ) : null}
        <M3eButton
          variant="text"
          onClick={() => void navigate({ to: "/works/$workId", params: { workId } })}
        >
          制作物に戻る
        </M3eButton>
      </div>
    </div>
  );
}
