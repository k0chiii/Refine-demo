import { api } from "@mf100/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { toast } from "@/lib/toast";
import { useAction } from "@/lib/useAction";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";

/**
 * 「ホームにピン留め」（§36 W-26）。エディタのアプリバーの操作。押すたびにピン留めと解除が切り替わる（M3 icon button の toggle）。
 */
export function PinButton({ workId }: { workId: string }) {
  const pinned = useQuery(api.home.pinned, { workId });
  const setPinned = useMutation(api.home.setPinned);
  const toggle = useAction(async () => {
    const next = !pinned;
    await setPinned({ workId, pinned: next });
    toast(next ? "ホームにピン留めしました" : "ホームのピン留めを外しました");
  });
  const label = pinned ? "ホームのピン留めを外す" : "ホームにピン留め";
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

/** エディタを開いたら「最近開いた制作物」に記録する。見られない制作物などで失敗しても知らせない（表示の補助のため） */
export function useRecordOpened(workId: string) {
  const record = useMutation(api.home.recordOpened);
  useEffect(() => {
    record({ workId }).catch(() => undefined);
  }, [workId]);
}
