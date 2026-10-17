/** `convex/react` の差し替え（デモモード）。useQuery / useMutation / useConvexAuth を demo バックエンドに向ける。 */
import type { FunctionReference } from "convex/server";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { demo } from "./backend";

export class ConvexReactClient {
  constructor(public readonly url: string) {}
}

function refPath(ref: unknown): string {
  // anyApi の FunctionReference は getFunctionName で名前を取れるが、ここでは JSON 化で十分
  return JSON.stringify(ref);
}

export function useQuery(ref: FunctionReference<"query">, ...rest: unknown[]): unknown {
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
        if (!cancelled && latest.current === key) setState({ key, value });
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
  return state.value;
}

export function useMutation(ref: FunctionReference<"mutation">) {
  return useMemo(() => (args: Record<string, unknown>) => demo.mutation(ref, args ?? {}), [ref]);
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
