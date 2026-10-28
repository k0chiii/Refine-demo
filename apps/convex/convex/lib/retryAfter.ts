/** 速さ制限の Retry-After を待つ上限（ms）。action を長く止めない */
export const RETRY_AFTER_CAP_MS = 5_000;

/** Retry-After（秒）を待つ時間（ms）。上限まで。無い・読めないときは 0 */
export function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!header || !Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}

export const sleepFor = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
