import { reject } from "../functions/define.ts";
import { type Fetch, workersAiUrl } from "./provider.ts";

/** ルールの埋め込みに使うモデルと次元（apps/api の /internal/ai/embed が bge-m3 の 1024 次元を返す） */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * 文章の埋め込み。apps/convex/convex/semanticRules.ts の embed の写し。
 * 設定が無い・無効は DomainError（何度やっても同じなので、仕事は retry しない）。通信の失敗は素の Error（retry される）
 */
export async function embed(env: Env, fetcher: Fetch, text: string): Promise<number[]> {
  if (env.RULE_EMBEDDINGS_ENABLED !== "true") throw reject("semantic_search_disabled");
  let target: ReturnType<typeof workersAiUrl>;
  try {
    target = workersAiUrl(env, "/internal/ai/embed");
  } catch (e) {
    throw reject(e instanceof Error ? e.message : "semantic_search_disabled");
  }
  const response = await fetcher(target.url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error("embedding_failed");
  const { vector } = (await response.json()) as { vector: number[] };
  if (!isVector(vector)) throw new Error("invalid_embedding");
  return vector;
}

export const isVector = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.length === EMBEDDING_DIMENSIONS &&
  v.every((n) => typeof n === "number" && Number.isFinite(n));

/** コサイン類似度。どちらかが零ベクトルなら 0（比べようが無いので、順位の最後に回す） */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
