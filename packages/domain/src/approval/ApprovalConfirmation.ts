import { isAllowed } from "../acl/authorize.ts";
import type { Principal, WorkPermissionGrant } from "../acl/Permission.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { Work } from "../work/Work.ts";

/**
 * 独立確認（D2: 制作者本人が校了するときの事前確認の証跡）。
 * 制作者・校了権限者以外の人が、**自分の認証済みの操作で**「この制作物のこの版を確認した」と記録したもの。
 * 校了する人が確認者の ID を申告するだけでは証跡にならない（PR #1 レビュー指摘）。
 * 校了の時点で、制作物・対象版・確認者・確認時刻がいまも有効かを {@link isConfirmationValid} で確かめ直す。
 */
export interface ApprovalConfirmation {
  id: string;
  workId: WorkId;
  revisionId: RevisionId;
  confirmerId: UserId;
  confirmedAt: Instant;
  /** 確認のメモ（任意） */
  note?: string;
}

/** 確認のメモの上限（超えた分は切り詰める） */
export const CONFIRMATION_NOTE_MAX = 500;

/** 制作者でも校了権限者でもない人か（独立した確認者になれるか） */
export function isIndependentOf(work: Pick<Work, "creatorIds" | "approverId">, userId: UserId) {
  return userId !== work.approverId && !work.creatorIds.includes(userId);
}

/**
 * 確認者を認可判定にかけるための主体。グループの ACL は MVP では無効（Permission.ts）なので個人だけで判定する。
 */
function confirmerPrincipal(userId: UserId): Principal {
  return { userId, isSystemAdmin: false, groupIds: [], orgPermissions: [] };
}

export interface ConfirmationValidityContext {
  work: Work;
  /** 校了しようとしている版 */
  revisionId: RevisionId;
  grants: readonly WorkPermissionGrant[];
  /** 校了する人 */
  actorId: UserId;
  /** これより前の確認は無効（再開した後は確認し直す） */
  notBefore?: Instant;
}

/**
 * 記録された独立確認が、いま校了しようとしている版に対して有効か。
 * - 同じ制作物・同じ版の確認であること（版が変われば確認し直す）
 * - 確認者が校了する人でなく、いまも制作者・校了権限者でないこと（後から職責が変わった場合も無効）
 * - 確認者がいまもこの制作物の確認ができること（閲覧権限を取り消された人の確認は数えない）
 * - 再開より後の確認であること
 */
export function isConfirmationValid(
  confirmation: ApprovalConfirmation,
  ctx: ConfirmationValidityContext,
): boolean {
  if (confirmation.workId !== ctx.work.id) return false;
  if (confirmation.revisionId !== ctx.revisionId) return false;
  if (confirmation.confirmerId === ctx.actorId) return false;
  if (!isIndependentOf(ctx.work, confirmation.confirmerId)) return false;
  if (ctx.notBefore !== undefined && confirmation.confirmedAt < ctx.notBefore) return false;
  return isAllowed("approval.confirm", {
    work: ctx.work,
    grants: ctx.grants,
    principal: confirmerPrincipal(confirmation.confirmerId),
  });
}

/** 有効な独立確認のうち最も新しいもの（無ければ null） */
export function findValidConfirmation(
  confirmations: readonly ApprovalConfirmation[],
  ctx: ConfirmationValidityContext,
): ApprovalConfirmation | null {
  let best: ApprovalConfirmation | null = null;
  for (const c of confirmations)
    if (isConfirmationValid(c, ctx) && (best === null || c.confirmedAt > best.confirmedAt))
      best = c;
  return best;
}

/** メモの正規化（空なら undefined。長すぎる分は切り詰める） */
export function normalizeConfirmationNote(note: string | undefined): string | undefined {
  const n = note?.trim() ?? "";
  return n === "" ? undefined : n.slice(0, CONFIRMATION_NOTE_MAX);
}
