import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { useRef } from "react";

/**
 * 引数が変わっても、新しい結果が届くまで直前の結果を返す `useQuery`。
 *
 * Convex の `useQuery` は引数が変わると、新しい結果が届くまで `undefined` を返す（読み込み中と同じ）。
 * 絞り込み・検索・選択で引数を変える画面では、そのたびに「読み込み中」の表示（骨組み・「…」・空の候補）へ一瞬戻り、
 * 描き直したように見える（利用者指示 2026-10-17「セレクトボックスで選ぶたび再レンダリングみたいになるのやめたい」）。
 * 最初の 1 回だけ `undefined`、以降は前回の値を保つ。`"skip"` にしたときは前回の値も捨てる。
 */
export function useStableQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const result = useQuery(query, ...args);
  const last = useRef<FunctionReturnType<Query> | undefined>(undefined);
  if (args[0] === "skip") last.current = undefined;
  else if (result !== undefined) last.current = result;
  return result === undefined && args[0] !== "skip" ? last.current : result;
}
