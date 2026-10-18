import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { ApproverFields } from "./ApproverFields";
import { selectableApprovers } from "./approverSelection";
import { clampQuorum } from "./clampQuorum";

export interface ApproversCellWork {
  id: string;
  title: string;
  /** 校了者の全員（先頭が approverId） */
  approvers: ReadonlyArray<{ id: string; name: string }>;
  /** 制作者の ID（校了者の候補から外す。制作者は校了者になれない） */
  creatorIds: readonly string[];
  /** 校了とみなす人数 */
  approvalQuorum: number;
  /** 宣言の済んだ人数（校了者が 2 人以上の進行中のみ数える） */
  approvalDeclared: number;
  lifecycle: string;
  canEditApprovers: boolean;
}

/** 校了者の表示: 先頭の人の名前 +「ほかN人」。2 人以上の進行中の制作物は、2 行目に宣言の進み具合 */
export function approversSummary(w: Pick<ApproversCellWork, "approvers">): string {
  const [first, ...rest] = w.approvers;
  if (!first) return "";
  return rest.length > 0 ? `${first.name} ほか${rest.length}人` : first.name;
}

/**
 * 制作物一覧の「校了者」のセル。編集できる人（`canEditApprovers`）には押せるボタンで、
 * 押すと校了者の選択（制作物の編集と同じ ApproverFields）を開く。保存は制作物の更新（works.update。権限は work.edit）
 */
export function ApproversCell({ w }: { w: ApproversCellWork }) {
  const [open, setOpen] = useState(false);
  const text = approversSummary(w);
  const progress =
    w.approvers.length > 1 && w.lifecycle === "active"
      ? `校了 ${w.approvalDeclared}/${w.approvalQuorum}人`
      : w.approvers.length > 1
        ? `${w.approvalQuorum}人で校了`
        : null;
  const names = w.approvers.map((a) => a.name).join("、");
  const label = (
    <>
      <span className="mf-table__clip works-table__clip">{text || "—"}</span>
      {progress ? <span className="mf-table__sub">{progress}</span> : null}
    </>
  );
  return (
    <>
      {w.canEditApprovers ? (
        <M3eButton
          variant="text"
          className="works-table__approvers"
          aria-label={`${w.title} の校了者を選ぶ（いま: ${names || "なし"}）`}
          title={names || undefined}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <M3eIcon slot="icon" name={w.approvers.length > 1 ? "groups" : "person"} />
          <span className="works-table__approvers-text">{label}</span>
        </M3eButton>
      ) : text ? (
        <span title={names}>{label}</span>
      ) : (
        <span className="muted">—</span>
      )}
      {open ? (
        // 表の行を押すと制作物が開く。ダイアログの中の操作は行まで伝えない
        <span onClick={(e) => e.stopPropagation()}>
          <ApproversDialog w={w} onClose={() => setOpen(false)} />
        </span>
      ) : null}
    </>
  );
}

/** 校了者と人数を選んで保存する（制作物の更新。人数は 1..校了者の数） */
function ApproversDialog({ w, onClose }: { w: ApproversCellWork; onClose: () => void }) {
  const update = useMutation(api.works.update);
  // 決定前に保存された行で制作者が校了者に入っていても、選択済みには出さない（保存するときに外れる）
  const initialIds = () =>
    selectableApprovers(
      w.approvers.map((a) => a.id),
      w.creatorIds,
    );
  const [ids, setIds] = useState(initialIds);
  const [quorum, setQuorum] = useState(() =>
    String(clampQuorum(w.approvalQuorum, initialIds().length)),
  );
  // 開き直したときは、いまの値から始める
  useEffect(() => {
    setIds(initialIds());
    setQuorum(String(clampQuorum(w.approvalQuorum, initialIds().length)));
  }, [w.id]);
  const { run, pending } = useAction(async () => {
    await update({
      workId: w.id as Id<"works">,
      patch: { approverIds: ids, approvalQuorum: clampQuorum(quorum, ids.length) },
    });
    onClose();
  });
  return (
    <M3eDialog open onClosed={onClose} closeLabel="閉じる">
      <span slot="header">校了者を選ぶ</span>
      <div className="dialog-body">
        <p className="muted small" style={{ margin: 0 }}>
          {w.title}
        </p>
        <ApproverFields
          required
          ids={ids}
          excludeIds={w.creatorIds}
          quorum={quorum}
          onChange={(next) => {
            setIds(next.ids);
            setQuorum(next.quorum);
          }}
        />
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={pending || ids.length === 0}
          onClick={() => void run()}
        >
          保存
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
