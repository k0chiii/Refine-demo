/** `convex/react` の差し替え（デモモード）。useQuery / useMutation / useConvexAuth を demo バックエンドに向ける。 */
import { OptimisticQueries } from "../lib/optimisticQueries";
import type { OptimisticUpdate } from "convex/browser";
import type { Value } from "convex/values";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { demo } from "./backend";

const optimistic = new OptimisticQueries();
let optimisticUser: string | null = null;

export class ConvexReactClient {
  constructor(public readonly url: string) {}
}

function refPath(ref: unknown): string {
  // anyApi の FunctionReference は getFunctionName で名前を取れるが、ここでは JSON 化で十分
  return getFunctionName(ref as FunctionReference<"query">);
}

export function useQuery(ref: FunctionReference<"query">, ...rest: unknown[]): unknown {
  useSyncExternalStore(optimistic.subscribe, optimistic.snapshot);
  const arg = rest[0];
  const skip = arg === "skip";
  const argsKey = skip ? "skip" : JSON.stringify(arg ?? {});
  const version = useSyncExternalStore(
    (cb) => demo.subscribe(cb),
    () => demo.getVersion(),
  );
  const [state, setState] = useState<{ key: string; value: unknown }>({
    key: "",
    value: undefined,
  });
  const key = `${refPath(ref)}|${argsKey}|${version}|${demo.userId ?? ""}`;
  const latest = useRef(key);
  latest.current = key;
  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    demo
      .query(ref, (arg ?? {}) as Record<string, unknown>)
      .then((value) => {
        if (!cancelled && latest.current === key) {
          if (optimisticUser !== demo.userId) {
            optimistic.clear();
            optimisticUser = demo.userId;
          }
          optimistic.remember(ref, (arg ?? {}) as Record<string, Value>, value);
          setState({ key, value });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && latest.current === key) setState({ key, value: { __error: error } });
      });
    return () => {
      cancelled = true;
    };
  }, [key, skip]);
  if (skip) return undefined;
  const v = state.value as { __error?: unknown } | undefined;
  if (v && typeof v === "object" && "__error" in v) throw v.__error;
  // 直前の値を保持（Convex 同様、再取得中も前回値を返す）
  return optimistic.read(ref, arg ?? {}) ?? state.value;
}

export function useMutation(ref: FunctionReference<"mutation">) {
  const path = refPath(ref);
  return useMemo(() => {
    const create = (update?: OptimisticUpdate<Record<string, Value>>) => {
      const mutate = async (args: Record<string, Value>) => {
        const rollback = update ? optimistic.begin(update, args ?? {}) : () => {};
        try {
          const result = await demo.mutation(ref, args ?? {});
          if (update) {
            for (const entry of optimistic.entries())
              optimistic.remember(
                entry.ref,
                entry.args,
                await demo.query(entry.ref as FunctionReference<"query">, entry.args),
              );
          }
          return result;
        } finally {
          rollback();
        }
      };
      return Object.assign(mutate, { withOptimisticUpdate: create });
    };
    return create();
  }, [path]);
}

export function useAction(ref: FunctionReference<"action">) {
  return useMemo(
    () => (_args: Record<string, unknown>) =>
      Promise.reject(new Error(`actions are not available in demo mode: ${refPath(ref)}`)),
    [ref],
  );
}

export function useConvexAuth(): { isLoading: boolean; isAuthenticated: boolean } {
  const version = useSyncExternalStore(
    (cb) => demo.subscribe(cb),
    () => demo.getVersion(),
  );
  void version;
  return { isLoading: false, isAuthenticated: demo.userId !== null };
}

export function ConvexProvider({ children }: { children: unknown }) {
  return children as never;
}

/** Cursor-based query API used by production; every demo mutation refreshes all loaded pages. */
export function usePaginatedQuery(
  ref: FunctionReference<"query">,
  args: Record<string, unknown> | "skip",
  options: { initialNumItems: number },
) {
  const version = useSyncExternalStore(
    (cb) => demo.subscribe(cb),
    () => demo.getVersion(),
  );
  const key = `${refPath(ref)}|${JSON.stringify(args)}|${demo.userId ?? ""}`;
  const [error, setError] = useState<{ key: string; value: unknown } | null>(null);
  const [request, setRequest] = useState({ key, pages: 1 });
  const pages = request.key === key ? request.pages : 1;
  const [result, setResult] = useState<{
    key: string;
    version: number;
    pages: number;
    results: unknown[];
    done: boolean;
  }>({ key: "", version: -1, pages: 0, results: [], done: false });
  useEffect(() => {
    if (args === "skip") return;
    let cancelled = false;
    const load = async () => {
      let cursor: string | null = null;
      const results: unknown[] = [];
      let done = false;
      for (let i = 0; i < pages && !done; i++) {
        const page = (await demo.query(ref, {
          ...args,
          paginationOpts: { numItems: options.initialNumItems, cursor },
        })) as { page: unknown[]; continueCursor: string; isDone: boolean };
        results.push(...page.page);
        cursor = page.continueCursor;
        done = page.isDone;
      }
      if (!cancelled) setResult({ key, version, pages, results, done });
    };
    void load().catch((value) => {
      if (!cancelled) setError({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [key, version, pages, options.initialNumItems]);
  if (error?.key === key) throw error.value;
  const valid = result.key === key;
  const loading = !valid || result.version !== version || result.pages !== pages;
  return {
    results: valid ? result.results : [],
    status: !valid
      ? ("LoadingFirstPage" as const)
      : loading
        ? ("LoadingMore" as const)
        : result.done
          ? ("Exhausted" as const)
          : ("CanLoadMore" as const),
    loadMore: (_numItems: number) => setRequest({ key, pages: pages + 1 }),
    isLoading: loading,
  };
}

/** Shared editors need the real backend; keep module imports compatible with the isolated demo. */
export function useConvex() {
  return useMemo(
    () => ({
      query: (ref: FunctionReference<"query">, args: Record<string, unknown>) =>
        demo.query(ref, args),
      mutation: (ref: FunctionReference<"mutation">, args: Record<string, unknown>) =>
        demo.mutation(ref, args),
    }),
    [],
  );
}
