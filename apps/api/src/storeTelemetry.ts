import type { ObjectStore } from "./ports.ts";

interface StoreMetric {
  event: "r2_operation";
  requestId: string;
  operation: "put" | "head" | "get" | "delete";
  outcome: "ok" | "failed";
  durationMs: number;
}

/** R2 response timing; excludes stream consumption and intentionally omits object keys. */
export function observeStore(
  store: ObjectStore,
  requestId: string,
  report: (metric: StoreMetric) => void,
): ObjectStore {
  async function measured<T>(
    operation: StoreMetric["operation"],
    run: () => Promise<T>,
  ): Promise<T> {
    const started = performance.now();
    let outcome: StoreMetric["outcome"] = "failed";
    try {
      const result = await run();
      outcome = "ok";
      return result;
    } finally {
      report({
        event: "r2_operation",
        requestId,
        operation,
        outcome,
        durationMs: Math.round(performance.now() - started),
      });
    }
  }
  return {
    put: (...args) => measured("put", () => store.put(...args)),
    get: (...args) => measured("get", () => store.get(...args)),
    head: (...args) => measured("head", () => store.head(...args)),
    delete: (...args) => measured("delete", () => store.delete(...args)),
  };
}
