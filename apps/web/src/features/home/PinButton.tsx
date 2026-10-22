import { api } from "@mf100/convex/api";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useAction } from "@/lib/useAction";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";

/**
 * 「ピン留め」（§36 W-26。制作物のページの「ピン留め」で絞る）。エディタのアプリバーの操作。押すたびにピン留めと解除が切り替わる（M3 icon button の toggle）。
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
    toast(next ? "ピン留めしました" : "ピン留めを外しました");
  });
  const label = pinned ? "ピン留めを外す" : "ピン留め";
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
