/**
 * `convex/react` の差し替え（`--mode cloudflare`）。画面が使う hook の表面を、cloudflare/client.ts の購読に繋ぐ。
 * 形は demo/convexReact.ts に合わせてある（画面のコードは Convex かどうかを知らない）。
 */
import type { OptimisticUpdate } from "convex/browser";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { cloudflare, optimistic } from "./client";

export class ConvexReactClient {
  constructor(
    public readonly url: string,
    _options?: unknown,
  ) {}
}

export function ConvexProvider({ children }: { client?: unknown; children: unknown }) {
  return children as never;
}

const none = () => () => {};
const idle = { value: undefined, loaded: false, error: undefined };
const noArgs: Record<string, Value> = {};

export function useQuery(ref: FunctionReference<"query">, ...rest: unknown[]): unknown {
  const arg = rest[0];
  const skip = arg === "skip";
  const args = (skip ? noArgs : (arg ?? noArgs)) as Record<string, Value>;
  const epoch = useSyncExternalStore(cloudflare.subscribeAuth, cloudflare.getEpoch);
  const entry = skip ? null : cloudflare.queryEntry(ref, args);
  const state = useSyncExternalStore(entry?.subscribe ?? none, entry?.getSnapshot ?? (() => idle));
  // 楽観的更新が重なった値。その query の値が替わったときだけ描き直す（読み込みのたびに全画面を描き直さない）
  const overlay = useSyncExternalStore(optimistic.subscribe, () =>
    skip ? undefined : optimistic.read(ref, args),
  );
  // 直前の値を保持（Convex 同様、引数が替わって読み直している間は前回の値を返す）。利用者が替わったら捨てる
  const held = useRef<{ epoch: number; value: unknown }>({ epoch, value: undefined });
  if (held.current.epoch !== epoch) held.current = { epoch, value: undefined };
  if (skip) return undefined;
  if (state.error) throw state.error;
  if (state.loaded) held.current.value = state.value;
  return overlay ?? held.current.value;
}

export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return useMemo(() => {
    const create = (update?: OptimisticUpdate<Record<string, Value>>) => {
      const mutate = async (args: Record<string, Value>) => {
        const rollback = update ? optimistic.begin(update, args ?? {}) : () => {};
        try {
          const result = await cloudflare.mutation(ref, args ?? {});
          // 巻き戻す前にサーバーの値を取っておく（巻き戻した一瞬だけ古い値に戻らないように）
          if (update) await cloudflare.settleOptimistic();
          return result;
        } finally {
          rollback();
        }
      };
      return Object.assign(mutate, { withOptimisticUpdate: create });
    };
    return create();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 参照は名前で同じものとみなす（anyApi は毎回新しい Proxy）
  }, [name]);
}

export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useMemo(
    () => (args?: Record<string, unknown>) => cloudflare.action(ref, args ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 同上
    [name],
  );
}

export function useConvexAuth(): { isLoading: boolean; isAuthenticated: boolean } {
  const auth = useSyncExternalStore(cloudflare.subscribeAuth, cloudflare.getAuth);
  return { isLoading: auth.status === "loading", isAuthenticated: auth.status === "authenticated" };
}

/** cursor で 1 ページずつ読み、いま要るページ数ぶんをまとめて返す。表が変われば全ページを読み直す */
export function usePaginatedQuery(
  ref: FunctionReference<"query">,
  args: Record<string, unknown> | "skip",
  options: { initialNumItems: number },
) {
  const skip = args === "skip";
  const entry = skip ? null : cloudflare.pagedEntry(ref, args, options.initialNumItems);
  const state = useSyncExternalStore(entry?.subscribe ?? none, entry?.getSnapshot ?? (() => idle));
  const loadMore = useCallback(
    (_numItems?: number) => {
      if (!entry) return;
      void entry.more();
    },
    [entry],
  );
  if (state.error) throw state.error;
  const page = state.value as { results: unknown[]; done: boolean; pages: number } | undefined;
  const ready = entry !== null && state.loaded && page !== undefined;
  // 追加を頼んだあと、そのページが届くまでは LoadingMore
  const loading = !ready || (!page.done && page.pages < entry.requestedPages);
  return {
    results: ready ? page.results : [],
    status: !ready
      ? ("LoadingFirstPage" as const)
      : loading
        ? ("LoadingMore" as const)
        : page.done
          ? ("Exhausted" as const)
          : ("CanLoadMore" as const),
    loadMore,
    isLoading: loading,
  };
}

/** 取得は一度きりの query / mutation / action と、prosemirror-sync が使う購読（watchQuery） */
export function useConvex() {
  return useMemo(
    () => ({
      query: (ref: FunctionReference<"query">, args: Record<string, unknown>) =>
        cloudflare.query(ref, args),
      mutation: (ref: FunctionReference<"mutation">, args: Record<string, unknown>) =>
        cloudflare.mutation(ref, args),
      action: (ref: FunctionReference<"action">, args: Record<string, unknown>) =>
        cloudflare.action(ref, args),
      watchQuery: (ref: FunctionReference<"query">, args: Record<string, Value>) => {
        const entry = cloudflare.queryEntry(ref, args);
        return {
          onUpdate: (callback: () => void) => entry.subscribe(callback),
          localQueryResult: () => (entry.state.loaded ? entry.state.value : undefined),
        };
      },
    }),
    [],
  );
}
