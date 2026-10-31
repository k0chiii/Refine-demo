import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation } from "convex/react";
import { useState } from "react";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { UserPicker } from "@/ui/UserPicker";
import { M3eButton } from "@m3e/react/button";

export function ReviewersDialog({
  workId,
  title,
  initialIds,
  onClose,
}: {
  workId: string;
  title: string;
  initialIds: readonly string[];
  onClose: () => void;
}) {
  const setReviewers = useMutation(api.reviews.setReviewers);
  const [ids, setIds] = useState<string[]>([...initialIds]);
  const { run, pending } = useAction(async () => {
    await setReviewers({
      workId: workId as Id<"works">,
      reviewerIds: ids as Id<"users">[],
    });
    onClose();
  });
  return (
    <M3eDialog open onClosed={onClose} closeLabel="閉じる">
      <span slot="header">校正者を選ぶ</span>
      <div className="dialog-body">
        <p className="muted small" style={{ margin: 0 }}>
          {title}
        </p>
        <UserPicker label="校正者" groups value={ids} onChange={setIds} />
        <p className="muted small">いまの版から反映します</p>
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton variant="filled" disabled={pending} onClick={() => void run()}>
          保存
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
