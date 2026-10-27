import { api } from "@mf100/convex/api";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useAction } from "@/lib/useAction";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";

/**
 * 「ピン留め」（§36 W-26）。エディタのアプリバーの操作。押すたびにピン留めと解除が切り替わる（M3 icon button の toggle）。
 * ピン留めは制作物の購読を兼ねる（利用者決定 2026-10-27）: 新しい版の通知が届き、校正の入口の「ピン留め」と制作物のページの絞り込みに出る。
 */
export function PinButton({ workId }: { workId: string }) {
  const pinned = useQuery(api.home.pinned, { workId });
  const setPinned = useMutation(api.home.setPinned).withOptimisticUpdate((store, args) => {
    if (store.getQuery(api.home.pinned, { workId: args.workId }) !== undefined)
      store.setQuery(api.home.pinned, { workId: args.workId }, args.pinned);
  });
  const toggle = useAction(async () => {
    const next = !pinned;
    await setPinned({ workId, pinned: next });
    toast(
      next ? "ピン留めしました。新しい版の通知が届き、校正の一覧に出ます" : "ピン留めを外しました",
    );
  });
  const label = pinned ? "ピン留めを外す" : "ピン留め（版の通知と校正の一覧）";
  return (
    <M3eIconButton
      toggle
      selected={pinned === true}
      aria-label={label}
      title={label}
      disabled={pinned === undefined || toggle.pending}
      onClick={() => void toggle.run()}
    >
      <M3eIcon name="push_pin" />
      <M3eIcon slot="selected" name="push_pin" className="icon--filled" />
    </M3eIconButton>
  );
}
