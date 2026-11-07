import type { Principal } from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

/*
 * FB（フィードバック）はコメントへ移して廃止した（利用者決定 2026-10-20。移行の実行コードは削除済み。経緯は docs/DECISIONS.md）。
 * 移したスレッドは移行元の FB のスレッド ID（migratedFromFeedbackThreadId）を持ち、古い URL・通知からの行き先に使う。
 */

/**
 * 旧 FB のスレッドの URL（/feedback/{スレッド}）から、移し先のコメントを引く（開く画面は /revisions/{版}?thread={コメント}）。
 * 移していない・コメントが削除された・見られない制作物なら null（存在を漏らさない）
 */
export async function resolveMigratedFeedbackThread(
  ctx: AppContext,
  principal: Principal,
  feedbackThreadId: string,
): Promise<{ revisionId: string; threadId: string } | null> {
  const thread = await ctx.threads.findByMigratedFrom(feedbackThreadId);
  if (!thread || thread.deletedAt !== undefined) return null;
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) return null;
  try {
    await loadAuthorizedWork(ctx, principal, revision.workId, "work.view");
  } catch {
    return null;
  }
  return { revisionId: revision.id, threadId: thread.id };
}
