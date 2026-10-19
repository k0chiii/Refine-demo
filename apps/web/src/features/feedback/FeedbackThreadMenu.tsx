import { api } from "@mf100/convex/api";
import { useMutation } from "convex/react";
import { useState } from "react";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";

/**
 * FB スレッドの見出しの ⋮。サーバーが can.delete（システム管理者）を返したときだけ出す（利用者指示 2026-10-19）。
 * 消したスレッドは投稿ごと一覧・画面から消える（元に戻せない）。消したら onDeleted で一覧へ戻す。
 */
export function FeedbackThreadMenu({
  threadId,
  canDelete,
  onDeleted,
}: {
  threadId: string;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const remove = useMutation(api.feedback.deleteThread);
  const [confirm, setConfirm] = useState(false);
  const doDelete = useAction(async () => {
    await remove({ threadId });
    setConfirm(false);
    onDeleted();
  });
  if (!canDelete) return null;
  const menuId = `fb-thread-menu-${threadId}`;
  return (
    <>
      <M3eIconButton aria-label="スレッドの操作" title="スレッドの操作">
        <M3eIcon name="more_vert" />
        <M3eMenuTrigger htmlFor={menuId} />
      </M3eIconButton>
      <M3eMenu id={menuId} positionX="before">
        <M3eMenuItem onClick={() => setConfirm(true)}>
          <M3eIcon slot="icon" name="delete" />
          スレッドを削除
        </M3eMenuItem>
      </M3eMenu>
      <M3eDialog open={confirm} onClosed={() => setConfirm(false)} closeLabel="閉じる">
        <span slot="header">スレッドを削除しますか？</span>
        <div className="dialog-body">
          <p>投稿ごと一覧と画面から消えます。元に戻せません</p>
        </div>
        <div slot="actions" className="row">
          <span className="spacer" />
          <M3eButton variant="text" onClick={() => setConfirm(false)}>
            キャンセル
          </M3eButton>
          <M3eButton variant="text" disabled={doDelete.pending} onClick={() => void doDelete.run()}>
            削除
          </M3eButton>
        </div>
      </M3eDialog>
    </>
  );
}
