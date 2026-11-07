/*
 * 外への通知が使う HTTP まわりの小物。fetch と sleep は引数で受けるので、テストは偽物を渡せる。
 */

export type Fetch = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

/** 速さ制限の Retry-After を同じ呼び出しの中で待つ上限（ms）。alarm・action を長く止めない */
export const RETRY_AFTER_CAP_MS = 5_000;

/**
 * Retry-After をそのまま ms にする（上限なし。秒でも HTTP の日付でもよい）。
 * 次の予定を決めるときの手がかりで、待つのは呼び出し側。無い・読めない・過去なら undefined
 */
export function retryAfterHintMs(header: string | null, nowMs = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - nowMs;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/** Retry-After を同じ呼び出しの中で待つ時間（ms）。上限まで。無い・読めないときは 0 */
export function retryAfterMs(header: string | null, nowMs = Date.now()): number {
  return Math.min(retryAfterHintMs(header, nowMs) ?? 0, RETRY_AFTER_CAP_MS);
}

export const sleepFor: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
