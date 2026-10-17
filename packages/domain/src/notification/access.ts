import { canViewWork, type AuthorizationContext } from "../acl/authorize.ts";
import type { Principal } from "../acl/Permission.ts";
import { canViewFeedback } from "../feedback/feedback.ts";
import type { UserId } from "../shared/ids.ts";

/**
 * 通知が伝える保護情報の種類。
 * - work: 制作物の校正情報（作品名・版・締切・確認観点・コメントの抜粋など）。制作物の閲覧権限（canViewWork）で守る
 * - feedback: 制作のフィードバック。フィードバックの閲覧権限（canViewFeedback: restricted 以外は委員なら誰でも）で守る
 */
export type NotificationSubject = "work" | "feedback";

/**
 * 通知本文も認可の対象（§5.2-10）。通知を作るときと読むときの両方でこの判定を通し、
 * 見られない制作物の保護情報（作品名・確認観点など）を返さない。
 */
export function canSeeNotificationSubject(
  subject: NotificationSubject,
  ctx: AuthorizationContext,
): boolean {
  return subject === "feedback" ? canViewFeedback(ctx) : canViewWork(ctx);
}

/**
 * 通知の受信者を判定に使う主体。受信者は操作した本人ではないため userId しか分からない。
 * グループ連動（Nogiku Access）前の MVP では groupIds は常に空なので、利用者本人の主体と同じ判定になる。
 * 連動後にグループ経由でだけ見られる人は「見られない」側に倒れる（保護情報を漏らさない向き）。
 */
export function recipientPrincipal(userId: UserId): Principal {
  return { userId, isSystemAdmin: false, groupIds: [], orgPermissions: [] };
}
