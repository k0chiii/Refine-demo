import type { OptimisticLocalStore, OptimisticUpdate } from "convex/browser";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type FunctionReference_future,
  type OptionalRestArgs,
} from "convex/server";
import type { Value } from "convex/values";

type QueryReference = FunctionReference<"query"> | FunctionReference_future<"query">;
const keyOf = (ref: QueryReference, args: unknown) =>
  `${getFunctionName(ref)}|${JSON.stringify(args)}`;
type Entry = { ref: QueryReference; args: Record<string, Value>; value: unknown };

/** Immutable base results plus replayable pending mutations; failed mutations remove only their own overlay. */
export class OptimisticQueries {
  private base = new Map<string, Entry>();
  private view = new Map<string, Entry>();
  private updates = new Map<symbol, (store: OptimisticLocalStore) => void>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  snapshot = () => this.version;
  entries = () => [...this.base.values()];
  remember(ref: QueryReference, args: Record<string, Value>, value: unknown) {
    this.base.set(keyOf(ref, args), { ref, args, value });
    this.replay();
  }
  clear() {
    this.base.clear();
    this.updates.clear();
    this.replay();
  }
  read(ref: QueryReference, args: unknown) {
    return this.view.get(keyOf(ref, args))?.value;
  }
  begin<Args extends Record<string, Value>>(update: OptimisticUpdate<Args>, args: Args) {
    const id = Symbol();
    this.updates.set(id, (store) => update(store, args));
    this.replay();
    return () => {
      this.updates.delete(id);
      this.replay();
    };
  }
  private replay() {
    this.view = new Map(this.base);
    const store: OptimisticLocalStore = {
      getQuery: <Q extends QueryReference>(query: Q, ...args: OptionalRestArgs<Q>) =>
        this.read(query, args[0] ?? {}) as FunctionReturnType<Q> | undefined,
      setQuery: (query, args, value) => {
        this.view.set(keyOf(query, args), { ref: query, args, value });
      },
      getAllQueries: <Q extends QueryReference>(query: Q) =>
        [...this.view.values()]
          .filter((entry) => getFunctionName(entry.ref) === getFunctionName(query))
          .map((entry) => ({
            args: entry.args as FunctionArgs<Q>,
            value: entry.value as FunctionReturnType<Q> | undefined,
          })),
    };
    for (const update of this.updates.values()) update(store);
    this.version++;
    for (const callback of this.listeners) callback();
  }
}
