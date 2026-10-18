import { clampQuorum } from "./clampQuorum";

/**
 * 制作者は校了者になれない（利用者決定 2026-10-18「制作者が校了者になることはないです」）。
 * 業務規則の本体はサーバー（domain の normalizeApprovalSetup）。ここは選択肢と選択済みから制作者を外すだけ。
 */

/** 校了者の選択済みから制作者を外す（決定前に保存された行を開いたときも使う） */
export function selectableApprovers(
  approverIds: readonly string[],
  creatorIds: readonly string[],
): string[] {
  return approverIds.filter((id) => !creatorIds.includes(id));
}

/**
 * 制作者を変えたとき、新しい制作者になった人を校了者から外す。
 * 校了者が減ったら、校了とみなす人数も校了者の数に収める。変わらなければ同じオブジェクトを返す
 */
export function withoutCreatorsAsApprovers<
  T extends { creatorIds: readonly string[]; approverIds: string[]; approvalQuorum: string },
>(form: T): T {
  const approverIds = selectableApprovers(form.approverIds, form.creatorIds);
  if (approverIds.length === form.approverIds.length) return form;
  return {
    ...form,
    approverIds,
    approvalQuorum: String(clampQuorum(form.approvalQuorum, approverIds.length)),
  };
}
