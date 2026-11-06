import {
  DomainError,
  isAttemptOrphan,
  markAttemptPurged,
  UPLOAD_ATTEMPT_TTL_MS,
  uploadAttemptObjectKey,
  type Principal,
  type UploadAttempt,
  type UploadAttemptTarget,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/*
 * R2 への転送の試行（版の提出物・フィードバックの添付で共通）。
 * 試行の開始・採用・破棄は、実体を検証するサービス（Hono）からサービス認証付きの境界を通してだけ呼ばれる。
 * 利用者の認可（項目の持ち主か）は各ユースケースが別に確かめる。
 */

/** 試行を予約し、この試行だけが書き込むキーを払い出す */
export async function reserveUploadAttempt(
  ctx: AppContext,
  input: { target: UploadAttemptTarget; targetId: string; uploaderId: string; keyPrefix: string },
): Promise<UploadAttempt> {
  const created = await ctx.attempts.insert({
    target: input.target,
    targetId: input.targetId,
    uploaderId: input.uploaderId,
    objectKey: "",
    state: "reserved",
    createdAt: ctx.clock.now(),
  });
  // キーは払い出された ID で分ける（推測困難・他の試行と重ならない）
  const attempt = { ...created, objectKey: uploadAttemptObjectKey(input.keyPrefix, created.id) };
  await ctx.attempts.update(attempt);
  return attempt;
}

/** 本人の、その種類の試行だけを返す。他人の試行は存在を漏らさない */
export async function loadOwnUploadAttempt(
  ctx: AppContext,
  principal: Principal,
  attemptId: string,
  target: UploadAttemptTarget,
): Promise<UploadAttempt> {
  const attempt = await ctx.attempts.findById(attemptId);
  if (!attempt || attempt.target !== target || attempt.uploaderId !== principal.userId)
    throw new DomainError("upload_attempt_not_found", { attemptId });
  return attempt;
}

/** 清掃の一覧で他の種類と区別するための頭（Hono には不透明な itemId として渡る） */
export const ATTEMPT_ORPHAN_PREFIX = "attempt:";

/** 採用されなかった試行のうち、R2 から実体を消してよいもの（itemId は "attempt:{試行 ID}"） */
export async function listOrphanAttemptObjects(
  ctx: AppContext,
  limit = 100,
): Promise<Array<{ itemId: string; objectKey: string }>> {
  const now = ctx.clock.now();
  return (await ctx.attempts.listOrphanCandidates(now - UPLOAD_ATTEMPT_TTL_MS, limit))
    .filter((a) => isAttemptOrphan(a, now) && a.objectKey !== "")
    .map((a) => ({ itemId: `${ATTEMPT_ORPHAN_PREFIX}${a.id}`, objectKey: a.objectKey }));
}

/** R2 から削除済みの試行を記録する（冪等）。採用済みの試行は絶対に記録しない（実体を消す対象ではない） */
export async function markAttemptObjectsPurged(
  ctx: AppContext,
  attemptIds: string[],
): Promise<number> {
  const now = ctx.clock.now();
  let count = 0;
  for (const id of new Set(attemptIds)) {
    const attempt = await ctx.attempts.findById(id);
    if (!attempt || !isAttemptOrphan(attempt, now)) continue;
    await ctx.attempts.update(markAttemptPurged(attempt, now));
    count++;
  }
  return count;
}
