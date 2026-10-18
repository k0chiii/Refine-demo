import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useBlocker } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";

/** 校正画面（版の指定の有無どちらも）。この 2 つの中の移動は「制作物から離れる」に数えない */
const EDITOR_ROUTE_IDS: readonly string[] = ["/_app/works/$workId/", "/_app/works/$workId/v/$n"];

/**
 * 制作物から離れるときの「校正を完了しますか？」（利用者決定 2026-10-18）。
 * 自分に割当があり、まだ校正完了にしていないときだけ、画面の移動を止めて聞く:
 * 「完了する」= 校正完了にして移動、「あとで」= そのまま移動、閉じる／Esc = 画面に留まる。
 * 同じ制作物の版・タブの切り替え（同じ校正画面の中）では聞かない。ブラウザ標準の確認（beforeunload）は使わない。
 */
export function LeaveReviewPrompt({
  workId,
  revisionId,
  needsCompletion,
}: {
  workId: string;
  revisionId: string | null;
  /** 表示中の版に自分の割当があり、校正完了にしていない（revisions.get の can.completeReview） */
  needsCompletion: boolean;
}) {
  const complete = useMutation(api.reviews.complete);
  // 「完了する」を押したあとは、データの更新を待たずにこの訪問では聞かない
  const [completedRevisionId, setCompletedRevisionId] = useState<string | null>(null);
  const active = needsCompletion && revisionId !== null && completedRevisionId !== revisionId;

  const shouldBlockFn = useCallback(
    ({ next }: { next: { routeId: string; params: unknown } }) =>
      !(
        EDITOR_ROUTE_IDS.includes(next.routeId) &&
        (next.params as { workId?: string }).workId === workId
      ),
    [workId],
  );
  const blocker = useBlocker({
    shouldBlockFn,
    withResolver: true,
    enableBeforeUnload: false,
    disabled: !active,
  });

  const doComplete = useAction(async () => {
    if (!revisionId || blocker.status !== "blocked") return;
    const { proceed } = blocker;
    await complete({ revisionId: revisionId as Id<"revisions"> });
    setCompletedRevisionId(revisionId);
    proceed();
  });

  return (
    <M3eDialog
      open={blocker.status === "blocked"}
      closeLabel="閉じる"
      // 閉じる・Esc・外側のタップ = 画面に留まる（移動を取り消す）。ボタンで進んだあとは idle なので何もしない
      onClosed={() => blocker.status === "blocked" && blocker.reset()}
    >
      <span slot="header">校正を完了しますか？</span>
      <div slot="actions" className="row">
        <M3eButton
          variant="text"
          disabled={doComplete.pending}
          onClick={() => blocker.status === "blocked" && blocker.proceed()}
        >
          あとで
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={doComplete.pending}
          onClick={() => void doComplete.run()}
        >
          完了する
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
