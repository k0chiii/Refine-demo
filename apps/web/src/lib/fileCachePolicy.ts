/**
 * 添付ファイルの本体を端末に残すかどうかの方針（ポリシー値）。docs/UI_M3E.md §77
 *
 * - 機密区分の取扱規則は要件 §12 で承認待ち。コードで規則を確定せず、ここの値で切り替える。
 *   既定は「機密（restricted）の制作物は端末に残さない（メモリだけ。サインアウトで消える）」。承認の結果で persistRestricted を変える
 * - 端末の写しは利用者ごとに分け、サインアウト・別の利用者のサインインで消す（lib/artifactCacheStore）。
 *   ブラウザの HTTP キャッシュには残さない（Worker は Cache-Control: private, no-store を返す）
 */
export interface FileCachePolicy {
  /** 端末（Cache Storage）に残すか。false ならメモリだけ */
  persist: boolean;
  /** 機密（restricted）の制作物も端末に残すか */
  persistRestricted: boolean;
  /** メモリに持つ取得済みファイルの合計の上限（バイト） */
  memoryBytes: number;
  /** 端末に残す合計の上限（バイト）。超えたら古い順に消す */
  maxBytes: number;
  /** 1 ファイルの上限（バイト）。これを超えるものは残さない */
  maxEntryBytes: number;
  /** 端末に残す期間（ミリ秒）。過ぎたら使わず消す */
  ttlMs: number;
}

export const defaultFileCachePolicy: FileCachePolicy = {
  persist: true,
  persistRestricted: false,
  memoryBytes: 192 * 1024 * 1024,
  maxBytes: 400 * 1024 * 1024,
  maxEntryBytes: 150 * 1024 * 1024,
  ttlMs: 14 * 24 * 60 * 60 * 1000,
};

/** この制作物の添付を端末に残してよいか（機密区分が分からないときは残さない） */
export function mayPersist(
  confidentiality: "normal" | "restricted" | undefined,
  policy: FileCachePolicy = defaultFileCachePolicy,
): boolean {
  if (!policy.persist) return false;
  if (confidentiality === "normal") return true;
  return confidentiality === "restricted" && policy.persistRestricted;
}
