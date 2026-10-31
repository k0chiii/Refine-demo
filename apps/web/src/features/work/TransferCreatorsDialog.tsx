import { api } from "@mf100/convex/api";
import { approvalSetupOf } from "@mf100/domain";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { UserPicker } from "@/ui/UserPicker";
import { withoutCreatorsAsApprovers } from "./approverSelection";
import { type WorkFormState } from "./WorkForm";
import type { FunctionReturnType } from "convex/server";

type Work = FunctionReturnType<typeof api.works.get>["work"];

/**
 * 制作者だけを変える（利用者要望 2026-10-30 / 決定 94）。統括・校了する人・システム管理者が使える。
 */
export function TransferCreatorsDialog({
  work,
  open,
  onClose,
}: {
  work: Work;
  open: boolean;
  onClose: () => void;
}) {
  const update = useMutation(api.works.update);
  const [creatorIds, setCreatorIds] = useState<string[]>(() => [...work.creatorIds]);
  useEffect(() => {
    if (!open) return;
    setCreatorIds([...work.creatorIds]);
  }, [open, work.id, work.version]);

  const approverIds = approvalSetupOf(work).approverIds;
  const form: Pick<WorkFormState, "creatorIds" | "approverIds" | "approvalQuorum"> = {
    creatorIds,
    approverIds: [...approverIds],
    approvalQuorum: String(work.approvalQuorum ?? 1),
  };
  const ready = creatorIds.length > 0;

  const { run, pending } = useAction(async () => {
    await update({
      workId: work.id as Id<"works">,
      expectedVersion: work.version,
      patch: { creatorIds },
    });
    onClose();
  });

  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる">
      <span slot="header">制作者を変更</span>
      <div className="dialog-body">
        <p className="body-medium">新しい制作者を選んで保存してください。</p>
        <UserPicker
          label="制作者"
          required
          value={creatorIds}
          onChange={(ids) =>
            setCreatorIds(withoutCreatorsAsApprovers({ ...form, creatorIds: ids }).creatorIds)
          }
          exclude={approverIds}
        />
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton variant="filled" disabled={pending || !ready} onClick={() => void run()}>
          保存
        </M3eButton>
      </div>
    </M3eDialog>
  );
}

export function TransferCreatorsById({ workId, onClose }: { workId: string; onClose: () => void }) {
  const data = useQuery(api.works.get, { workId });
  if (!data) return null;
  return <TransferCreatorsDialog work={data.work} open onClose={onClose} />;
}
