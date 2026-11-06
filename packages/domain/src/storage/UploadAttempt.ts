import { DomainError } from "../shared/DomainError.ts";
import type { UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";

/**
 * R2 への 1 回の転送（試行）。版の提出物・フィードバックの添付・コメントの添付で共通に使う（§8.1 / A-02）。
 * - 試行ごとに別のオブジェクトキーを払い出す。同じ項目に PUT が 2 つ並んでも、互いの実体を上書きしない。
 * - 実体の検証が済んだ試行を 1 つだけ、項目の状態と同じトランザクションで「採用」する。
 *   提出物（Artifact）・添付が参照するのは採用された試行のキーだけ。
 * - 採用されなかった試行（遅れた・負けた・失敗した）のキーは、その試行自身の補償か清掃でしか消さない。
 *   採用された実体を、古い PUT や補償の削除が変更することはない（キーが違うため）。
 * - 採否を決められるのは、実体を検証したサービス（Hono）からの呼出しだけ（利用者の自己申告では決めない）。
 */
export type UploadAttemptTarget = "uploadItem" | "feedbackFile" | "commentFile";
export type UploadAttemptState = "reserved" | "adopted" | "discarded";

export interface UploadAttempt {
  id: string;
  target: UploadAttemptTarget;
  /** 版の提出物の項目 ID、またはフィードバック・コメントの添付 ID */
  targetId: string;
  /** 試行を始めた人（項目の持ち主と同じであることを begin で確かめている） */
  uploaderId: UserId;
  /** この試行だけが書き込むキー（`${keyPrefix}/attempts/${id}`） */
  objectKey: string;
  state: UploadAttemptState;
  createdAt: Instant;
  /** 採用・破棄が決まった時刻 */
  settledAt?: Instant;
  /** 清掃で R2 から実体を消し終えた時刻 */
  purgedAt?: Instant;
}

/**
 * 試行の有効期間。これを過ぎた未採用の試行は採用できず、清掃の対象になる。
 * Worker の 1 リクエスト（転送）がこれより長く続くことは想定しない。採用の拒否と清掃が同じ境界を使うので、
 * 清掃が消した後に採用される（参照先の無い提出物ができる）ことはない。
 */
export const UPLOAD_ATTEMPT_TTL_MS = 6 * 60 * 60 * 1000;

/** 試行のキー。項目の名前空間（keyPrefix）の下に、試行 ID で分けて置く */
export function uploadAttemptObjectKey(keyPrefix: string, attemptId: string): string {
  return `${keyPrefix}/attempts/${attemptId}`;
}

/** 採用できる試行か（予約中で、期限内）。そうでなければ upload_attempt_closed */
export function assertAttemptAdoptable(attempt: UploadAttempt, now: Instant): void {
  if (attempt.state !== "reserved" || now >= attempt.createdAt + UPLOAD_ATTEMPT_TTL_MS)
    throw new DomainError("upload_attempt_closed", {
      attemptId: attempt.id,
      state: attempt.state,
    });
}

export function adoptAttempt(attempt: UploadAttempt, now: Instant): UploadAttempt {
  return { ...attempt, state: "adopted", settledAt: now };
}

/**
 * 試行を破棄する（実体は清掃が消す）。採用済みの試行は、別の試行の失敗や遅れた補償では破棄しない。
 * 採用済みの実体を手放せるのは releaseAdoptedAttempt（項目のやり直し）だけ。
 */
export function discardAttempt(attempt: UploadAttempt, now: Instant): UploadAttempt {
  if (attempt.state !== "reserved") return attempt;
  return { ...attempt, state: "discarded", settledAt: now };
}

/** 採用済みの実体を手放す（確定前の項目をやり直すとき。確定後は呼ばれない） */
export function releaseAdoptedAttempt(attempt: UploadAttempt, now: Instant): UploadAttempt {
  if (attempt.state !== "adopted") return attempt;
  return { ...attempt, state: "discarded", settledAt: now };
}

/** 清掃で R2 から消してよい試行か（破棄済み、または期限を過ぎて採用されなかったもの）。採用済みは決して消さない */
export function isAttemptOrphan(attempt: UploadAttempt, now: Instant): boolean {
  if (attempt.purgedAt !== undefined) return false;
  if (attempt.state === "discarded") return true;
  return attempt.state === "reserved" && now >= attempt.createdAt + UPLOAD_ATTEMPT_TTL_MS;
}

/** 清掃で消し終えた印。期限切れの予約は破棄済みにもする */
export function markAttemptPurged(attempt: UploadAttempt, now: Instant): UploadAttempt {
  return {
    ...attempt,
    state: "discarded",
    settledAt: attempt.settledAt ?? now,
    purgedAt: now,
  };
}
