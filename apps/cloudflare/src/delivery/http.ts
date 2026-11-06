/*
 * 外への通知が使う HTTP まわりの小物。fetch と sleep は引数で受けるので、テストは偽物を渡せる。
 */

export type Fetch = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

/** 速さ制限の Retry-After を同じ呼び出しの中で待つ上限（ms）。alarm を長く止めない */
export const RETRY_AFTER_CAP_MS = 5_000;

/** Retry-After（秒）を待つ時間（ms）。上限まで。無い・読めないときは 0 */
export function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!header || !Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}

/**
 * Retry-After をそのまま ms にする（上限なし。秒でも HTTP の日付でもよい）。
 * alarm が次の予定を決めるときの手がかりで、待つのは呼び出し側。無い・読めない・過去なら undefined
 */
export function retryAfterHintMs(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - nowMs;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

export const sleepFor: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
