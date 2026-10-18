/**
 * 同じ問い合わせが実行中なら、その結果を共有する（同時に来た同一の呼び出しを 1 本にまとめる）。
 *
 * 認可の判定はキャッシュしない（権限剥奪は次の要求から即座に効く: §9.1 / A-11）。ここがまとめるのは
 * 「いま Convex に尋ねている最中の、同じ利用者・同じ添付の要求」だけで、終わった結果は残さない
 * （終わった瞬間にキーを捨てる）。後から来た要求は必ず新しく尋ねる。
 * PDF.js は 1 ファイルを十数本の範囲取得で読むので、重なって届く分の Convex 呼び出しが減る。
 * 状態は isolate の中だけ（Worker 間・再起動をまたいで残らない）。
 */
export function createCoalescer() {
  const running = new Map<string, Promise<unknown>>();
  return function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
    const hit = running.get(key);
    if (hit) return hit as Promise<T>;
    const p = run().finally(() => {
      running.delete(key);
    });
    running.set(key, p);
    return p;
  };
}
