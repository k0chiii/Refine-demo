import { isAllowed, rolesOf, type AuthorizationContext } from "../acl/authorize.ts";
import { isAccepting, type Revision } from "../revision/Revision.ts";
import type { MediaType } from "./Work.ts";

/**
 * 「版を提出する制作物」の選び方（L-15。利用者決定 2026-10-15「普段のメンバーの主な操作は版の提出と校正」）。
 * レール・ホームの FAB「版を提出」とダッシュボードの「提出する」は、この判定で候補を出す。
 *
 * 提出そのものの可否は既存の判定（`revision.submit` の権限＋進行中の制作物）が正本で、ここはそれより狭めるだけ。
 * どこまで狭めるかは制度の判断なので、値として外に出す（CLAUDE.md「制度承認待ちはポリシー値に」）。
 */
export interface SubmitTargetPolicy {
  /**
   * 職責として制作者である制作物だけを出すか。false なら ACL で edit（提出の委任）を受けた制作物も出す。
   * 既定 true（利用者の説明「自分が制作者の制作物」）。どちらでも提出の権限（`revision.submit`）は必ず確かめる
   */
  creatorOnly: boolean;
  /**
   * 受付中の版がある制作物も出すか。新しい版を出すと受付中の版は「新版提出」で閉じる（D1）。
   * 既定 true（受付中でも直した版を出すのが普段の操作のため）
   */
  includeAccepting: boolean;
}

export const defaultSubmitTargetPolicy: SubmitTargetPolicy = {
  creatorOnly: true,
  includeAccepting: true,
};

/** 提出の入口。PDF・画像などの添付は版提出ダイアログ、文章は文章エディタ、SNS 投稿は投稿の編集 */
export type SubmitRoute = "upload" | "write" | "post";

export function submitRouteFor(mediaType: MediaType): SubmitRoute {
  if (mediaType === "document") return "write";
  if (mediaType === "sns") return "post";
  return "upload";
}

/**
 * この制作物を「版を提出する制作物」として出すか。
 * - 提出の権限（`revision.submit`。制作者または edit 委任）が無ければ出さない（既存の権限チェック）
 * - 進行中（active）でなければ出さない（提出の準備 `prepareSubmission` が拒否するため）
 * - それ以外はポリシーで狭める
 */
export function isSubmitTarget(
  authz: AuthorizationContext,
  revisions: readonly Revision[],
  policy: SubmitTargetPolicy = defaultSubmitTargetPolicy,
): boolean {
  if (!isAllowed("revision.submit", authz)) return false;
  if (authz.work.lifecycle !== "active") return false;
  if (policy.creatorOnly && !rolesOf(authz.work, authz.principal).isCreator) return false;
  if (!policy.includeAccepting && revisions.some(isAccepting)) return false;
  return true;
}
